---
name: huawei-router
description: 管理用户这台华为路由 BE3 Pro 疾风版，包括 Wi-Fi 网关识别、SCRAM 登录、WAN 状态诊断、DHCP 地址保留和 NAT 端口映射。使用本地设备标识绑定目标；不适用于其他路由器或应用服务部署。
---

# 华为路由器管理

本技能只管理用户已授权的这台 **华为路由 BE3 Pro 疾风版（YGJN-BE30-10）**。地址、密码和设备 UUID 从权限为 `0600`、被 Git 忽略的本地配置读取，不能写进本文件或模板。仅凭相同型号不足以认定是同一台设备。

## 识别与只读检查

使用 Node.js 22 或更新版本，无第三方运行依赖。命令路径相对于本技能目录：

```bash
node scripts/router.mjs discover
node scripts/router.mjs status --config <PRIVATE_ROUTER_CONFIG>
```

`discover` 优先选择有默认路由的 Wi-Fi 接口；`status` 校验配置地址与当前默认网关一致，完成一次 SCRAM 登录后读取状态。第一次建立本地配置时，根据实际管理页面确认设备，再记录返回的 `deviceId`。已有设备标识必须保留；不一致时停止写入并确认目标。

本机这台设备的独立管理配置位于技能目录 `.local/router.json`，只含路由器身份和登录信息。新配置结构见 [router.example.json](router.example.json)。`status` 不要求配置转发规则；端口操作才需要 `mappings`。不要将命令输出、页面截图、响应快照或 SSH 凭据写入可追踪文件。

## 端口映射和地址保留

用户指定目标端口后，先检查服务已经启动、具备对应的访问保护，再生成计划：

```bash
node scripts/router.mjs plan --config <PRIVATE_ROUTER_CONFIG>
node scripts/router.mjs apply --config <PRIVATE_ROUTER_CONFIG>
```

`plan` 只读，展示需要新建和可复用的资源。`apply` 才执行变更：仅创建缺失的 TCP 映射、应用端口定义及可选的本机 DHCP 保留。规则绑定当前本机的 IP/MAC；遇到同名不同内容、端口冲突或已有不同地址保留时停止，不覆盖其他设备的配置。

应用前向用户说明具体影响范围。已有会话中的明确授权可继续使用。单独新增端口规则和当前地址保留无需重启；不要顺带启用 DMZ、关闭防火墙或修改其他规则。更改 WAN、LAN 地址、DHCP 开关、Wi-Fi、桥接、恢复出厂或重启可能中断连接，应先确认影响范围和用户授权。

脚本在配置文件旁保存私密的变更前快照及创建记录，完成后回读验证。失败时仅回滚本次已记录的新资源；如果创建响应丢失或回读失败，检查快照与创建记录后再决定如何清理，避免盲目重试或删除既有资源。删除预先存在的资源必须有明确授权。

## 验证与其他设置

回读规则的目标、TCP 端口、启用状态及 DHCP 保留，再从用户授权的另一台主机测试实际服务。当前网段的 NAT 回环成功不能替代另一网段的验证。先按用户要求确定是上级内网访问还是公网访问，不扩展目标范围。

WAN 是私网地址时存在上级 NAT；外部查到的出口 IP 不能证明该设备有公网入站能力。`natTypeRaw` 是固件内部枚举，不能直接称为 full-cone、symmetric 或 CGNAT。只有用户要求公网访问时，才继续核对上级 WAN、运营商限制及外部探测。

其他路由器设置先读取当前管理页面和实际请求，再按所需范围扩展工具。接口和 SCRAM 的固件差异见 [references/firmware-api.md](references/firmware-api.md)。不要套用蜂窝 HiLink 的 XML API 或猜测接口字段。
