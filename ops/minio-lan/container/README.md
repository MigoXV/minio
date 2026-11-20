# Production MinIO image boundary

This Dockerfile packages a verified, statically linked binary. The build context must contain that binary,
the host CA bundle and timezone file, and passwd/group entries for UID 1000.
It deliberately contains no object data, credentials, certificates or LAN
addresses. Keep the image archive, private runtime files and object data
outside this development checkout.

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

For subsequent UI or server releases, build a new immutable image from the
candidate binary, run it first against an isolated empty data directory and
synthetic credentials, and run `console-custom/test-management.mjs` plus a
browser smoke test. Stop that test container before promotion. Then run
`bash ops/minio-lan/container/promote-candidate.sh <verified-image>`.
The promotion script records a read-only inventory, keeps the HTTPS gateway
active, swaps only the backend container, checks both ports and the inventory,
and restores the stopped previous container if validation fails. It retains
the previous image/container for manual rollback after a successful release.
