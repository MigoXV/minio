# MinIO Console 定制

## 2026-10-28 MinIO v2 设计同步

当前实现以 [MinIO v2 设计页](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=173-629) 为准。此前 14 / 20 / 64 / 85 / 104 开头的画板属于旧版，不能用来验收本次实现。

登录后的桌面控制台使用 [48px 共享顶栏](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw/MinIO?node-id=227-607)，工作区左右各留 32px。「访问管理」和「更多」可悬停展开。存储桶列表使用卡片，桶内对象、预览及配置统一归「存储桶」。概览、系统配置和许可证通过「系统管理」页内标签切换。移动端继续使用折叠导航。前端采用 40px 控件、56px 常规表格行、400px 登录表单和媒体预览窗。对象详情侧栏为 320px；音频播放/暂停均为 88×40，时间码固定 216px。页面、弹窗和白垣/苍渊主题复用语义 Token。Inter 沿用现有字体；Noto Sans SC 与 IBM Plex Mono 随前端自托管，许可证位于 `ui/assets/fonts/`。

对象浏览、管理和许可证使用 `BrowserWorkspace.tsx`、`ManagementV2.tsx` 与 `LicenseV2.tsx`。对象预览使用工作区内的 `ObjectPreview.tsx`，支持按当前筛选和排序切换对象。`V2.tsx` / `v2.css` 定义共享控件。现有认证、会话、MinIO S3/Admin 接口和服务端权限检查保持不变。列表使用原有流式 WebSocket 协议，保留子路径权限入口；创建与修改操作使用显式弹窗。未启用版本控制的对象在标签、分享请求中传递接口要求的 `version_id=null`。

音频复用既有 WaveSurfer / FFT 引擎，进入“音频分析”后才创建 Worker。主题选择覆盖当前页面，保留对象、播放时间、音量、倍速、选区和已完成的计算。图片显示实际内容；PDF 可逐页浏览；视频使用独立播放控制。设计稿示例名称、日期、图形及测量值由真实对象数据替代。

本轮仅修改前端及前端构建/验收脚本，不修改后端源码、接口、数据目录或依赖版本。可在现有隔离测试实例执行：

```bash
MINIO_TEST_S3=http://127.0.0.1:19100 MINIO_TEST_ENV=.local/design-sync-test/env node console-custom/test-v2.mjs http://127.0.0.1:19101
MINIO_TEST_S3=http://127.0.0.1:19100 MINIO_TEST_CONSOLE=http://127.0.0.1:19101 MINIO_TEST_ENV=.local/design-sync-test/env node console-custom/test-v2-media.mjs
node console-custom/test-management.mjs http://127.0.0.1:19100 http://127.0.0.1:19101 .local/design-sync-test/env
```

`test-v2.mjs` 校验真实上传、重试、分享下载、标签、版本恢复、IAM 管理、双主题、控件几何和权限；截图及报告位于 `.local/figma-v2/acceptance/`。`test-v2-media.mjs` 补充频谱能量、Worker 生命周期、缩放同步、损坏和超限文件验证。两个脚本均限制为回环隔离实例。下方 10 月 23 日内容保留为历史说明，其旧画板编号和控件尺寸不适用于 v2。

## 2026-10-23 设计同步

同步当前 Figma 的单栏登录、共享字段、连续管理表格、对象详情操作和预览容器。登录、校验失败及提交中使用同一 330px 表单，按钮下预留 44px 反馈区；凭据错误与服务故障分别提示。登录与管理字段桌面为 32px 高、2px 圆角，窄屏管理页沿用较大的操作热区。主题仍共享既有语义颜色。

播放和暂停共用固定 88×32 控件及 16×16 图标槽，时间码使用等宽数字。关闭入口为带可访问名称的图标按钮；主按钮悬停保持主题配色。许可证页仅同步布局和主题角色，沿用现有产品与许可内容。

`login/` 是固定 Console 登录页的受版本控制源码，由 `prepare.mjs` 每次复制到工作区；认证继续使用原有 API、会话与重定向。不修改上游依赖缓存。新增登录错误映射单元测试和完整设计截图验收：

```bash
node console-custom/test-design-sync.mjs http://127.0.0.1:19100 http://127.0.0.1:19101 .local/design-sync-test/env
MINIO_TEST_S3=http://127.0.0.1:19100 MINIO_TEST_CONSOLE=http://127.0.0.1:19101 MINIO_TEST_ENV="$PWD/.local/design-sync-test/env" node console-custom/test-preview.mjs
```

设计验收只允许显式指定的回环测试实例，截图和报告保存在 `.local/design-sync-test/screenshots/`。音频回归可用 `TEST_FFMPEG` 生成格式样本，也会复用 `.local/audio-tests/` 中已生成的样本；运行时不依赖 FFmpeg。生产小范围验收默认从现有生产 secrets 读取凭据，也可显式传入 `MINIO_TEST_ENV`；秘密值不写入测试输出。

## 管理工作区（已上线首批）

`/manage` 提供系统概览、存储桶配置、用户、组、策略、我的访问密钥和只读系统配置字段目录。用户、组、策略与服务账号通过同源 `/api/v1/manage/*` 接口访问；Console 使用现有会话的 STS 凭据调用 MinIO Admin/S3 API。浏览器不持有 root 密钥，列表不返回用户或服务账号秘密值；创建访问密钥时只回显一次。写请求要求同源 `Origin`，实际操作再次由 MinIO 权限校验。配置目录只读取 help 元数据，不回显当前密钥字段值。接口契约见 [`management-openapi.yaml`](management-openapi.yaml)，完整实施状态见 [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md)。

当前运行版的七个页面已同步至 [Figma 管理工作区](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=104-921)，每页有白垣和苍渊两种可编辑画板。画板全部使用示例数据。

## 音频对象预览

在现有 MinIO Console 的对象预览窗口中增加波形播放器和按需频谱图。支持浏览器可解码的 WAV、MP3、FLAC、OGG/Opus、M4A/AAC；打开预览不自动播放，可以点击波形定位、调节音量和倍速。

频谱默认折叠，首次展开才下载插件代码、创建 FFT Worker 并计算。采用 Hann 窗、1024 点 FFT、75% 重叠，默认显示第一声道。复用波形的解码数据，使用 48 kHz 分析采样率，声谱图默认显示到 8 kHz。播放仍使用原始音频。收起已完成的图时缓存结果；计算期间收起或关闭窗口会终止 Worker。关闭窗口后释放本次预览资源。

## 资源与权限

- 完整分析限制：对象不超过 64 MiB，时长不超过 10 分钟；解码后 PCM 不超过 128 MiB。解码本身仍需要浏览器分配临时内存，此限制不是浏览器内存用量的硬上限。
- 超限、解码失败或浏览器缺少编码支持时，保留普通播放及下载，并显示原因。
- 使用原有登录会话及受权限检查的对象下载接口；保留原有对象版本参数。音频和分析结果不发送到外部服务，不引入服务端转码任务。
- `browser.env` 提供使用本地音频 Blob、Worker 和画布图像所需的 CSP。部署脚本先载入它，再载入私密账户配置，因此显式设置的私密 CSP 仍有最终优先权；自定义策略需要允许这些本地资源。

## 可重复构建

生产镜像的 Go 和前端都在 Docker 内编译，命令见[容器发布说明](../ops/minio-lan/container/README.md)。下方命令用于需要单独输出本地候选二进制的开发场景。

```bash
MINIO_PREVIOUS_CONSOLE_URL=http://127.0.0.1:19001/ bash console-custom/build-candidate.sh
```

构建绑定现有 Console `v1.7.7-0.20250905210349-2017f33b26e1`，从 Go 依赖缓存复制到 `.local/console-workspace`，应用本目录补丁与源码，再以 Yarn 4.9.4 和锁文件构建。通过 `.local/console-build.mod` 将前端静态资源嵌入 MinIO，不修改原依赖缓存或根模块依赖版本。上游版本变化时会停止，要求先复核补丁。

原 `minio/mds` 下载地址已不可用。此锁文件通过 `bexsoft/mds` 镜像获取**相同 Git 提交** `400914d72cb3ffa27d600e0ae1f17ece2182ec22` 的 MDS 1.1.5；没有切换到镜像的新版本。依赖及原项目许可证均保持不变。

使用 WaveSurfer.js 7.10.1。`patch-spectrogram.mjs` 以该版本发布文件的 SHA256 校验为前提，修正频谱容器被忽略、计算取消后回调继续绘制及超时句柄残留的问题。修补只发生在本地工作目录的 ESM 文件，npm 缓存不变；发布文件变化时构建拒绝继续。

当前生产后端以固定镜像容器运行，HTTPS 网关仍是独立用户服务。`browser.env` 中的 CSP 规则已纳入生产运行配置；部署新镜像时保持原有私密运行文件和数据挂载，不从开发仓库读取账户密码。

## 验证

单元测试在准备好的前端工作目录中执行：

```bash
cd .local/console-workspace/web-app
CI=true node ../../console-tools/node_modules/@yarnpkg/cli-dist/bin/yarn.js test audioAnalysis.test.ts --watchAll=false --runInBand
```

`test-preview.mjs` 默认连接隔离实例：S3 为回环端口 19010，控制台为回环端口 19011；凭据从现有私密账户文件读取。它会新建独立的测试桶，结束时清理自己的对象、历史版本和桶，不操作其他数据。可通过 `MINIO_TEST_S3`、`MINIO_TEST_CONSOLE`、`MINIO_TEST_ENV` 和 `MINIO_TEST_BROWSER` 指定实例、账户文件及浏览器。

```bash
TEST_FFMPEG=<LOCAL_TEST_FFMPEG> node console-custom/test-preview.mjs
```

FFmpeg 仅用于在测试中将生成的 1 kHz WAV 转换为其他格式，不是应用运行依赖。测试验证播放、定位、懒加载、频谱峰值、缓存、计算中取消和重试、损坏及超限音频、权限错误，以及图片/PDF/视频预览。截图和记录保存在被 Git 忽略的 `.local/audio-tests/`。

## Figma 工作区同步

设计来源：MinIO 控制台归档，文件 `GM2b1hNNlKvKUxanutF1kw`。实现对象浏览、对象详情、音频试听、音频分析和外观主题；设计画板中的文件名、音频图形和测量值均由实际数据提供。

- 白垣 / 苍渊共享布局和语义颜色，默认跟随系统；偏好保存在浏览器 `minio-appearance` 中。首次绘制前解析主题，切换保留播放、选区和已完成的分析。
- 音频分析的波形与频谱共用一条时间滑轨，放大后可拖动滑块平移。拖出选区松手后从起点播放，默认到终点暂停，开启循环后重复播放。可缩放至选区、滚轮缩放及恢复全段。分析默认 FFT 1024、汉宁窗、75% 重叠；可选 FFT 512/1024/2048、汉宁/海明窗、50%/75% 重叠。改变参数会取消旧任务并重新计算。
- 图形使用解码后的 48 kHz PCM。声谱图显示上限为 8 kHz 或分析缓冲区的奈奎斯特频率，取较低值。100 Hz 以下保留压缩的线性刻度，以上采用对数刻度。颜色表示相对能量。
- `ui/` 存放主题、组件和从设计下载的图标，`patches/figma-workspace.patch` 接入固定版本 Console；`prepare.mjs` 每次从原模块恢复全部补丁目标再应用两个补丁。Go 模块缓存与根依赖文件保持原样。

### 已运行实例的候选发布

按[容器发布说明](../ops/minio-lan/container/README.md)构建并手动打 tag。

```bash
# 先用独立数据目录与合成账户在 19100/19101 验证：
node console-custom/test-management.mjs http://127.0.0.1:19100 http://127.0.0.1:19101 .local/management-test/env
# 验证后把测试容器停掉，再执行：
bash ops/minio-lan/container/promote-candidate.sh registry.cn-hangzhou.aliyuncs.com/migo-dl/minaio:0.2.0a2-amd64
```

将 `MINIO_PREVIOUS_CONSOLE_URL` 设为构建容器可达的控制台地址，可保留上一版静态资源供已打开的标签页加载。`promote-candidate.sh` 先记录只读 S3 清单，只停后端容器、保留网关 PID，再用新镜像启动同一数据挂载；健康、HTTPS 与清单校验失败时自动启动旧容器。旧镜像和停机容器保留，测试实例绝不能与生产共享数据。原 `console-custom/deploy.mjs` 面向旧的主机 systemd 部署，不应用于当前容器生产服务。

单元测试增加 `ui/analysisView.test.ts`，浏览器测试覆盖主题保存/系统变化、选区与双图缩放、循环、FFT 参数、1280×720 与窄屏，以及原有音频和非音频回归。
