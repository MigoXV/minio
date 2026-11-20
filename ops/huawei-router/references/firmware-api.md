# 已确认的固件行为

适配型号：华为路由 BE3 Pro 疾风版，`CustDeviceName=YGJN-BE30-10`，已在 `6.1.0.11(V6R1)` 验证。设备 UUID 保存在私密配置中，不在技能内固定真实地址或标识。

## 登录与会话

- 页面：`/html/index.html`；桌面管理页为 Vue SPA。页面动态加载的模块位于 `/html/js/`，主脚本在 `/js/main.js`。
- 初始页面 `<meta>` 提供 `csrf_param` 与 `csrf_token`，必须与 Cookie 一起维护。响应可轮换 CSRF 值。
- JSON POST 格式为 `{data: <payload>, csrf: {csrf_param, csrf_token}}`。资源变更在同一顶层加 `action: "create" | "update" | "delete"`。
- 登录接口：`/api/system/user_login_nonce` → `/api/system/user_login_proof`。挑战包含盐、迭代次数、服务端 nonce；证明结果必须校验服务端签名及 RSA 公钥签名。
- 这份固件的 `forge.SCRAM().HmacSHA2(key, message)` 实际使用 `message` 为 HMAC 密钥、`hexToBytes(key)` 为数据，不能照搬标准 SCRAM 的参数顺序。详见脚本 `proof()`，已用固件自身实现交叉验证。
- 错误口令可能触发登录锁定。一次认证失败即停止，不自动重试不同口令或用户名。

## 只读接口

| 数据 | GET 接口 |
| --- | --- |
| 设备身份与能力 | `/api/system/deviceinfo` |
| WAN 列表 | `/api/ntwk/wan` |
| 当前设备表 | `/api/system/HostInfo` |
| NAT 映射 | `/api/ntwk/portmapping` |
| 应用定义 | `/api/app/application` |
| 应用端口 | `/api/app/applicationitems?ID=<application ID>` |
| DHCP 地址保留 | `/api/ntwk/lan_ipaddressreserve` |
| UPnP 开关与映射 | `/api/ntwk/lan_upnp`、`/api/ntwk/lan_upnp_portmapping` |

WAN 选择 `Enable=true` 且 `IsDefault=1` 的项。API 的 `NATType` 数值仅记录原值，未经实测不赋予 STUN NAT 类型含义。

## 创建 TCP 映射

此固件使用“应用定义 + 应用端口 + 主机映射”结构，`/api/ntwk/portforwarding` 返回 404，不是当前设备使用的接口。

1. 创建 `application`，含 `EnablePortmapping=true` 和 `ItemList`。每项包含 `Protocol="TCP"`、`ExternalPort/ExternalPortEnd`、`InternalPort/InternalPortEnd`。端口值按管理页面发送字符串。
2. 回读应用取得真实 `ID`，创建 `portmapping`：`ApplicationID`、`Name`、`Enable`、`HostName`、`HostIPAddress`、`InternalHost`（目标 MAC）。
3. 回读映射及应用端口核实完整内容。

DHCP 保留结构为 `{ID:"", Enable:true, Chaddr:<MAC>, Yiaddr:<IP>}`。只为设备当前地址增加保留，不修改 DHCP 总开关或地址池。

回滚新建资源时先删除其主机映射，再删除该应用的端口项，最后删除应用。共享、复用或预先存在的资源不属于本次回滚范围。

管理页面路径：**更多功能 → 安全设置 → NAT 服务**。华为官方说明见：[设置端口映射和端口触发规则](https://consumer.huawei.com/cn/support/content/zh-cn00225381/)。
