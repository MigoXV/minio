FROM scratch

# The build context contains a verified, statically linked MinIO binary. The
# deployment script records its digest before promoting a new image.
COPY --chmod=0755 minio /usr/local/bin/minio
# Docker creates otherwise missing parent directories using the COPY mode.
# Seed these trees with searchable permissions before placing readable files.
COPY --chmod=0755 ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=0644 ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=0755 Shanghai /usr/share/zoneinfo/Asia/Shanghai
COPY --chmod=0644 Shanghai /usr/share/zoneinfo/Asia/Shanghai
COPY --chmod=0644 passwd /etc/passwd
COPY --chmod=0644 group /etc/group

ENV HOME=/var/lib/minio \
    TZ=Asia/Shanghai \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/minio"]
