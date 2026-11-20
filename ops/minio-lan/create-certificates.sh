#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 ]]; then echo "Usage: $0 <service IP or DNS name> [additional service IPs/DNS names]" >&2; exit 1; fi
script_dir=$(cd "$(dirname "$0")" && pwd)
cert_dir=$script_dir/.local/certs
umask 077
mkdir -p "$cert_dir"
chmod 700 "$cert_dir"
if [[ -e "$cert_dir/server.key" || -e "$cert_dir/server.crt" ]]; then
  echo 'Existing server certificate found; inspect it before replacing or renewing it.' >&2
  exit 1
fi
san='DNS:localhost,IP:127.0.0.1,IP:::1'
for address in "$@"; do
  if [[ ! "$address" =~ ^[A-Za-z0-9.:-]+$ ]]; then echo 'Invalid certificate name' >&2; exit 1; fi
  if [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$address" == *:* ]]; then
    san+=",IP:$address"
  else
    san+=",DNS:$address"
  fi
done
if [[ ! -f "$cert_dir/ca.key" ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.crt" -subj '/CN=Local Storage LAN CA' \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
fi
openssl req -new -newkey rsa:3072 -nodes -sha256 -keyout "$cert_dir/server.key" \
  -out "$cert_dir/server.csr" -subj '/CN=Storage LAN'
cat > "$cert_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
openssl x509 -req -in "$cert_dir/server.csr" -CA "$cert_dir/ca.crt" -CAkey "$cert_dir/ca.key" \
  -CAcreateserial -out "$cert_dir/server.crt" -days 365 -sha256 -extfile "$cert_dir/server.ext"
openssl verify -CAfile "$cert_dir/ca.crt" "$cert_dir/server.crt"
openssl x509 -in "$cert_dir/server.crt" -noout -dates -ext subjectAltName
