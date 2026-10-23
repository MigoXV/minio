#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
export MINIO_GO=${MINIO_GO:-$repo/.local/toolchains/go/bin/go}
export GOTOOLCHAIN=local
umask 077
bash console-custom/build.sh
if [[ -n "${MINIO_PREVIOUS_CONSOLE_URL:-}" ]]; then
  node console-custom/preserve-assets.mjs "$MINIO_PREVIOUS_CONSOLE_URL"
fi
candidate=${MINIO_CANDIDATE:-$repo/.local/minio-figma-candidate}
if [[ "$(realpath -m "$candidate")" == "$repo/.local/minio" ]]; then
  echo 'Candidate output must not be the live binary' >&2
  exit 1
fi
ldflags=$("$MINIO_GO" run buildscripts/gen-ldflags.go)
CGO_ENABLED=0 "$MINIO_GO" build -modfile .local/console-build.mod -mod=readonly -tags kqueue -trimpath -ldflags "$ldflags" -o "$candidate" .
sha256sum "$candidate"
