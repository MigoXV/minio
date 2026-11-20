#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
export MINIO_GO=${MINIO_GO:-$repo/.local/toolchains/go/bin/go}
export GOTOOLCHAIN=local
umask 077
yarn_bin=$repo/.local/console-tools/node_modules/@yarnpkg/cli-dist/bin/yarn.js
if [[ ! -f "$yarn_bin" ]]; then
  npm install --prefix "$repo/.local/console-tools" --no-audit --no-fund @yarnpkg/cli-dist@4.9.4
fi
node console-custom/prepare.mjs
cd "$repo/.local/console-workspace/web-app"
# Yarn does not inherit the conventional HTTP(S)_PROXY names on its own.
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then export YARN_HTTPS_PROXY="${HTTPS_PROXY:-$https_proxy}"; fi
if [[ -n "${HTTP_PROXY:-${http_proxy:-}}" ]]; then export YARN_HTTP_PROXY="${HTTP_PROXY:-$http_proxy}"; fi
node "$yarn_bin" install --immutable
node "$repo/console-custom/patch-spectrogram.mjs"
GENERATE_SOURCEMAP=false node "$yarn_bin" build
