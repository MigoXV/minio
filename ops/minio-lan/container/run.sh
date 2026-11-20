#!/usr/bin/env bash
set -euo pipefail

prod=${MINIO_PROD_DIR:-$HOME/.local/share/minio-prod}
if [[ $(id -u) != 1000 ]]; then
  echo 'This image and its data mounts require UID 1000' >&2
  exit 1
fi
read -r image < "$prod/images/current-image"
docker image inspect "$image" >/dev/null

exec docker run --detach \
  --name minio-prod \
  --restart unless-stopped \
  --stop-timeout 60 \
  --network host \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --ulimit nofile=65536:65536 \
  --mount "type=bind,src=$prod/data,dst=/data" \
  --mount "type=bind,src=$prod/home,dst=/var/lib/minio" \
  --mount "type=bind,src=$prod/backend-certs,dst=/certs,readonly" \
  --mount "type=bind,src=$prod/config,dst=/etc/minio,readonly" \
  --mount "type=bind,src=$prod/secrets,dst=/run/secrets,readonly" \
  --env MINIO_CONFIG_ENV_FILE=/etc/minio/runtime.env \
  --env MINIO_ROOT_USER_FILE=root-user \
  --env MINIO_ROOT_PASSWORD_FILE=root-password \
  "$image" server \
  --address 127.0.0.1:19000 \
  --console-address 127.0.0.1:19001 \
  --certs-dir /certs \
  /data
