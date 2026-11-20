#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
prod=${MINIO_PROD_DIR:-$HOME/.local/share/minio-prod}
source_data=$repo/ops/minio-lan/.local/data
target_data=$prod/data
checks=$prod/checks
unit=$HOME/.config/systemd/user/minio-lan.service
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot=$prod/backup/data-pre-container-$stamp
mkdir -p "$checks"
chmod 700 "$checks"

[[ -d "$source_data" && -d "$target_data" && ! -e "$snapshot" ]]
[[ -f "$repo/ops/minio-lan/.local/minio.env" && -f "$unit" ]]
systemctl --user is-active --quiet minio-lan.service
systemctl --user is-active --quiet minio-lan-gateway.service
if docker container inspect minio-prod >/dev/null 2>&1; then
  echo 'Refusing to replace an existing minio-prod container' >&2
  exit 1
fi
gateway_pid=$(systemctl --user show minio-lan-gateway.service -p MainPID --value)

stopping=false
rollback() {
  status=$?
  trap - EXIT
  if [[ $status -eq 0 || $stopping == false ]]; then
    exit "$status"
  fi
  echo 'Cutover failed; restoring the host MinIO binary against the latest data' >&2
  if docker container inspect minio-prod >/dev/null 2>&1; then
    docker update --restart no minio-prod >/dev/null 2>&1 || true
    docker stop --time 60 minio-prod >/dev/null 2>&1 || true
    docker rm minio-prod >/dev/null 2>&1 || true
  fi
  if [[ -d "$source_data" ]]; then
    systemctl --user enable --now minio-lan.service >&2 || true
  else
    systemctl --user start minio-lan-rollback.service >&2 || true
  fi
  exit "$status"
}
trap rollback EXIT

echo 'Recording final live S3 inventory'
GOTOOLCHAIN=local "$repo/.local/toolchains/go/bin/go" run "$repo/ops/minio-lan/container/verify_readonly.go" > "$checks/s3-before.json"
echo 'Stopping only the old MinIO backend'
stopping=true
systemctl --user disable --now minio-lan.service

echo 'Syncing final data delta'
rsync -aHAX --numeric-ids --sparse --delete --info=stats2 "$source_data/" "$target_data/" > "$checks/final-rsync.log"
rsync -aHAXcn --numeric-ids --delete --itemize-changes "$source_data/" "$target_data/" > "$checks/offline-diff.txt"
if [[ -s "$checks/offline-diff.txt" ]]; then
  echo 'Offline checksum comparison found a difference' >&2
  exit 1
fi
sync -f "$target_data"

echo 'Moving the consistent original snapshot out of the development checkout'
mv "$source_data" "$snapshot"
mv "$repo/ops/minio-lan/.local/minio.env" "$prod/backup/minio.env.original"
mv "$repo/ops/minio-lan/.local/backend-certs" "$prod/backup/backend-certs.original"
mv "$unit" "$prod/backup/minio-lan.service.disabled"
systemctl --user daemon-reload

echo 'Starting the fixed production image'
"$prod/bin/run-minio-prod" > "$checks/container-id"
ready=false
for ((i=0; i<180; i++)); do
  if curl --silent --show-error --fail --max-time 2 -o /dev/null http://127.0.0.1:19000/minio/health/ready 2>/dev/null &&
     curl --silent --show-error --fail --max-time 2 -o /dev/null http://127.0.0.1:19001/ 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.5
done
[[ $ready == true ]]
[[ $(systemctl --user show minio-lan-gateway.service -p MainPID --value) == "$gateway_pid" ]]
[[ $(docker inspect minio-prod --format '{{.State.Running}}') == true ]]
[[ $(docker inspect minio-prod --format '{{.Image}}') == "$(cat "$prod/images/current-image")" ]]

ca=$prod/config/certs/ca.crt
curl --silent --show-error --fail --cacert "$ca" --max-time 10 -o /dev/null https://127.0.0.1:9000/minio/health/ready
curl --silent --show-error --fail --cacert "$ca" --max-time 10 -o /dev/null https://127.0.0.1:9001/
anonymous=$(curl --silent --show-error --cacert "$ca" --max-time 10 -o /dev/null -w '%{http_code}' https://127.0.0.1:9000/)
[[ $anonymous == 403 ]]
GOTOOLCHAIN=local "$repo/.local/toolchains/go/bin/go" run "$repo/ops/minio-lan/container/verify_readonly.go" > "$checks/s3-after.json"
python3 - "$checks/s3-after.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    result = json.load(f)
assert result["consoleLogin"] and result["sampleRead"]
assert result["bucketCount"] > 0 and result["objectCount"] > 0
PY

python3 - "$checks" "$snapshot" "$prod/images/current-image" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
checks, snapshot, image_file = map(pathlib.Path, sys.argv[1:])
result = {
    "verifiedUTC": datetime.now(timezone.utc).isoformat(),
    "imageID": image_file.read_text().strip(),
    "originalDataSnapshot": str(snapshot),
    "offlineChecksumDiffs": 0,
    "before": json.loads((checks / "s3-before.json").read_text()),
    "after": json.loads((checks / "s3-after.json").read_text()),
    "gatewayPIDUnchanged": True,
    "trustedTLSS3AndConsole": True,
}
path = checks / "cutover-result.json"
path.write_text(json.dumps(result, indent=2) + "\n")
path.chmod(0o600)
PY
echo 'Production container passed read-only acceptance; stopping work here'
