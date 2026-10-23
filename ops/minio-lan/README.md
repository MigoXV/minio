# MinIO 内网部署

本目录保存开发构建、容器镜像定义、HTTPS 网关源码和验证工具。生产 MinIO 由固定镜像运行；生产数据、凭据、配置、镜像归档及网关运行文件均位于仓库外的 `~/.local/share/minio-prod/`。本仓库不再是生产服务的运行目录。镜像切换与回退约定见 [`container/README.md`](container/README.md)。路由器管理能力独立位于 [`../huawei-router/SKILL.md`](../huawei-router/SKILL.md)，不包含应用部署逻辑。

控制台包含音频波形播放器及按需展开的频谱图，实现与前端构建说明见 [`console-custom`](../../console-custom/README.md)。

开发测试的真实地址、口令和数据须放在被 Git 忽略的 `.local/` 目录；生产运行资料保存在上述仓库外目录。模板只含占位符。迁移前的部署记录仍见 [本地部署结果](.local/RESULTS.md)。

## 结构和访问控制

| 服务 | 对内监听 | LAN HTTPS 入口 |
| --- | --- | --- |
| S3 API | `127.0.0.1:19000` | `https://<ROUTER_WAN_IP>:9000` |
| 内置 Web 控制台 | `127.0.0.1:19001` | `https://<ROUTER_WAN_IP>:9001` |

路由器将这两个 TCP 端口转发到当前 Wi-Fi 主机相同端口。HTTPS 网关只接受配置中的私有来源网段，并直接检查 TCP 对端地址；客户端伪造的转发头不参与授权。S3 签名所需的 Host、路径和查询参数保持原值，控制台仍要求 MinIO 登录。后端 HTTP 仅监听回环接口。

当前目标是上级内网访问。网关拒绝配置公网来源网段，因此这套部署不能直接用于向公网提供服务。

## 开发构建与生产镜像

从现有仓库构建，不拉取、初始化或覆盖源仓库：

```bash
bash ops/minio-lan/build.sh
```

优先使用仓库本地 `.local/toolchains/go/bin/go`，也可设置 `MINIO_GO` 指向已安装的 Go。当前源代码指定 Go 1.24.8；构建先编译定制前端，再使用仓库已有的版本元数据生成器和 `kqueue` 标签。根 `go.mod/go.sum` 保持不变，本地临时模块文件替换 Console 以嵌入新界面。需要 Node.js 22 和可访问依赖源的网络；Yarn 版本由脚本固定。产物位于仓库根目录 `.local/`，摘要写入 `.local/build.sha256`。

开发测试可将三个模板 `minio.env.example`、`gateway.example.json`、`router.example.json` 复制到本目录 `.local/` 并填写占位符。不要运行 `install-services.sh` 来更新已容器化的生产实例；它只描述旧的主机进程部署方式。私密目录权限为 `0700`，配置文件权限为 `0600`。

镜像使用生产进程原二进制，而不是开发目录中后来生成的程序。Docker 负责 MinIO 容器自启；现有 HTTPS 网关仍由当前用户的 systemd 管理，user linger 已开启。日常只读检查：

```bash
docker ps --filter name=minio-prod
docker logs --tail 50 minio-prod
systemctl --user status minio-lan-gateway.service
journalctl --user -u minio-lan-gateway.service -n 50
```

网关证书和配置更新后才需要重启网关。管理员凭据为生产目录中的只读 secret 文件，不进入镜像、Git 或 Docker 环境变量；数据通过宿主目录挂载，不随容器删除。切换前旧数据目录作为仓库外的冷快照保留。

## 路由器规则与验证

本目录的 `router.example.json` 表达应用所需的两条映射；通用路由器 Skill 接收这份外部配置，业务配置不进入 Skill。查看计划和按需应用：

```bash
node ops/huawei-router/scripts/router.mjs plan --config ops/minio-lan/.local/router.json
node ops/huawei-router/scripts/router.mjs apply --config ops/minio-lan/.local/router.json
```

应用会保留已有规则，并在私密目录记录快照和创建资源清单。同样配置重复执行时复用现有规则。路由器 WAN 地址当前为静态配置；如果上级网络以后修改此地址，需要相应更新证书、控制台跳转地址和客户端入口。

```bash
GOTOOLCHAIN=local .local/toolchains/go/bin/go run ./ops/minio-lan/container/verify_readonly.go
```

该只读验证器从仓库外读取凭据，检查 S3/Console、对象清单并读取一个样本对象，不修改存储数据。HTTPS 网关另行做 TLS 与端口健康检查。旧 `verify/main.go` 会临时写入测试对象，只用于隔离实例。

开发验证：

```bash
node --test ops/huawei-router/scripts/router.test.mjs
go test -race ./ops/minio-lan/gateway
```
