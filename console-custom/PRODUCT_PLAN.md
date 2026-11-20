# MinIO 控制台产品规划（基于当前后端）

状态：**产品规划与实施跟踪**。审计日期：2026-10-23。首批管理工作区已编译并部署到固定镜像；完整页面清单中的其余流程仍按下表标记推进。当前 Figma 已上线设计页：[11 · 当前版管理工作区](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=104-921)，包含七个页面、白垣与苍渊两套可编辑画板，使用示例数据。

## 1. 核对结论与产品边界

| 层 | 当前事实 | 对界面的影响 |
| --- | --- | --- |
| 运行服务 | 单个 MinIO 进程、单个数据目录；内置 Console 和 HTTPS 网关正在运行 | 默认按单实例设计。集群池、再平衡等功能必须先检测运行模式，再决定是否显示。 |
| 当前前端 | 新增 `/manage` 工作区，提供概览、存储桶配置、用户、组、策略、我的访问密钥和配置字段目录；原对象浏览与许可证继续运行 | 已上线入口由实际会话授权决定；其余表中待建流程尚无可用页面，不应画成当前版本。 |
| Console HTTP API | 固定版本 Swagger 仍有 **21 条路径、25 个操作**；`console-custom/server/manage.go` 新增同源会话保护的管理路由 | 已落地用户、组、策略、本人服务账号、桶策略/版本、配置 help 与概览；生命周期、配置写入等仍需逐项扩展。 |
| MinIO 服务端 | `cmd/admin-router.go` 保留用户、组、策略、服务账号、配置 KV/历史、监控等管理 API；`cmd/api-router.go` 保留桶策略、生命周期、加密、版本、通知、复制、对象保留等 S3 API | 可在不降级服务端的情况下逐项补管理流程，但每项都要做服务端权限校验和能力探测。 |
| 不能误用的端点 | 当前源码把桶和对象的 ACL、桶 CORS 等部分 S3 入口标成 dummy call | 不设计可写的 ACL/CORS 页面，也不把 dummy 返回当作真实配置。 |

社区版管理 UI 的移除是上游产品变化；MinIO 维护者确认管理 API 仍在：[官方仓库说明](https://github.com/minio/minio/issues/21317)。本规划只以**本仓库的服务端源码与固定 Console 版本**作为具体实现依据，不把其他产品线的界面功能视为当前已有能力。

## 2. 用户、任务与导航

用户不是固定角色名，而是按实际授权展示能力。对象操作员要快速浏览、上传、下载、预览和查版本；桶管理员要管理公开访问、版本、保留、生命周期、容量与通知；身份管理员要管理用户、组、策略和应用密钥；系统管理员要查看健康、编辑被支持的服务端配置；审计人员只读查看状态、日志和配置。一个人可兼任多种职责。

建议导航保持两层：

```text
概览                      /overview
数据
  对象浏览                /browser[/<bucket>/<path>]
  存储桶                  /buckets[/<bucket>/<tab>]
访问控制
  用户                    /access/users[/<user>]
  组                      /access/groups[/<group>]
  策略                    /access/policies[/<policy>]
  访问密钥                /access/keys[/<key>]
系统
  配置                    /settings/<category>[/<target>]
  事件目标                /settings/event-targets[/<target>]
  监控                    /monitoring/<view>
  诊断                    /diagnostics/<view>
底部：账户与外观、文档、许可证、退出登录
```

侧栏只显示当前会话有权读取的入口；无权写入时仍可在具备读权限的页面查看，但按钮禁用并说明所需操作。深链接由路由本身再次授权，不能只靠侧栏隐藏。当前浏览器页面继续保留存储桶快捷列表；新增「存储桶」是配置工作区，不替换对象浏览。

## 3. 完整页面与状态清单

标记：**现有**＝当前构建可用；**扩展**＝保留页面并补状态；**待建**＝当前 Console 没有该页面/接口。P0 是恢复日常管理的首批交付，P1 是常用配置，P2 是条件性高级能力。下表的 API 族来自本仓库的 S3/Admin 路由与固定 Console Swagger；前端接入仍需逐项验证返回模型和权限。

| ID | 页面或关键流程 | 状态 / 用户要完成的任务 | 后端依据 | 优先级 |
| --- | --- | --- | --- | --- |
| A01 | 登录、登出、会话过期 | 账号密码、错误、加载、无权、重新登录；不泄露账号是否存在 | Console `login`、`logout`、`session` | 现有 / P0 完善 |
| A02 | 账户与外观 | 当前身份、会话状态、浅/深/跟随系统、退出；当前不承诺改 root 密码 | Console `session`；本地主题偏好 | 扩展 P0 |
| A03 | 权限不足、404、服务不可用 | 精确说明不可访问的页面或操作，保留返回入口 | 当前前端路由与 API 错误 | 扩展 P0 |
| D01 | 对象浏览总览 | 桶列表、筛选、空态、加载、无权限、错误 | Console `GET /buckets` | 现有 |
| D02 | 桶内对象列表 | 路径、搜索、分页/流式加载、排序、紧凑度、选中与批量操作 | Console 对象列表 + WebSocket | 现有 / P0 完善 |
| D03 | 上传与任务列表 | 文件/目录上传、进度、取消、失败重试、权限不足 | Console `objects/upload` | 现有 / P1 完善 |
| D04 | 对象详情 | 元数据、标签、版本、保留状态、下载/分享/删除 | Console 对象元数据、标签、版本 | 现有 |
| D05 | 对象预览 | 浏览器支持的图片、PDF、视频、音频；不支持格式可下载 | 当前预览代码和受权下载 | 现有 |
| D06 | 音频试听与分析 | WAV/MP3 等波形、按需频谱、计算/超限/失败状态 | 当前浏览器端实现 | 现有 |
| D07 | 对象版本与恢复 | 版本列表、删除标记、指定版本预览/下载、恢复确认 | Console 列表、恢复 | 现有 / P1 完善 |
| D08 | 分享链接 | 期限、有效性说明、复制、失效；默认不展示真实链接在设计稿 | Console `objects/share` | 现有 |
| D09 | 对象标签与保留 | 添加/删除标签；保留期限/Legal Hold 只在服务端能力及授权成立时出现 | Console 标签；S3 保留/Legal Hold | 现有标签 / P2 保留 |
| D10 | 新建路径与批量操作 | 新建路径、批量下载/删除、失败项汇总、危险操作确认 | Console 上传/批量下载/删除 | 现有 / P1 完善 |
| D11 | 文本文件预览 | 对 UTF-8 文本/JSON/日志提供大小限制、编码提示和只读展示 | 需新增受权下载与文本渲染 | 待建 P2 |
| B01 | 存储桶列表 | 名称与配置入口已上线；用量和筛选待补 | Console 桶列表/信息；Admin 用量 | 部分上线 P0 |
| B02 | 创建存储桶 | 名称校验；版本/锁定选项须在创建前明确依赖关系和不可逆后果 | Console 建桶；S3 版本/锁定 | 现有基础弹窗 / P1 扩展 |
| B03 | 桶概览 | 访问类型、版本、锁定、加密、配额、用量和最近操作入口 | Console 桶信息/版本/配额；S3 设置 | 待建 P0 |
| B04 | 桶访问/公开策略 | JSON 读取/编辑/移除已上线；可视化公开范围预览待补 | S3 Get/Put/DeleteBucketPolicy | 部分上线 P0 |
| B05 | 桶版本控制 | 查看、启用/暂停、影响说明已上线；锁定关系说明待补 | Console 版本 API；S3 Versioning | 部分上线 P0 |
| B06 | 桶配额 | 查看、设置/取消配额，预估是否已超限 | Console Quota；Admin bucket quota | 待建 P1 |
| B07 | 生命周期 | 规则列表、前缀/标签条件、过期/非当前版本/中止不完整上传、预览匹配范围 | S3 BucketLifecycle | 待建 P1 |
| B08 | 桶加密 | 当前默认加密、可用 KMS 与密钥验证；无 KMS 时解释不可用 | S3 BucketEncryption；Admin KMS status | 待建 P1，能力门控 |
| B09 | 对象锁定/默认保留 | WORM 模式、期限、现有配置、删除限制；只有被服务端支持时可编辑 | S3 BucketObjectLock、对象保留 | 待建 P1，能力门控 |
| B10 | 桶事件通知 | 规则、事件、过滤前缀/后缀、目标健康；先配置目标再可绑定 | S3 BucketNotification；Admin ConfigKV | 待建 P1 |
| B11 | 桶标签 | 查看、编辑键值，避免与对象标签混淆 | S3 BucketTagging | 待建 P1 |
| B12 | 桶复制 | 源/目标、规则、状态、失败重试；版本前置条件、远端凭据 | S3 Replication；Admin remote targets | 待建 P2，能力门控 |
| B13 | 删除存储桶 | 显示对象/版本/保留状态；只允许真正空桶普通删除；危险操作单独确认 | S3 DeleteBucket | 待建 P1 |
| I01 | 用户列表 | 搜索、状态、来源、本地/外部身份区分 | Admin list-users | 部分上线 P0 |
| I02 | 新建/编辑用户 | 本地用户名、初始密码、启停、重置；外部身份禁止在此编辑 | Admin add-user、user-info、set-user-status | 部分上线 P0 |
| I03 | 用户详情 | 直接/组继承策略、所属组、服务账号、操作记录；禁用/删除前展示影响 | Admin user-info、policy-entities、groups、access keys | 待建 P0 |
| I04 | 组列表与详情 | 成员、附加策略、启停、删除前依赖检查 | Admin groups、group、update-group-members、set-group-status | 部分上线 P0 |
| I05 | 策略列表与详情 | 内置/自定义区分、JSON 只读查看、关联主体、版本/差异 | Admin list/info canned policies、policy-entities | 部分上线 P0 |
| I06 | 策略编辑器 | 常用「桶只读/读写/指定前缀」向导 + JSON 高级编辑；本地校验与服务端验证 | Admin add/remove policy、attach/detach | 部分上线 P0 |
| I07 | 访问密钥列表 | 自有密钥优先；具备管理员授权后才可看其他用户；状态、到期、名称与说明 | Admin list/info access keys、service accounts | 部分上线 P0 |
| I08 | 创建/轮换访问密钥 | 默认生成、可缩小权限、一次性展示 secret、复制后关闭；轮换先新建后旧密钥停用 | Admin add/update/delete service account | 部分上线 P0 |
| I09 | 权限检查说明 | 展示会话动作与页面缺少的 action；不承诺通用 IAM 策略模拟器 | Console `session`、Admin accountinfo | 待建 P1 |
| S01 | 系统概览 | 版本、运行模式、节点、容量、健康、最近错误；单盘不显示集群池操作 | Admin info/storageinfo/datausageinfo、健康接口 | 部分上线 P0 |
| S02 | 配置目录 | 分类与服务端字段说明已上线；当前值、值来源、动态生效信息待补 | Admin help-config-kv、get-config-kv | 部分上线 P0（只读） |
| S03 | API/浏览器配置 | 按服务端 help 元数据生成字段；预览差异后保存，显示动态/重启结果 | Admin get/set-config-kv、config history | 待建 P1 |
| S04 | 身份提供方 | 内置/LDAP/OIDC 列表、连接配置、测试和删除影响；凭据不回显 | Admin idp-config、ConfigKV | 待建 P2 |
| S05 | 事件目标 | Webhook/Kafka 等目标列表、测试、密钥输入；桶通知引用关系 | Admin ConfigKV、S3 BucketNotification | 待建 P1 |
| S06 | 审计/日志目标 | 审计输出状态、Webhook/Kafka 配置与测试、秘密字段保护 | Admin ConfigKV | 待建 P1 |
| S07 | 配置变更历史 | 时间、脱敏差异、回滚前验证与影响说明；操作者须由新增审计事件补充 | Admin config history + 新增 Console 审计事件 | 待建 P1 |
| S08 | KMS/加密状态 | 仅在 KMS 已配置且授权时显示状态和密钥可用性 | Admin KMS status/key status | 待建 P2，能力门控 |
| M01 | 监控总览 | 容量、对象量、请求/错误、服务健康与采样时间 | Admin metrics/info/datausageinfo | 待建 P1 |
| M02 | 日志与审计 | 过滤、实时暂停、时间范围、脱敏导出 | Admin log、healthinfo、trace | 待建 P1/P2 |
| M03 | 诊断/维护 | Healing、池、再平衡、Profiling、站点复制等只按后端能力逐项开放 | Admin mode-gated endpoints | 待建 P2，能力门控 |
| H01 | 文档与许可证 | 外链文档、社区/企业说明、许可确认 | 当前路由与 Console license API | 现有 |
| H02 | 匿名分享下载 | 有效/过期/无权/对象已删除状态，下载文件名与大小 | Console public download-shared-object | 现有下载接口 / 待建 P1 状态页 |

此外每个列表都要有首次加载、空结果、过滤无结果、网络失败、403、分页边界；每个表单都要有校验、提交中、成功、冲突、服务器拒绝和离开未保存提示；破坏性流程要显示受影响资源数及不可逆范围。这些是**状态画板**，不是额外的功能路由。

## 4. 首批入口的具体交互

### 4.1 权限管理（最优先）

用户从「访问控制」进入用户、组、策略、访问密钥。用户详情把直接策略与通过组继承的策略分开展示；策略页可以从“桶 + 动作 + 前缀”生成可审查的 JSON，也允许管理员查看/编辑原始 JSON。保存前显示差异和受影响的用户/组，禁止通过 UI 预设 `admin:*` 作为普通桶操作模板。密钥创建页必须说明 secret 只显示一次；关闭后只留下 access key、归属、到期和状态。管理员禁用/删除用户、组、策略或密钥时先检查依赖，再逐项确认。外部身份在本地用户列表中标记来源，并指向相应 IDP 配置而非允许错误地改本地密码。

权限门控按**动作和资源**判断，例如用户列表需要 `admin:ListUsers`，创建用户需要 `admin:CreateUser`，桶公开策略读取/写入分别需要 `s3:GetBucketPolicy` / `s3:PutBucketPolicy`。现有 `permissions.ts` 中残留的页面常量只能作为参考，不能当成服务端已授权。后端最终仍执行 MinIO 的实际 IAM 校验。

### 4.2 存储桶配置

桶详情的默认页是摘要，再以标签页提供「访问、版本、生命周期、加密与保留、配额、事件、复制、标签」。访问页以**当前策略和实际资源范围**为准，避免一个含糊的“公开”开关；生成匿名只读策略时要求明确桶/前缀，默认保持私有。版本启用后解释删除标记和恢复；生命周期保存前列出规则效果，不把“当前版本到期”误描述为所有历史版本立即删除。对象锁定与 KMS 受当前桶状态及服务配置约束。复制和事件通知对前置条件进行检查后才允许创建。删除桶放入危险操作菜单，默认只支持空桶删除。

### 4.3 系统配置

配置首页先提供**只读目录**，以服务端 `help-config-kv` 获得支持字段与说明，以 `get-config-kv` 读取脱敏值。编辑按分类和 target 逐项开放，不做无差别的大文本框。保存时做字段校验、影响范围与差异预览；动态子系统保存后刷新核验，非动态子系统仅显示“已写入、待受控重启”。环境变量覆盖的字段标为外部管理，只读且给出部署文档入口。密钥字段只接受新值，不回填原值，也不在日志、Figma 或下载文件中出现。历史回滚是单独操作，不能和普通保存混用。HTTPS 证书、网关、路由器映射、systemd 环境文件属于主机部署范围，**不放进 MinIO Web 配置页**。

## 5. 接口与实现约束

1. **同源后端桥接。** 当前 Console 使用登录会话与 STS 凭据创建 `madmin` 客户端。扩展时让浏览器只访问同源 `/api/v1/...` 的明确路由，Console Go 层使用现有会话建立受限客户端，再调用 MinIO Admin/S3 API。浏览器不持有 root secret，也不把 `/minio/admin/v3` 直接变成无鉴权代理。
2. **每个接口单独授权。** 页面授权用于导航，读/写/删除仍由后端逐项校验。资源名、用户 ID、策略名、bucket/prefix 均需规范化和服务端验证；错误分别处理 401、403、404、409 和后端不可用。
3. **写入的保护。** 同源 cookie 请求配合 CSRF/Origin 检查；表单有幂等或重复提交保护；危险操作二次确认并给出当前对象或主体数量。配置、策略、桶访问变更记录审计事件及脱敏差异。
4. **能力探测。** 读取 server info、KMS 状态、桶版本/锁定状态以及当前授权，形成 `supported / disabled / forbidden / unavailable` 四态。单实例默认不展示池再平衡；未配置 KMS 不出现“启用加密”提交入口；通知和复制在前置条件缺失时给出具体步骤。
5. **与现有构建集成。** 新增 Go 路由、OpenAPI 描述和前端页面应作为 `console-custom` 的可重复补丁/源码进入固定 Console 工作区，由现有候选构建与回滚发布链验证。不能直接编辑 Go 模块缓存，也不能只在 `.local/` 中保存唯一源码。
6. **数据与部署隔离。** Figma 只放占位数据；测试使用独立桶/主体前缀并清理；生产发布沿用候选实例、健康检查、原子替换和回滚流程。路由器 Skill 继续只管理那台华为路由器，不引入 MinIO 业务。

## 6. 交付阶段与验收

| 阶段 | 范围 | 验收条件 |
| --- | --- | --- |
| 0 · 契约和安全底座 | OpenAPI/类型、会话与 CSRF、统一 401/403/409、能力探测、审计事件、导航骨架 | 非管理员看不到无权入口；直接访问深链仍被拒绝；无 root secret 到浏览器；当前对象预览与主题回归通过。 |
| 1 · 日常管理 | 用户、组、策略、访问密钥；桶列表/摘要、桶访问策略、版本；配置目录只读 | 最小权限账号可读/不可写边界正确；管理员能完成创建用户→附策略→生成应用密钥→访问指定桶→撤销的闭环；匿名访问默认拒绝。 |
| 2 · 桶与系统配置 | 配额、生命周期、标签、通知、加密/保留；API/浏览器配置编辑与历史 | 创建、读取、更新、撤销闭环可重复；重启需求和环境覆盖正确标注；敏感字段不回显；浏览器上传/预览不退化。 |
| 3 · 观察与高级 | 监控、日志、审计；IDP、KMS、复制与分布式维护按能力上线 | 不支持的功能不出现可提交按钮；只读与写入权限分离；单实例与多节点条件测试通过。 |

首批设计先做这些画板：全局导航与权限状态、桶列表/详情/访问/版本、用户列表/详情/新建、组列表/详情、策略列表/编辑、访问密钥列表/一次性密钥、配置目录/字段详情，以及通用错误/确认弹窗。每页出白垣和苍渊主题，使用当前 Figma 文件的语义变量与组件。当前运行界面画板和**拟新增**画板必须分开命名，不把规划稿标成已上线。

当前版本的设计归档在同一个 Figma 文件，按运行界面分为：[对象浏览](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=14-549)、[对象详情](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=64-6598)、[音频试听](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=64-6599)、[音频分析](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=64-6600)、[外观主题](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=64-6601)、[登录](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=76-921)、[许可证](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=90-921)、[存储桶与路径操作](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=91-921)、[对象操作](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=92-921)、[非音频预览与许可确认](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=93-921)。画板使用示例数据；音视频/文件内容随真实对象变化。权限、设置、桶管理的首批已上线画板见[管理工作区](https://www.figma.com/design/GM2b1hNNlKvKUxanutF1kw?node-id=104-921)；其余待建流程不得标为当前运行版。

## 7. 明确暂不提供

- 不提供桶或对象 ACL、桶 CORS 的可写表单：本版本对应路由是 dummy call。
- 不把 AIStor 文档中的界面视为当前社区版功能；仅借鉴用户任务，不复制其产品承诺。
- 不在 Web 页编辑路由器、网关、证书私钥、systemd 配置或服务器 root 环境变量。
- 不在首批提供“强制删除非空桶”“一键公开整个部署”“自动重启服务”“通用策略模拟器”这类难以审查影响范围的按钮。
- 不把版本/对象锁定/复制/KMS/集群维护绘成所有部署都可用的固定入口；按服务端模式、配置和授权开放。

## 8. 核对依据

- 本仓库：[`go.mod`](../go.mod)、[`cmd/admin-router.go`](../cmd/admin-router.go)、[`cmd/api-router.go`](../cmd/api-router.go)、[`internal/config/config.go`](../internal/config/config.go)、[`console-custom/ui/WorkspaceMenu.tsx`](ui/WorkspaceMenu.tsx)、[`ops/minio-lan/README.md`](../ops/minio-lan/README.md)。
- 固定依赖工作区（由 `console-custom/prepare.mjs` 可重建）：`web-app/src/screens/Console/Console.tsx`、`Buckets/Buckets.tsx`、`common/SecureComponent/permissions.ts`，以及 Console 模块的 `swagger.yml`。
- 上游原始说明：[社区版管理 UI 的变更](https://github.com/minio/minio/issues/21317)、[MinIO 策略和访问控制](https://docs.min.io/aistor/administration/iam/access/)。外部文档仅用于交叉核对产品语义，接口是否可实现仍以本仓库源码为准。
