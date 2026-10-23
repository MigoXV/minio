#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Promote an image already verified against isolated data. Keep the old container stopped for rollback.
set -euo pipefail
umask 077

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
prod=${MINIO_PROD_DIR:-$HOME/.local/share/minio-prod}
candidate=${1:?Usage: promote-candidate.sh <verified image tag or ID>}
checks=$prod/checks
stamp=$(date -u +%Y%m%dT%H%M%SZ)
old_name=minio-prod-before-$stamp
mkdir -p "$checks"
image_id=$(docker image inspect "$candidate" --format '{{.Id}}')
old_image=$(docker inspect minio-prod --format '{{.Image}}')
[[ $image_id != "$old_image" ]]
[[ $(docker inspect minio-prod --format '{{.State.Running}}') == true ]]
[[ -f $prod/images/current-image && -x $prod/bin/run-minio-prod ]]
gateway_pid=$(systemctl --user show minio-lan-gateway.service -p MainPID --value)
[[ $gateway_pid =~ ^[1-9][0-9]*$ ]]
[[ $(docker ps --filter name=minio-manage-test --format '{{.ID}}' | wc -l) -eq 0 ]]

echo 'Verifying current production data before switching'
GOTOOLCHAIN=local "$repo/.local/toolchains/go/bin/go" run "$repo/ops/minio-lan/container/verify_readonly.go" > "$checks/manage-before-$stamp.json"
cp "$prod/images/current-image" "$checks/manage-image-before-$stamp"

switched=false
rollback() {
  code=$?
  trap - EXIT
  if [[ $code -eq 0 || $switched == false ]]; then exit "$code"; fi
  echo 'Candidate failed; restoring the previous production container' >&2
  if docker inspect minio-prod >/dev/null 2>&1; then
    if [[ $(docker inspect minio-prod --format '{{.Image}}') != "$old_image" ]]; then
      docker update --restart no minio-prod >/dev/null 2>&1 || true
      docker stop --time 60 minio-prod >/dev/null 2>&1 || true
      docker rm minio-prod >/dev/null 2>&1 || true
    fi
  fi
  cp "$checks/manage-image-before-$stamp" "$prod/images/current-image"
  if docker inspect "$old_name" >/dev/null 2>&1; then
    docker rename "$old_name" minio-prod || true
    docker update --restart unless-stopped minio-prod >/dev/null 2>&1 || true
    docker start minio-prod >/dev/null 2>&1 || true
  elif docker inspect minio-prod >/dev/null 2>&1; then
    docker update --restart unless-stopped minio-prod >/dev/null 2>&1 || true
    docker start minio-prod >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap rollback EXIT

echo 'Stopping only the backend; the HTTPS gateway remains active'
switched=true
docker update --restart no minio-prod >/dev/null
docker stop --time 60 minio-prod >/dev/null
docker rename minio-prod "$old_name"
printf '%s\n' "$image_id" > "$prod/images/current-image.new"
mv "$prod/images/current-image.new" "$prod/images/current-image"
"$prod/bin/run-minio-prod" >/dev/null

ready=false
for ((i=0; i<120; i++)); do
  if curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:19000/minio/health/ready 2>/dev/null &&
     curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:19001/ 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.5
done
[[ $ready == true ]]
[[ $(docker inspect minio-prod --format '{{.Image}}') == "$image_id" ]]
[[ $(systemctl --user show minio-lan-gateway.service -p MainPID --value) == "$gateway_pid" ]]
ca=$prod/config/certs/ca.crt
curl -fsS --cacert "$ca" --max-time 10 -o /dev/null https://127.0.0.1:9000/minio/health/ready
curl -fsS --cacert "$ca" --max-time 10 -o /dev/null https://127.0.0.1:9001/
GOTOOLCHAIN=local "$repo/.local/toolchains/go/bin/go" run "$repo/ops/minio-lan/container/verify_readonly.go" > "$checks/manage-after-$stamp.json"
python3 - "$checks/manage-before-$stamp.json" "$checks/manage-after-$stamp.json" <<'PY'
import json, sys
before, after = (json.load(open(path)) for path in sys.argv[1:])
for key in ('bucketCount', 'objectCount', 'objectBytes', 'inventorySHA256'):
    assert before[key] == after[key], f'production inventory changed during promotion: {key}'
assert after['sampleRead'] and after['consoleLogin']
PY

echo "Promoted $image_id; previous stopped container: $old_name"
