FROM registry.cn-hangzhou.aliyuncs.com/migo-dl/node:24-alpine-pnpm-builder AS build

ARG TARGETARCH
ARG GO_DOWNLOAD_BASE=https://dl.google.com/go
RUN case "$TARGETARCH" in \
         amd64) checksum=6842c516ca66c89d648a7f1dbe28e28c47b61b59f8f06633eb2ceb1188e9251d ;; \
         arm64) checksum=38ac33b4cfa41e8a32132de7a87c6db49277ab5c0de1412512484db1ed77637e ;; \
         *) echo "Unsupported Go build architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSL --retry 3 --connect-timeout 15 "$GO_DOWNLOAD_BASE/go1.24.8.linux-$TARGETARCH.tar.gz" -o /tmp/go.tar.gz \
    && printf '%s  /tmp/go.tar.gz\n' "$checksum" | sha256sum -c - \
    && tar -xzf /tmp/go.tar.gz -C /usr/local \
    && rm /tmp/go.tar.gz

ARG GOPROXY=https://proxy.golang.org,direct
ENV PATH=/usr/local/go/bin:$PATH \
    MINIO_GO=/usr/local/go/bin/go \
    GOTOOLCHAIN=local \
    GOPATH=/go \
    CGO_ENABLED=0

WORKDIR /src
COPY go.mod go.sum ./
COPY console-custom/ console-custom/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.yarn/berry/cache \
    bash console-custom/build.sh

ARG MINIO_PREVIOUS_CONSOLE_URL
RUN if [ -n "$MINIO_PREVIOUS_CONSOLE_URL" ]; then \
      node console-custom/preserve-assets.mjs "$MINIO_PREVIOUS_CONSOLE_URL"; \
    fi

COPY . .
ARG MINIO_BUILD_REVISION
ARG MINIO_BUILD_COMMIT_TIME
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    test -n "$MINIO_BUILD_REVISION" && test -n "$MINIO_BUILD_COMMIT_TIME" \
    && ldflags=$(go run buildscripts/gen-ldflags.go) \
    && install -d /runtime/usr/local/bin /runtime/etc/ssl/certs /runtime/usr/share/zoneinfo/Asia \
    && go build -modfile .local/console-build.mod -mod=readonly -tags kqueue -trimpath \
         -ldflags "$ldflags" -o /runtime/usr/local/bin/minio . \
    && install -m 0644 /etc/ssl/certs/ca-certificates.crt /runtime/etc/ssl/certs/ca-certificates.crt \
    && unzip -p /usr/local/go/lib/time/zoneinfo.zip Asia/Shanghai > /runtime/usr/share/zoneinfo/Asia/Shanghai \
    && printf 'minio:x:1000:1000:MinIO:/var/lib/minio:/sbin/nologin\n' > /runtime/etc/passwd \
    && printf 'minio:x:1000:\n' > /runtime/etc/group

FROM scratch

ARG MINIO_BUILD_REVISION
LABEL org.opencontainers.image.revision=$MINIO_BUILD_REVISION
COPY --from=build /runtime/ /

ENV HOME=/var/lib/minio \
    TZ=Asia/Shanghai \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/minio"]
