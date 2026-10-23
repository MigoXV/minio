#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
export GOTOOLCHAIN=local
go_bin=${MINIO_GO:-$repo/.local/toolchains/go/bin/go}
if [[ ! -x "$go_bin" ]]; then go_bin=$(command -v go); fi
export MINIO_GO="$go_bin"
umask 077
mkdir -p .local
bash console-custom/build.sh
ldflags=$("$go_bin" run buildscripts/gen-ldflags.go)
CGO_ENABLED=0 "$go_bin" build -modfile .local/console-build.mod -mod=readonly -tags kqueue -trimpath -ldflags "$ldflags" -o .local/minio .
CGO_ENABLED=0 "$go_bin" build -mod=readonly -trimpath -o .local/minio-lan-gateway ./ops/minio-lan/gateway
CGO_ENABLED=0 "$go_bin" build -mod=readonly -trimpath -o .local/minio-lan-verify ./ops/minio-lan/verify
.local/minio --version
sha256sum .local/minio .local/minio-lan-gateway .local/minio-lan-verify > .local/build.sha256
