#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
local_dir=$repo/ops/minio-lan/.local
for file in "$repo/.local/minio" "$repo/.local/minio-lan-gateway" "$local_dir/minio.env" "$local_dir/gateway.json"; do
  [[ -f "$file" ]] || { echo "Missing local deployment file: $file" >&2; exit 1; }
done
# Unit files have systemd-specific escaping rules. Reject unsupported paths.
if [[ "$repo" =~ [[:space:]%] ]]; then echo 'Repository path must not contain whitespace or %' >&2; exit 1; fi
umask 077
mkdir -p "$local_dir/data" "$local_dir/backend-certs" "$HOME/.config/systemd/user"
chmod 700 "$local_dir" "$local_dir/data" "$local_dir/backend-certs"
chmod 600 "$local_dir/minio.env" "$local_dir/gateway.json"
cat > "$HOME/.config/systemd/user/minio-lan.service" <<EOF
[Unit]
Description=MinIO from the existing local source checkout
After=network-online.target

[Service]
WorkingDirectory=$repo
EnvironmentFile=$repo/console-custom/browser.env
EnvironmentFile=$local_dir/minio.env
ExecStart=$repo/.local/minio server --address 127.0.0.1:19000 --console-address 127.0.0.1:19001 --certs-dir $local_dir/backend-certs $local_dir/data
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
UMask=0077
NoNewPrivileges=true
LimitNOFILE=65536

[Install]
WantedBy=default.target
EOF
cat > "$HOME/.config/systemd/user/minio-lan-gateway.service" <<EOF
[Unit]
Description=MinIO LAN TLS and source-network access control
Wants=minio-lan.service
After=minio-lan.service network-online.target

[Service]
WorkingDirectory=$repo
ExecStart=$repo/.local/minio-lan-gateway -config $local_dir/gateway.json
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
LimitNOFILE=65536

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now minio-lan.service minio-lan-gateway.service
systemctl --user --no-pager --full status minio-lan.service minio-lan-gateway.service
