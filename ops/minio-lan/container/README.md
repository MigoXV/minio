# Production MinIO image boundary

Build the production image from the current Git commit. Run these commands from the repository root.

```bash
revision=$(git rev-parse HEAD)
image_id_file=$(mktemp)
git archive "$revision" | docker buildx build \
  --file ops/minio-lan/container/Dockerfile \
  --platform linux/amd64 --load --provenance=false --sbom=false \
  --build-arg "MINIO_BUILD_REVISION=$revision" \
  --build-arg "MINIO_BUILD_COMMIT_TIME=$(git show -s --format=%cI "$revision")" \
  --iidfile "$image_id_file" -
docker image tag "$(cat "$image_id_file")" registry.cn-hangzhou.aliyuncs.com/migo-dl/minaio:0.2.0a2-amd64
rm "$image_id_file"
```

The Dockerfile compiles the Console and Go server using
`registry.cn-hangzhou.aliyuncs.com/migo-dl/node:24-alpine-pnpm-builder`.
It checks the Go 1.24.8 archive against the upstream SHA-256 and uses the Console's Yarn lockfile.
The final `scratch` image contains the statically linked binary, the builder's public CA bundle,
Shanghai timezone data from Go, and a UID 1000 account. Git supplies the committed source, revision and date.
Keep private runtime files and object data outside this development checkout.

Tag each release manually under `registry.cn-hangzhou.aliyuncs.com/migo-dl/minaio`.
The `-amd64` suffix identifies the platform. The build disables BuildKit provenance and SBOM
attachments for registry compatibility. Publishing is a separate `docker push`.

Optional build arguments include `GO_DOWNLOAD_BASE` and `GOPROXY` for Go mirrors and
`MINIO_PREVIOUS_CONSOLE_URL` for preserving earlier Console assets from a reachable instance.
For a proxy listening on the Docker host's loopback, add `--network host --allow network.host`
and `--build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY` on a local Linux builder.

The production container uses host networking so its two backend listeners
remain on 127.0.0.1:19000 and 127.0.0.1:19001. The existing HTTPS gateway
continues to serve the LAN on ports 9000 and 9001. Mount the production data
directory at `/data`, writable MinIO home at `/var/lib/minio`, certificate
directory at `/certs`, non-secret MinIO config at `/etc/minio/runtime.env`,
and root credential files under `/run/secrets`. Set
`MINIO_CONFIG_ENV_FILE`, `MINIO_ROOT_USER_FILE`, and
`MINIO_ROOT_PASSWORD_FILE` to those mounted paths (the credential file
variables use basenames relative to `/run/secrets`). Use Docker's
`unless-stopped` restart policy; do not also run the old MinIO systemd unit.

Before any switch, test the image against an empty isolated data directory.
For migration, pre-copy live data, stop the old server, perform and verify a
final offline sync, and preserve the original directory as a cold snapshot.
`cutover-once.sh` performs that final sync, removes the old service, starts
the fixed image and runs read-only acceptance. It is deliberately one-shot:
it refuses to replace an existing production container.
If the container fails validation, stop it before starting the preserved host
binary against the *new* production data directory. The old snapshot is not a
rollback target after the container has accepted writes.

For subsequent UI or server releases, run the built image against an isolated empty data directory and
synthetic credentials, and run `console-custom/test-management.mjs` plus a
browser smoke test. Stop that test container before promotion. Then run
`bash ops/minio-lan/container/promote-candidate.sh <verified-image>`.
The promotion script records a read-only inventory, keeps the HTTPS gateway
active, swaps only the backend container, checks both ports and the inventory,
and restores the stopped previous container if validation fails. It retains
the previous image/container for manual rollback after a successful release.
