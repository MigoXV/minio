// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  accessNavigation,
  availableAccessNavigation,
} from "./accessNavigation";
import SystemManagementHeader from "./SystemManagementHeader";
import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { hasPermission } from "../common/SecureComponent";
import { PageHeader, Modal, State, FieldLabel, errorMessage } from "./V2";
import WorkspacePopover from "./WorkspacePopover";
import OverviewStorage, { type StorageNode } from "./OverviewStorage";
export async function manage<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1/manage" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(
      new Error(data.error || "请求失败 (" + r.status + ")"),
      { status: r.status },
    );
  return data;
}
const builtIn = new Set([
  "readonly",
  "readwrite",
  "writeonly",
  "diagnostics",
  "consoleAdmin",
]);
const configNames: Record<string, string> = {
  api: "HTTP API 行为与限制",
  browser: "浏览器访问设置",
  identity_openid: "OIDC 身份提供方",
  identity_ldap: "LDAP 身份提供方",
  notify_webhook: "Webhook 事件目标",
  audit_webhook: "Webhook 审计目标",
};
const areas: Record<string, [string, string]> = {
  overview: ["系统管理", "查看当前实例的运行状态。"],
  buckets: ["存储桶配置", "选择存储桶，查看访问策略与版本控制。"],
  users: ["用户管理", "管理本地账户、启停状态和策略关联。"],
  groups: ["用户组", "通过用户组集中管理成员与策略。"],
  policies: ["策略管理", "查看策略内容，编辑自定义 JSON。"],
  keys: ["访问密钥", "密钥继承当前账户的权限。"],
  config: ["系统配置", "查看服务端配置字段的含义。"],
};
const status = (s: string) =>
  ["enabled", "on"].includes(s)
    ? "已启用"
    : ["disabled", "off"].includes(s)
      ? "已停用"
      : s || "—";
type Dialog = { kind: string; title: string; item?: any; description?: string };
type Overview = {
  mode: string;
  servers: number;
  region: string;
  storageNodes?: StorageNode[];
};

export default function ManagementV2() {
  const { pathname } = useLocation();
  const [, area = "overview", rawName = ""] = pathname
    .replace(/^\/manage/, "")
    .split("/");
  return (
    <ManagementArea
      key={pathname}
      area={area}
      name={decodeURIComponent(rawName)}
    />
  );
}

function ManagementArea({ area, name }: { area: string; name: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]),
    [info, setInfo] = useState<any>({}),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<{
    data: Overview;
    updatedAt: number;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [form, setForm] = useState<Record<string, string>>({}),
    [dialogError, setDialogError] = useState(""),
    [dialogNotice, setDialogNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [policy, setPolicy] = useState(""),
    [version, setVersion] = useState(""),
    [tab, setTab] = useState("policy");
  const [options, setOptions] = useState<string[]>([]),
    [members, setMembers] = useState<string[]>([]),
    [secret, setSecret] = useState<any>(null);
  const epoch = useRef(0);
  const can = (scope: string, resource = "*") =>
    hasPermission(resource, [scope]);
  const reload = () => setRevision((v) => v + 1),
    go = (a: string, n = "") =>
      navigate("/manage/" + a + (n ? "/" + encodeURIComponent(n) : ""));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setDenied(false);
    setRows([]);
    setDialog(null);
    setSecret(null);
    (async () => {
      try {
        if (area === "overview") {
          const data = await manage<Overview>("/overview");
          if (alive) setOverview({ data, updatedAt: Date.now() });
        } else if (area === "config") {
          const data = await manage(
            "/config/" + encodeURIComponent(name || "api"),
          );
          if (alive) setInfo(data);
        } else if (area === "buckets") {
          const r = await api.buckets.listBuckets();
          if (alive) setRows(r.data.buckets || []);
          if (name) {
            const [p, v] = await Promise.all([
              manage("/buckets/" + encodeURIComponent(name) + "/policy"),
              manage("/buckets/" + encodeURIComponent(name) + "/versioning"),
            ]);
            if (alive) {
              setPolicy(p.policy || "");
              setVersion(v.status || "");
            }
          }
        } else {
          let data = await manage("/" + area);
          if (area === "groups")
            data = await Promise.all(
              data.map((g: string) =>
                manage("/groups/" + encodeURIComponent(g)),
              ),
            );
          if (alive) setRows(data);
        }
      } catch (e) {
        if (alive) {
          const status = (e as { status?: number }).status;
          setError(errorMessage(e));
          setDenied(status === 403);
          if (status === 401 || status === 403) setOverview(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [area, name, revision]);
  const open = async (d: Dialog, initial: Record<string, string> = {}) => {
    const id = ++epoch.current;
    setDialog(d);
    setForm(
      d.kind === "association"
        ? { policy: d.item?.policy?.split(",")[0] || "", ...initial }
        : initial,
    );
    setDialogNotice("");
    setDialogError("");
    setOptions([]);
    setMembers(d.item?.members || []);
    try {
      if (d.kind === "association") {
        const p = await manage<string[]>("/policies");
        if (id === epoch.current) setOptions(p);
      }
      if (d.kind === "policy" && d.item) {
        const p = await manage("/policies/" + encodeURIComponent(d.item));
        if (id === epoch.current)
          setForm({ name: d.item, json: JSON.stringify(p, null, 2) });
      }
      if (d.kind === "add-member") {
        const u = await manage<any[]>("/users");
        if (id === epoch.current)
          setOptions(u.map((x) => x.name).filter((x) => !members.includes(x)));
      }
    } catch (e) {
      if (id === epoch.current) setDialogError(errorMessage(e));
    }
  };
  const close = () => {
    epoch.current++;
    setDialog(null);
    setDialogError("");
  };
  const change = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const mutate = async (
    action: () => Promise<any>,
    after?: (r: any) => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setDialogError("");
    setNotice("");
    try {
      const r = await action();
      if (after) after(r);
      else {
        close();
        reload();
        setNotice("已保存");
      }
    } catch (e) {
      setDialogError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (
    label: string,
    key: string,
    type = "text",
    required = true,
  ) => (
    <FieldLabel label={label}>
      <input
        className="av-field"
        type={type}
        autoComplete={type === "password" ? "new-password" : "off"}
        required={required}
        minLength={type === "password" ? 8 : undefined}
        placeholder={
          key === "password"
            ? "至少 8 位"
            : key === "name"
              ? dialog?.kind === "user"
                ? "输入用户名"
                : dialog?.kind === "group"
                  ? "输入组名"
                  : dialog?.kind === "key"
                    ? "输入用途说明"
                    : "输入策略名称"
              : key === "members"
                ? "选择用户，支持多个"
                : undefined
        }
        value={form[key] || ""}
        onChange={(e) => change(key, e.target.value)}
        disabled={busy}
      />
    </FieldLabel>
  );
  const action = (text: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className="v2-text-button"
      disabled={disabled}
      onClick={onClick}
    >
      {text}
    </button>
  );
  const isAccess = accessNavigation.some((item) => item.area === area);
  const visibleRows = rows.filter((row) =>
    String(row.name || row.accessKey || row)
      .toLocaleLowerCase()
      .includes(filter.trim().toLocaleLowerCase()),
  );
  const recordActions = (name: string, children: React.ReactNode) => (
    <>
      <div className="v2-actions v2-record-desktop-actions">{children}</div>
      <WorkspacePopover
        className="av-button av-ghost v2-record-menu"
        label={"管理 " + name}
        align="end"
        trigger="管理"
      >
        {children}
      </WorkspacePopover>
    </>
  );
  const table = (
    heads: string[],
    data: React.ReactNode,
    widths?: Array<string | number | undefined>,
  ) => (
    <div className="v2-table-wrap">
      <table
        className={"v2-table" + (isAccess ? " v2-management-records" : "")}
        role="table"
        style={
          {
            "--v2-record-meta": Math.max(1, heads.length - 2),
          } as React.CSSProperties
        }
      >
        <colgroup>
          {heads.map((h, i) => (
            <col key={h} style={{ width: widths?.[i] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{data}</tbody>
      </table>
    </div>
  );

  const create =
    area === "users" && can("admin:CreateUser")
      ? ["创建用户", "user"]
      : area === "groups" && can("admin:AddUserToGroup")
        ? ["创建组", "group"]
        : area === "keys" && can("admin:CreateServiceAccount")
          ? ["生成密钥", "key"]
          : null;
  const submit = () => {
    if (!dialog) return;
    const d = dialog,
      i = d.item,
      n = encodeURIComponent(typeof i === "string" ? i : i?.name || "");
    if (d.kind === "user")
      return mutate(() =>
        manage("/users", "POST", { name: form.name, password: form.password }),
      );
    if (d.kind === "group")
      return mutate(() =>
        manage("/groups", "POST", {
          name: form.name,
          members: (form.members || "").split(/[,，\s]+/).filter(Boolean),
        }),
      );
    if (d.kind === "key")
      return mutate(
        () =>
          manage("/keys", "POST", {
            name: form.name,
            description: form.description || "",
          }),
        (r) => {
          setSecret(r);
          setDialog({ kind: "secret", title: "访问密钥已创建" });
          setRows((a) => [
            ...a,
            { ...r, name: form.name, accountStatus: "on" },
          ]);
        },
      );
    if (d.kind === "association") return;
    if (d.kind === "policy") {
      let body;
      try {
        body = JSON.parse(form.json);
      } catch {
        setDialogError("JSON 格式不正确，请检查后重试。");
        return;
      }
      return mutate(() =>
        manage("/policies/" + encodeURIComponent(form.name), "PUT", body),
      );
    }
    if (d.kind === "confirm")
      return mutate(() => manage(i.path, i.method, i.body));
    if (d.kind === "add-member")
      return mutate(
        () =>
          manage("/groups/" + n, "PUT", { member: form.member, remove: false }),
        async () => {
          setMembers((m) => [...m, form.member]);
          setDialog({ kind: "members", title: "用户组 · " + i.name, item: i });
          setNotice("已添加成员");
        },
      );
    if (d.kind === "remove-member")
      return mutate(
        () =>
          manage("/groups/" + n, "PUT", { member: form.member, remove: true }),
        () => {
          const next = members.filter((m) => m !== form.member);
          setMembers(next);
          setDialog({
            kind: "members",
            title: i.name,
            item: { ...i, members: next },
          });
          setForm({});
        },
      );
    if (d.kind === "version")
      return mutate(() =>
        manage("/buckets/" + encodeURIComponent(name) + "/versioning", "PUT", {
          status: form.status,
        }),
      );
    if (d.kind === "bucket-policy") {
      try {
        if (form.json) JSON.parse(form.json);
      } catch {
        setDialogError("JSON 格式不正确，请检查后重试。");
        return;
      }
      return mutate(() =>
        manage("/buckets/" + encodeURIComponent(name) + "/policy", "PUT", {
          policy: form.json || "",
        }),
      );
    }
  };
  const confirm = (
    title: string,
    description: string,
    path: string,
    method: string,
    body?: unknown,
  ) =>
    open({ kind: "confirm", title, description, item: { path, method, body } });
  const footer =
    dialog?.kind === "secret" ? (
      <button
        className="av-button av-primary"
        onClick={() => {
          setSecret(null);
          close();
        }}
      >
        已保存，关闭
      </button>
    ) : ["members", "association", "preview-policy"].includes(
        dialog?.kind || "",
      ) ||
      (dialog?.kind === "policy" && builtIn.has(dialog.item)) ? (
      <>
        <button className="av-button" onClick={close}>
          取消
        </button>
        <button
          className="av-button av-primary"
          onClick={() => {
            close();
            if (dialog?.kind !== "preview-policy") reload();
          }}
        >
          {dialog?.kind === "association" ? "完成" : "关闭"}
        </button>
      </>
    ) : (
      <>
        <button className="av-button" disabled={busy} onClick={close}>
          取消
        </button>
        <button
          type="submit"
          form="v2-management-form"
          className="av-button av-primary"
          disabled={
            busy || (dialog?.kind === "policy" && builtIn.has(dialog.item))
          }
        >
          {busy
            ? "正在保存…"
            : dialog?.kind === "confirm"
              ? /^删除/.test(dialog.title)
                ? "确认删除"
                : /^停用/.test(dialog.title)
                  ? "确认停用"
                  : /^启用/.test(dialog.title)
                    ? "确认启用"
                    : /^撤销/.test(dialog.title)
                      ? "确认撤销"
                      : "确认"
              : dialog?.kind === "user"
                ? "创建用户"
                : dialog?.kind === "group"
                  ? "创建组"
                  : dialog?.kind === "key"
                    ? "生成密钥"
                    : dialog?.kind === "policy"
                      ? "保存策略"
                      : dialog?.kind === "add-member"
                        ? "添加成员"
                        : dialog?.kind === "remove-member"
                          ? "移除成员"
                          : dialog?.kind === "version"
                            ? form.status === "Enabled"
                              ? "启用版本控制"
                              : "暂停版本控制"
                            : "保存"}
        </button>
      </>
    );
  const system = area === "overview" || area === "config";
  const { state } = useLocation();
  const bucketContext =
    typeof state?.bucketContext === "string" ? state.bucketContext : "";
  const refreshAction = (
    <button
      className={
        "av-button v2-refresh " +
        (isAccess && area !== "policies" ? "av-ghost" : "")
      }
      onClick={reload}
      disabled={loading || busy}
    >
      {overview && loading ? "刷新中" : "刷新"}
    </button>
  );
  const actions = (
    <>
      {area === "overview" && (
        <>
          <button
            className="av-button v2-bucket-shortcut"
            onClick={() =>
              navigate(
                "/manage/buckets" + (bucketContext ? "/" + bucketContext : ""),
              )
            }
          >
            存储桶配置
          </button>
          <button
            className="av-button v2-access-shortcut"
            onClick={() => go(availableAccessNavigation()[0].area)}
          >
            访问管理
          </button>
        </>
      )}
      {area === "buckets" && name ? (
        <button
          className="av-button"
          onClick={() => navigate("/browser/" + encodeURIComponent(name))}
        >
          浏览对象
        </button>
      ) : (
        refreshAction
      )}
      {create && (
        <button
          className="av-button av-primary v2-access-create"
          onClick={() => open({ kind: create[1], title: create[0] })}
        >
          {create[0]}
        </button>
      )}
    </>
  );
  return (
    <main
      className={"v2-page v2-management v2-management-" + area}
      aria-label="MinIO 管理工作区"
    >
      {system ? (
        <SystemManagementHeader
          active={area}
          description={areas[area][1]}
          actions={actions}
        />
      ) : (
        <PageHeader
          title={
            area === "buckets" && name ? name : areas[area]?.[0] || "管理工作区"
          }
          description={
            area === "buckets" && name
              ? "存储桶配置 · " +
                (policy ? "已设置访问策略" : "当前访问权限为私有")
              : areas[area]?.[1]
          }
          actions={actions}
        />
      )}
      {isAccess && (
        <div
          className="v2-tabs v2-access-tabs"
          role="tablist"
          aria-label="访问管理"
        >
          {availableAccessNavigation().map(({ area: target, label }) => (
            <button
              key={target}
              role="tab"
              aria-selected={area === target}
              onClick={() => go(target)}
            >
              <span>{target === "groups" ? "组" : label}</span>
            </button>
          ))}
        </div>
      )}
      {isAccess && !error && (
        <div className="v2-toolbar v2-record-filter">
          <input
            className="av-field"
            aria-label={"筛选" + areas[area][0]}
            placeholder={"筛选" + areas[area][0]}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {refreshAction}
        </div>
      )}
      {notice && (
        <p className="v2-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !overview ? (
        <State title="正在加载…">请稍候。</State>
      ) : error && !overview ? (
        <State
          title={denied ? "没有访问权限" : "无法加载内容"}
          error
          action={
            !denied && (
              <button className="av-button" onClick={reload}>
                重试
              </button>
            )
          }
        >
          {denied
            ? "当前账户无权访问此管理功能。请联系管理员检查权限。"
            : error}
        </State>
      ) : (
        <>
          {overview && (
            <>
              <div className="v2-overview-status">
                <h2>运行状态</h2>
                <dl className="v2-overview-status-list">
                  <div>
                    <dt>运行模式</dt>
                    <dd>{overview.data.mode || "—"}</dd>
                  </div>
                  <div>
                    <dt>节点数</dt>
                    <dd>{overview.data.servers ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>区域</dt>
                    <dd>{overview.data.region || "默认"}</dd>
                  </div>
                  <div>
                    <dt>服务</dt>
                    <dd>运行中</dd>
                  </div>
                </dl>
              </div>
              <OverviewStorage
                nodes={overview.data.storageNodes ?? []}
                updatedAt={overview.updatedAt}
                refreshFailed={Boolean(error)}
              />
            </>
          )}
          {area === "users" &&
            table(
              ["用户名", "状态", "策略", "来源", "操作"],
              visibleRows.map((u) => (
                <tr key={u.name}>
                  <td>{u.name}</td>
                  <td>{status(u.status)}</td>
                  <td>{u.policy || "未分配"}</td>
                  <td>{u.auth?.type === "ldap" ? "LDAP" : "本地"}</td>
                  <td>
                    {recordActions(
                      u.name,
                      <>
                        {action(
                          "管理策略",
                          () =>
                            open({
                              kind: "association",
                              title: "管理策略 · " + u.name,
                              item: u,
                            }),
                          !can("admin:AttachUserOrGroupPolicy"),
                        )}
                        {action(
                          u.status === "enabled" ? "停用" : "启用",
                          () =>
                            confirm(
                              (u.status === "enabled" ? "停用 " : "启用 ") +
                                u.name +
                                "？",
                              "此操作将改变 " + u.name + " 的访问状态。",
                              "/users/" + encodeURIComponent(u.name),
                              "PUT",
                              {
                                status:
                                  u.status === "enabled"
                                    ? "disabled"
                                    : "enabled",
                              },
                            ),
                          u.auth?.type === "ldap" ||
                            !can(
                              u.status === "enabled"
                                ? "admin:DisableUser"
                                : "admin:EnableUser",
                            ),
                        )}
                        {action(
                          "删除",
                          () =>
                            confirm(
                              "删除用户 " + u.name + "？",
                              "删除后，" +
                                u.name +
                                " 将无法登录。此操作无法撤销。",
                              "/users/" + encodeURIComponent(u.name),
                              "DELETE",
                            ),
                          !can("admin:DeleteUser"),
                        )}
                      </>,
                    )}
                  </td>
                </tr>
              )),
              [undefined, 144, 200, 136, 312],
            )}
          {area === "groups" &&
            table(
              ["组名", "状态", "成员", "策略", "操作"],
              visibleRows.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{status(g.status)}</td>
                  <td>{g.members?.join(" · ") || "无"}</td>
                  <td>
                    {action(
                      g.policy || "未分配",
                      () =>
                        open({
                          kind: "association",
                          title: "管理组策略",
                          item: { ...g, group: true },
                        }),
                      !can("admin:AttachUserOrGroupPolicy"),
                    )}
                  </td>
                  <td>
                    {recordActions(
                      g.name,
                      <>
                        {action("管理成员", () =>
                          open({
                            kind: "members",
                            title: "用户组 · " + g.name,
                            item: g,
                          }),
                        )}
                        {action(
                          g.status === "enabled" ? "停用组" : "启用组",
                          () =>
                            confirm(
                              g.status === "enabled" ? "停用组" : "启用组",
                              "更改组状态将影响该组成员获得的权限。",
                              "/groups/" + encodeURIComponent(g.name),
                              "PUT",
                              {
                                status:
                                  g.status === "enabled"
                                    ? "disabled"
                                    : "enabled",
                              },
                            ),
                          !can(
                            g.status === "enabled"
                              ? "admin:DisableGroup"
                              : "admin:EnableGroup",
                          ),
                        )}
                      </>,
                    )}
                  </td>
                </tr>
              )),
              [undefined, 120, 320, 192, 248],
            )}
          {area === "policies" && (
            <>
              {table(
                ["策略名", "来源", "操作"],
                visibleRows.map((p) => (
                  <tr key={p}>
                    <td>{p}</td>
                    <td>{builtIn.has(p) ? "内置" : "自定义"}</td>
                    <td>
                      {recordActions(
                        p,
                        <>
                          {action(
                            builtIn.has(p) ? "查看 JSON" : "编辑 JSON",
                            () =>
                              open({
                                kind: "policy",
                                title: builtIn.has(p) ? "查看策略" : "编辑策略",
                                item: p,
                              }),
                          )}
                          {!builtIn.has(p) &&
                            action(
                              "删除",
                              () =>
                                confirm(
                                  "删除 " + p + "？",
                                  "确认删除 " +
                                    p +
                                    "？请先确认没有用户或组依赖此策略。",
                                  "/policies/" + encodeURIComponent(p),
                                  "DELETE",
                                ),
                              !can("admin:DeletePolicy"),
                            )}
                        </>,
                      )}
                    </td>
                  </tr>
                )),
                [undefined, 200, 280],
              )}
              <p className="v2-table-caption">
                <span>
                  内置策略只读；自定义策略的资源 ARN 与动作请在保存前核对。
                </span>
                {can("admin:CreatePolicy") &&
                  action("创建策略", () =>
                    open(
                      { kind: "policy", title: "创建策略" },
                      {
                        json: '{\n  "Version": "2012-10-17",\n  "Statement": []\n}',
                      },
                    ),
                  )}
              </p>
            </>
          )}
          {area === "keys" && (
            <>
              {table(
                ["名称", "状态", "到期时间", "操作"],
                visibleRows.map((k) => (
                  <tr key={k.accessKey}>
                    <td>{k.name || k.accessKey}</td>
                    <td>{status(k.accountStatus)}</td>
                    <td>
                      {!k.expiration || k.expiration.startsWith("0001")
                        ? "未设置"
                        : new Date(k.expiration).toLocaleDateString("sv-SE")}
                    </td>
                    <td>
                      {recordActions(
                        k.name || k.accessKey,
                        <>
                          {action(
                            "撤销",
                            () =>
                              confirm(
                                "撤销 " + (k.name || k.accessKey) + "？",
                                "撤销 " +
                                  (k.name || k.accessKey) +
                                  " 后，使用此密钥的客户端将无法继续访问。",
                                "/keys/" + encodeURIComponent(k.accessKey),
                                "DELETE",
                              ),
                            !can("admin:RemoveServiceAccount"),
                          )}
                        </>,
                      )}
                    </td>
                  </tr>
                )),
                [undefined, 160, 240, 200],
              )}
              <p className="v2-table-caption">秘密值仅在创建成功时显示一次。</p>
            </>
          )}
          {["users", "groups"].includes(area) && (
            <p className="v2-table-caption">
              {visibleRows.length} 个{area === "users" ? "用户" : "用户组"}
            </p>
          )}
          {isAccess && filter.trim() && !visibleRows.length ? (
            <State title="没有匹配的条目">尝试其他名称。</State>
          ) : (
            isAccess &&
            !rows.length && (
              <State
                title={
                  area === "keys"
                    ? "尚未创建访问密钥"
                    : area === "users"
                      ? "暂无用户"
                      : area === "groups"
                        ? "暂无用户组"
                        : "暂无策略"
                }
              >
                创建后将在此处显示。
              </State>
            )
          )}
          {area === "config" && (
            <div className="v2-split">
              <div className="v2-subnav">
                {Object.entries(configNames).map(([key, label]) => (
                  <button
                    key={key}
                    aria-current={(name || "api") === key ? "page" : undefined}
                    onClick={() => go("config", key)}
                  >
                    {key}
                    <small>{label}</small>
                  </button>
                ))}
              </div>
              <div>
                <h2>{info.subSys || name || "api"}</h2>
                <div style={{ height: 24 }} />
                {table(
                  ["字段", "说明"],
                  (info.keysHelp || []).map((k: any) => (
                    <tr key={k.key}>
                      <td>{k.key}</td>
                      <td>
                        {(
                          {
                            requests_max: "最大并发请求数",
                            cluster_deadline: "集群请求等待时间",
                          } as Record<string, string>
                        )[k.key] || k.description}
                      </td>
                    </tr>
                  )),
                  [280, undefined],
                )}
                <p className="v2-table-caption">
                  此处仅提供字段目录，不回显密码、令牌或当前配置值。
                </p>
              </div>
            </div>
          )}
          {area === "buckets" &&
            !name &&
            table(
              ["存储桶", "访问权限", "操作"],
              rows.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td>{b.access === "PRIVATE" ? "私有" : b.access || "—"}</td>
                  <td>{action("查看配置", () => go("buckets", b.name))}</td>
                </tr>
              )),
            )}
          {area === "buckets" && name && (
            <>
              <div className="v2-tabs" role="tablist" aria-label="存储桶配置">
                <button
                  role="tab"
                  aria-selected={tab === "policy"}
                  onClick={() => {
                    setTab("policy");
                    document
                      .getElementById("bucket-policy-section")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  访问策略
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "version"}
                  onClick={() => {
                    setTab("version");
                    document
                      .getElementById("bucket-version-section")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  版本控制
                </button>
              </div>
              <div className="v2-management-flow">
                <h2 id="bucket-policy-section">匿名访问策略</h2>
                <p className="v2-muted">
                  {policy ? "已设置匿名访问策略。" : "当前不允许匿名访问。"}
                  保存前核对 JSON 中的资源与动作。
                </p>
                <div className="v2-bucket-policy-field">
                  <FieldLabel label="策略 JSON">
                    <input
                      className="av-field"
                      value={policy}
                      placeholder={
                        '{ "Version": "2012-10-17", "Statement": [] }'
                      }
                      onChange={(e) => setPolicy(e.target.value)}
                      readOnly={!can("s3:PutBucketPolicy", name)}
                    />
                  </FieldLabel>
                </div>
                <div className="v2-actions">
                  <button
                    className="av-button"
                    style={{ width: 130 }}
                    onClick={() => {
                      let json = policy;
                      try {
                        json = JSON.stringify(
                          JSON.parse(
                            policy || '{"Version":"2012-10-17","Statement":[]}',
                          ),
                          null,
                          2,
                        );
                      } catch {}
                      open(
                        { kind: "preview-policy", title: "预览 JSON" },
                        { json },
                      );
                    }}
                  >
                    预览 JSON
                  </button>
                  <button
                    className="av-button av-primary"
                    style={{ width: 102 }}
                    disabled={!can("s3:PutBucketPolicy", name)}
                    onClick={() =>
                      open(
                        {
                          kind: "bucket-policy",
                          title: "保存访问策略",
                          description: "请确认该策略仅授予所需的匿名访问权限。",
                        },
                        { json: policy },
                      )
                    }
                  >
                    保存桶策略
                  </button>
                </div>
                <hr />
                <h2 id="bucket-version-section">版本控制</h2>
                <dl className="v2-data">
                  <dt>当前状态</dt>
                  <dd>
                    {version === "Enabled"
                      ? "已启用"
                      : version === "Suspended"
                        ? "已暂停"
                        : "未启用"}
                  </dd>
                </dl>
                <div className="v2-actions v2-version-actions">
                  <button
                    className="av-button"
                    disabled={!can("s3:PutBucketVersioning", name)}
                    onClick={() =>
                      open(
                        { kind: "version", title: "版本控制" },
                        {
                          status:
                            version === "Enabled" ? "Suspended" : "Enabled",
                        },
                      )
                    }
                  >
                    {version === "Enabled" ? "暂停版本控制" : "启用版本控制"}
                  </button>
                  <p className="v2-muted">
                    已启用的存储桶可暂停；暂停不会删除历史版本。
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {dialog && (
        <Modal
          title={
            dialog.kind === "user"
              ? "创建本地用户"
              : dialog.kind === "group"
                ? "创建用户组"
                : dialog.kind === "key"
                  ? "生成访问密钥"
                  : dialog.kind === "association"
                    ? dialog.item?.group
                      ? "管理组策略"
                      : "管理用户策略"
                    : dialog.kind === "members"
                      ? dialog.item.name
                      : dialog.kind === "policy"
                        ? builtIn.has(dialog.item)
                          ? "查看内置策略"
                          : dialog.item
                            ? "编辑策略"
                            : "创建策略"
                        : dialog.kind === "version"
                          ? "版本控制"
                          : dialog.title
          }
          description={
            dialog.kind === "user"
              ? "创建后可在用户列表中分配策略。"
              : dialog.kind === "group"
                ? "通过用户组统一管理成员权限。"
                : dialog.kind === "key"
                  ? "密钥继承当前账户权限。"
                  : dialog.kind === "secret"
                    ? "请保存以下信息，秘密值仅显示一次。"
                    : dialog.kind === "association"
                      ? (dialog.item?.group ? "当前用户组 · " : "当前用户 · ") +
                        dialog.item.name
                      : dialog.kind === "members"
                        ? (dialog.item.status === "enabled"
                            ? "已启用"
                            : "已停用") +
                          " · 策略 " +
                          (dialog.item.policy || "未分配")
                        : ["add-member", "remove-member"].includes(dialog.kind)
                          ? "用户组 · " + dialog.item.name
                          : dialog.kind === "policy"
                            ? builtIn.has(dialog.item)
                              ? dialog.item + " · 内置策略不可编辑"
                              : "保存前核对资源 ARN 与动作。"
                            : dialog.kind === "version"
                              ? "存储桶 · " + name
                              : dialog.description
          }
          onClose={close}
          busy={busy}
          footer={footer}
        >
          {dialogNotice && (
            <p className="v2-notice" role="status">
              {dialogNotice}
            </p>
          )}
          {dialogError && (
            <div className="v2-alert" role="alert">
              {dialogError}
            </div>
          )}
          <form
            id="v2-management-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {dialog.kind === "user" && (
              <>
                {field("用户名", "name")}
                {field("初始密码", "password", "password")}
              </>
            )}
            {dialog.kind === "group" && (
              <>
                {field("组名", "name")}
                {field("成员", "members", "text", false)}
              </>
            )}
            {dialog.kind === "key" && (
              <>
                {field("名称", "name")}
                <p className="v2-muted">
                  创建成功后，请立即保存秘密值；关闭后无法再次查看。
                </p>
              </>
            )}
            {dialog.kind === "secret" && secret && (
              <>
                <FieldLabel label="Access Key">
                  <input
                    className="av-field"
                    readOnly
                    value={secret.accessKey}
                  />
                </FieldLabel>
                <FieldLabel label="Secret Key">
                  <input
                    className="av-field"
                    readOnly
                    value={secret.secretKey}
                  />
                </FieldLabel>
                <p className="v2-muted">
                  关闭后无法再次查看秘密值，请妥善保管。
                </p>
              </>
            )}
            {dialog.kind === "association" && (
              <>
                <FieldLabel label="策略">
                  <select
                    className="v2-select"
                    required
                    value={form.policy || ""}
                    onChange={(e) => change("policy", e.target.value)}
                  >
                    <option value="">选择策略</option>
                    {options.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </FieldLabel>
                <div className="v2-actions">
                  {[false, true].map((remove) => (
                    <button
                      key={String(remove)}
                      className="av-button"
                      type="button"
                      disabled={busy || !form.policy}
                      onClick={() =>
                        mutate(
                          () =>
                            manage("/associations", "POST", {
                              policy: form.policy,
                              [dialog.item.group ? "group" : "user"]:
                                dialog.item.name,
                              remove,
                            }),
                          () =>
                            setDialogNotice(
                              remove ? "已撤销关联" : "已附加策略",
                            ),
                        )
                      }
                    >
                      {remove ? "撤销关联" : "附加策略"}
                    </button>
                  ))}
                </div>
              </>
            )}
            {dialog.kind === "policy" && (
              <>
                {!builtIn.has(dialog.item) && field("名称", "name")}
                <>
                  <textarea
                    className="v2-code"
                    style={{ height: 220 }}
                    aria-label="策略 JSON"
                    required
                    readOnly={builtIn.has(dialog.item)}
                    value={form.json || ""}
                    onChange={(e) => change("json", e.target.value)}
                  />
                </>
              </>
            )}
            {dialog.kind === "members" && (
              <>
                {table(
                  ["名称 / 版本", "说明", "状态 / 大小"],
                  members.map((m) => (
                    <tr key={m} aria-selected={form.member === m}>
                      <td>
                        <button
                          type="button"
                          className="v2-text-button"
                          onClick={() => change("member", m)}
                        >
                          {m}
                        </button>
                      </td>
                      <td>本地用户</td>
                      <td>已加入</td>
                    </tr>
                  )),
                  ["37%", "42%", "21%"],
                )}
                {!members.length && <p className="v2-muted">此组暂无成员。</p>}
                <div className="v2-actions">
                  <button
                    type="button"
                    className="av-button"
                    disabled={!can("admin:AddUserToGroup")}
                    onClick={() =>
                      open({
                        kind: "add-member",
                        title: "添加组成员",
                        item: { ...dialog.item, members },
                      })
                    }
                  >
                    添加成员
                  </button>
                  <button
                    type="button"
                    className="av-button"
                    disabled={
                      !members.length || !can("admin:RemoveUserFromGroup")
                    }
                    onClick={() =>
                      open(
                        {
                          kind: "remove-member",
                          title: "移除组成员",
                          item: { ...dialog.item, members },
                        },
                        { member: form.member || members[0] },
                      )
                    }
                  >
                    移除成员
                  </button>
                  <button
                    type="button"
                    className="av-button"
                    disabled={
                      !can(
                        dialog.item.status === "enabled"
                          ? "admin:DisableGroup"
                          : "admin:EnableGroup",
                      )
                    }
                    onClick={() =>
                      confirm(
                        dialog.item.status === "enabled" ? "停用组" : "启用组",
                        "更改组状态将影响该组成员获得的权限。",
                        "/groups/" + encodeURIComponent(dialog.item.name),
                        "PUT",
                        {
                          status:
                            dialog.item.status === "enabled"
                              ? "disabled"
                              : "enabled",
                        },
                      )
                    }
                  >
                    {dialog.item.status === "enabled" ? "停用组" : "启用组"}
                  </button>
                </div>
              </>
            )}
            {dialog.kind === "remove-member" && (
              <>
                <FieldLabel label="成员">
                  <input className="av-field" readOnly value={form.member} />
                </FieldLabel>
                <p className="v2-muted">移除成员不会删除用户账户。</p>
              </>
            )}
            {dialog.kind === "add-member" && (
              <FieldLabel label="成员">
                <select
                  className="v2-select"
                  required
                  value={form.member || ""}
                  onChange={(e) => change("member", e.target.value)}
                >
                  <option value="">选择用户</option>
                  {options.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </FieldLabel>
            )}
            {dialog.kind === "version" && (
              <>
                <FieldLabel label="当前状态">
                  <input
                    className="av-field"
                    readOnly
                    value={
                      version === "Enabled"
                        ? "已启用"
                        : version === "Suspended"
                          ? "已暂停"
                          : "未启用"
                    }
                  />
                </FieldLabel>
                <p className="v2-muted">
                  {version
                    ? "暂停不会删除历史版本。实际可用性由服务端权限决定。"
                    : "启用后保存对象历史版本。实际可用性由服务端权限决定。"}
                </p>
              </>
            )}
            {dialog.kind === "preview-policy" && (
              <pre className="v2-code">{form.json}</pre>
            )}
            {dialog.kind === "bucket-policy" && (
              <pre className="v2-code">{form.json || "无匿名访问策略"}</pre>
            )}
          </form>
        </Modal>
      )}
    </main>
  );
}
