// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Bucket } from "../api/consoleApi";
import "./management.css";
import { Field, PasswordField } from "./Field";
import { hasPermission } from "../common/SecureComponent";
import { IAM_SCOPES } from "../common/SecureComponent/permissions";

type User = {
  name: string;
  status: string;
  policy?: string;
  groups?: string[];
  auth?: { type?: string };
};
type Group = {
  name: string;
  status: string;
  members?: string[];
  policy?: string;
};
type Key = {
  accessKey: string;
  accountStatus: string;
  name?: string;
  description?: string;
  expiration?: string;
};
type Overview = {
  mode?: string;
  region?: string;
  servers?: number;
  domain?: string;
};
type ConfigHelp = {
  subSys: string;
  description: string;
  keysHelp: {
    key: string;
    description: string;
    type: string;
    optional: boolean;
  }[];
};
const base = "/api/v1/manage";
const configNames = [
  "api",
  "browser",
  "identity_openid",
  "identity_ldap",
  "notify_webhook",
  "audit_webhook",
];

async function manage<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      result.error ||
        (response.status === 401
          ? "请重新登录"
          : `请求失败 (${response.status})`),
    );
  return result as T;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="av-manage-empty">{children}</div>;
}

export default function ManagementWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname
    .replace(/^\/manage\/?/, "")
    .split("/")
    .filter(Boolean);
  const area = segments[0] || "overview";
  const name = segments[1] ? decodeURIComponent(segments[1]) : "";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [overview, setOverview] = useState<Overview>({});
  const [group, setGroup] = useState<Group | null>(null);
  const [policy, setPolicy] = useState("");
  const [bucketPolicy, setBucketPolicy] = useState("");
  const [versioning, setVersioning] = useState("");
  const [help, setHelp] = useState<ConfigHelp | null>(null);
  const [account, setAccount] = useState("");
  const [oneTimeKey, setOneTimeKey] = useState<{
    accessKey: string;
    secretKey: string;
  } | null>(null);
  const [form, setForm] = useState({
    name: "",
    password: "",
    members: "",
    policy: "",
    keyName: "",
    description: "",
  });
  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (area === "overview") setOverview(await manage<Overview>("/overview"));
      else if (area === "users") setUsers(await manage<User[]>("/users"));
      else if (area === "groups") {
        setGroups(await manage<string[]>("/groups"));
        setGroup(
          name
            ? await manage<Group>(`/groups/${encodeURIComponent(name)}`)
            : null,
        );
      } else if (area === "policies") {
        setPolicies(await manage<string[]>("/policies"));
        setPolicy(
          name
            ? JSON.stringify(
                await manage<object>(`/policies/${encodeURIComponent(name)}`),
                null,
                2,
              )
            : "",
        );
      } else if (area === "keys") {
        const [items, me] = await Promise.all([
          manage<Key[]>("/keys"),
          manage<{ account: string }>("/me"),
        ]);
        setKeys(items);
        setAccount(me.account);
      } else if (area === "buckets") {
        const result = await api.buckets.listBuckets();
        setBuckets(result.data.buckets || []);
        if (name) {
          const path = `/buckets/${encodeURIComponent(name)}`;
          const [p, v] = await Promise.all([
            manage<{ policy: string }>(`${path}/policy`),
            manage<{ status: string }>(`${path}/versioning`),
          ]);
          setBucketPolicy(p.policy || "");
          setVersioning(v.status || "未启用");
        }
      } else if (area === "config") {
        setHelp(
          name
            ? await manage<ConfigHelp>(`/config/${encodeURIComponent(name)}`)
            : null,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [area, name]);
  useEffect(() => {
    setNotice("");
    setOneTimeKey(null);
  }, [area, name]);
  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    after?: () => void,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await manage(path, method, body);
      setNotice("已保存");
      after?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent, action: () => void) {
    e.preventDefault();
    if (!busy) action();
  }
  const contains = (value: string) =>
    value.toLowerCase().includes(search.toLowerCase());
  const pathFor = (section: string, item = "") =>
    `/manage/${section}${item ? `/${encodeURIComponent(item)}` : ""}`;
  const detailBack = () => navigate(pathFor(area));

  const titles: Record<string, string> = {
    overview: "系统概览",
    buckets: "存储桶管理",
    users: "用户",
    groups: "组",
    policies: "策略",
    keys: "访问密钥",
    config: "系统配置",
  };
  const descriptions: Record<string, string> = {
    overview: "当前实例状态与管理入口。实际数据以服务端为准。",
    buckets: "查看桶配置；匿名访问策略和版本控制由服务端授权。",
    users: "管理本地账户、启停状态和策略关联。",
    groups: "查看组成员与策略，按需调整成员和状态。",
    policies: "查看和编辑 JSON 策略；先核对资源 ARN 与动作。",
    keys: "密钥继承当前账户权限；秘密值仅创建时显示一次。",
    config: "只读字段目录；密码、令牌、网关和路由器不在此回显。",
  };
  const statusLabel = (status: string) =>
    status === "enabled" || status === "on"
      ? "已启用"
      : status === "disabled" || status === "off"
        ? "已停用"
        : status;
  const accessArea = hasPermission("*", [IAM_SCOPES.ADMIN_LIST_USERS])
    ? "users"
    : hasPermission("*", [IAM_SCOPES.ADMIN_LIST_GROUPS])
      ? "groups"
      : hasPermission("*", [IAM_SCOPES.ADMIN_GET_POLICY])
        ? "policies"
        : "keys";
  return (
    <main className="av-manage" aria-label="MinIO 管理工作区">
      <header className="av-manage-header">
        <div>
          <h1>
            {name
              ? `${titles[area] || "管理"} / ${name}`
              : titles[area] || "管理工作区"}
          </h1>
          <p>{descriptions[area] || "当前账户授权决定可用操作。"}</p>
        </div>
        <div className="av-manage-actions">
          {name && (
            <button className="av-button" onClick={detailBack}>
              返回列表
            </button>
          )}
          <button
            className="av-button"
            onClick={() => void load()}
            disabled={busy || loading}
          >
            刷新
          </button>
        </div>
      </header>
      {error && (
        <div className="av-manage-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="av-manage-success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <Empty>正在加载…</Empty>
      ) : (
        <>
          {area === "overview" && (
            <section className="av-manage-section">
              <h2>运行状态</h2>
              <dl className="av-manage-stats">
                <div>
                  <dt>运行模式</dt>
                  <dd>{overview.mode || "单实例 / 未报告"}</dd>
                </div>
                <div>
                  <dt>节点数</dt>
                  <dd>{overview.servers ?? "—"}</dd>
                </div>
                <div>
                  <dt>区域</dt>
                  <dd>{overview.region || "默认"}</dd>
                </div>
                <div>
                  <dt>服务</dt>
                  <dd>运行中</dd>
                </div>
              </dl>
            </section>
          )}
          {area === "overview" && (
            <section className="av-manage-section">
              <h2>管理入口</h2>
              <button
                className="av-manage-list-row"
                onClick={() => navigate(pathFor("buckets"))}
              >
                <span>存储桶配置</span>
                <span>访问策略 · 版本控制</span>
              </button>
              <button
                className="av-manage-list-row"
                onClick={() => navigate(pathFor(accessArea))}
              >
                <span>访问控制</span>
                <span>用户 · 组 · 策略 · 访问密钥</span>
              </button>
              <button
                className="av-manage-list-row"
                onClick={() => navigate(pathFor("config"))}
              >
                <span>系统配置</span>
                <span>查看服务端字段说明</span>
              </button>
            </section>
          )}
          {area === "users" && (
            <>
              <section className="av-manage-section">
                <div className="av-manage-section-head">
                  <h2>用户账户</h2>
                  <Field
                    disabled={busy}
                    className="av-manage-input"
                    aria-label="筛选用户"
                    placeholder="筛选用户名"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="av-manage-table">
                  <div className="av-manage-row av-manage-row-head">
                    <span>用户名</span>
                    <span>状态</span>
                    <span>策略 / 来源</span>
                    <span>操作</span>
                  </div>
                  {users
                    .filter((u) => contains(u.name))
                    .map((u) => (
                      <div className="av-manage-row" key={u.name}>
                        <strong>{u.name}</strong>
                        <span>{statusLabel(u.status)}</span>
                        <span>
                          {u.policy || "未分配"} · {u.auth?.type || "本地"}
                        </span>
                        <span className="av-manage-inline">
                          <button
                            className="av-button"
                            disabled={busy || u.auth?.type === "ldap"}
                            onClick={() =>
                              void mutate(
                                `/users/${encodeURIComponent(u.name)}`,
                                "PUT",
                                {
                                  status:
                                    u.status === "enabled"
                                      ? "disabled"
                                      : "enabled",
                                },
                              )
                            }
                          >
                            {u.status === "enabled" ? "停用" : "启用"}
                          </button>
                          <button
                            className="av-button"
                            disabled={busy || u.auth?.type === "ldap"}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `删除用户 ${u.name}？请先确认其访问密钥与业务依赖。`,
                                )
                              )
                                void mutate(
                                  `/users/${encodeURIComponent(u.name)}`,
                                  "DELETE",
                                );
                            }}
                          >
                            删除
                          </button>
                        </span>
                      </div>
                    ))}
                  {users.length === 0 && <Empty>尚无可管理用户</Empty>}
                </div>
              </section>
              <section className="av-manage-section">
                <h2>创建本地用户</h2>
                <form
                  className="av-manage-form"
                  onSubmit={(e) =>
                    submit(
                      e,
                      () =>
                        void mutate(
                          "/users",
                          "POST",
                          { name: form.name, password: form.password },
                          () =>
                            setForm((f) => ({ ...f, name: "", password: "" })),
                        ),
                    )
                  }
                >
                  <label>
                    用户名
                    <Field
                      disabled={busy}
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    初始密码
                    <PasswordField
                      disabled={busy}
                      required
                      minLength={8}
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="av-button av-primary" disabled={busy}>
                    创建用户
                  </button>
                </form>
              </section>
              <section className="av-manage-section">
                <h2>分配或撤销策略</h2>
                <form
                  className="av-manage-form"
                  onSubmit={(e) =>
                    submit(
                      e,
                      () =>
                        void mutate("/associations", "POST", {
                          user: form.name,
                          policy: form.policy,
                          remove: false,
                        }),
                    )
                  }
                >
                  <label>
                    用户名
                    <Field
                      disabled={busy}
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </label>
                  <label>
                    策略
                    <select
                      required
                      value={form.policy}
                      onFocus={() =>
                        void manage<string[]>("/policies").then(setPolicies)
                      }
                      onChange={(e) => update("policy", e.target.value)}
                    >
                      <option value="">请选择</option>
                      {policies.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <button className="av-button" disabled={busy}>
                    附加策略
                  </button>
                  <button
                    type="button"
                    className="av-button"
                    disabled={busy || !form.name || !form.policy}
                    onClick={() =>
                      void mutate("/associations", "POST", {
                        user: form.name,
                        policy: form.policy,
                        remove: true,
                      })
                    }
                  >
                    撤销关联
                  </button>
                </form>
              </section>
            </>
          )}
          {area === "groups" && (
            <>
              <section className="av-manage-section">
                <h2>用户组</h2>
                <div className="av-manage-table">
                  <div className="av-manage-list-head">
                    <span>组名</span>
                    <span>说明</span>
                  </div>
                  {groups.map((g) => (
                    <button
                      className="av-manage-list-row"
                      key={g}
                      onClick={() => navigate(pathFor("groups", g))}
                    >
                      <strong>{g}</strong>
                      <span>查看成员与策略 →</span>
                    </button>
                  ))}
                  {groups.length === 0 && <Empty>尚无用户组</Empty>}
                </div>
              </section>
              {name && group && (
                <section className="av-manage-section">
                  <h2>
                    {group.name} · {statusLabel(group.status)}
                  </h2>
                  <p>成员：{group.members?.join("、") || "无"}</p>
                  <p>策略：{group.policy || "未分配"}</p>
                  <form
                    className="av-manage-form"
                    onSubmit={(e) =>
                      submit(
                        e,
                        () =>
                          void mutate("/associations", "POST", {
                            group: name,
                            policy: form.policy,
                            remove: false,
                          }),
                      )
                    }
                  >
                    <label>
                      附加策略
                      <Field
                        disabled={busy}
                        required
                        value={form.policy}
                        onChange={(e) => update("policy", e.target.value)}
                      />
                    </label>
                    <button className="av-button" disabled={busy}>
                      附加
                    </button>
                    <button
                      type="button"
                      className="av-button"
                      disabled={busy || !form.policy}
                      onClick={() =>
                        void mutate("/associations", "POST", {
                          group: name,
                          policy: form.policy,
                          remove: true,
                        })
                      }
                    >
                      撤销
                    </button>
                  </form>
                  <form
                    className="av-manage-form"
                    onSubmit={(e) =>
                      submit(
                        e,
                        () =>
                          void mutate(
                            `/groups/${encodeURIComponent(name)}`,
                            "PUT",
                            { member: form.members.trim(), remove: false },
                          ),
                      )
                    }
                  >
                    <label>
                      添加成员
                      <Field
                        disabled={busy}
                        required
                        value={form.members}
                        onChange={(e) => update("members", e.target.value)}
                      />
                    </label>
                    <button className="av-button" disabled={busy}>
                      添加成员
                    </button>
                    <button
                      type="button"
                      className="av-button"
                      disabled={busy || !form.members.trim()}
                      onClick={() =>
                        void mutate(
                          `/groups/${encodeURIComponent(name)}`,
                          "PUT",
                          { member: form.members.trim(), remove: true },
                        )
                      }
                    >
                      移除成员
                    </button>
                    <button
                      type="button"
                      className="av-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          `/groups/${encodeURIComponent(name)}`,
                          "PUT",
                          {
                            status:
                              group.status === "enabled"
                                ? "disabled"
                                : "enabled",
                          },
                        )
                      }
                    >
                      {group.status === "enabled" ? "停用组" : "启用组"}
                    </button>
                  </form>
                </section>
              )}
              <section className="av-manage-section">
                <h2>创建用户组</h2>
                <form
                  className="av-manage-form"
                  onSubmit={(e) =>
                    submit(
                      e,
                      () =>
                        void mutate("/groups", "POST", {
                          name: form.name,
                          members: form.members
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        }),
                    )
                  }
                >
                  <label>
                    组名
                    <Field
                      disabled={busy}
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </label>
                  <label>
                    初始成员（逗号分隔）
                    <Field
                      disabled={busy}
                      required
                      value={form.members}
                      onChange={(e) => update("members", e.target.value)}
                    />
                  </label>
                  <button className="av-button av-primary" disabled={busy}>
                    创建组
                  </button>
                </form>
              </section>
            </>
          )}
          {area === "policies" && (
            <>
              <section className="av-manage-section">
                <h2>策略列表</h2>
                <div className="av-manage-table">
                  {policies.filter(contains).map((p) => (
                    <button
                      className="av-manage-list-row"
                      key={p}
                      onClick={() => navigate(pathFor("policies", p))}
                    >
                      <strong>{p}</strong>
                      <span>查看 JSON →</span>
                    </button>
                  ))}
                  {policies.length === 0 && <Empty>尚无策略</Empty>}
                </div>
              </section>
              <section className="av-manage-section">
                <h2>{name ? `编辑策略 ${name}` : "创建策略"}</h2>
                <p>
                  编辑前核对资源 ARN 和动作；服务端会验证策略格式。不要将
                  admin:* 用于普通桶访问。
                </p>
                <form
                  onSubmit={(e) =>
                    submit(e, () => {
                      let document: object;
                      try {
                        document = JSON.parse(policy);
                      } catch {
                        setError("策略不是有效的 JSON");
                        return;
                      }
                      const policyName = name || form.name;
                      if (!policyName) {
                        setError("请填写策略名称");
                        return;
                      }
                      void mutate(
                        `/policies/${encodeURIComponent(policyName)}`,
                        "PUT",
                        document,
                      );
                    })
                  }
                >
                  {!name && (
                    <label className="av-manage-label">
                      策略名
                      <Field
                        disabled={busy}
                        required
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                      />
                    </label>
                  )}
                  <textarea
                    className="av-manage-code"
                    aria-label="策略 JSON"
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                    placeholder={
                      '{\n  "Version": "2012-10-17",\n  "Statement": []\n}'
                    }
                  />
                  <div className="av-manage-inline">
                    <button className="av-button av-primary" disabled={busy}>
                      保存策略
                    </button>
                    {name && (
                      <button
                        type="button"
                        className="av-button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `删除策略 ${name}？已关联主体会受到影响。`,
                            )
                          )
                            void mutate(
                              `/policies/${encodeURIComponent(name)}`,
                              "DELETE",
                              undefined,
                              detailBack,
                            );
                        }}
                      >
                        删除策略
                      </button>
                    )}
                  </div>
                </form>
              </section>
            </>
          )}
          {area === "keys" && (
            <>
              <section className="av-manage-section">
                <h2>{account ? `${account} 的访问密钥` : "访问密钥"}</h2>
                <p>
                  新密钥继承当前账户权限。密钥秘密值仅在创建成功后显示一次。
                </p>
                <div className="av-manage-table">
                  <div className="av-manage-list-head av-manage-key-head">
                    <span>名称</span>
                    <span>状态</span>
                    <span>到期</span>
                    <span>操作</span>
                  </div>
                  {keys.map((k) => (
                    <div className="av-manage-key-row" key={k.accessKey}>
                      <div>
                        <strong>{k.name || k.accessKey}</strong>
                        <small>{k.accessKey}</small>
                      </div>
                      <span>{statusLabel(k.accountStatus)}</span>
                      <span>{k.expiration || "未设置"}</span>
                      <button
                        className="av-button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `撤销访问密钥 ${k.accessKey}？使用它的客户端将立即失效。`,
                            )
                          )
                            void mutate(
                              `/keys/${encodeURIComponent(k.accessKey)}`,
                              "DELETE",
                            );
                        }}
                      >
                        撤销
                      </button>
                    </div>
                  ))}
                  {keys.length === 0 && <Empty>尚无访问密钥</Empty>}
                </div>
              </section>
              <section className="av-manage-section">
                <h2>创建访问密钥</h2>
                <form
                  className="av-manage-form"
                  onSubmit={(e) =>
                    submit(e, async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const result = await manage<{
                          accessKey: string;
                          secretKey: string;
                        }>("/keys", "POST", {
                          name: form.keyName,
                          description: form.description,
                        });
                        setOneTimeKey(result);
                        setForm((f) => ({
                          ...f,
                          keyName: "",
                          description: "",
                        }));
                      } catch (ex) {
                        setError(ex instanceof Error ? ex.message : "创建失败");
                      } finally {
                        setBusy(false);
                      }
                    })
                  }
                >
                  <label>
                    名称
                    <Field
                      disabled={busy}
                      value={form.keyName}
                      onChange={(e) => update("keyName", e.target.value)}
                    />
                  </label>
                  <label>
                    说明
                    <Field
                      disabled={busy}
                      value={form.description}
                      onChange={(e) => update("description", e.target.value)}
                    />
                  </label>
                  <button className="av-button av-primary" disabled={busy}>
                    生成密钥
                  </button>
                </form>
                {oneTimeKey && (
                  <div
                    className="av-manage-secret"
                    role="dialog"
                    aria-label="一次性访问密钥"
                  >
                    <strong>请立即保存，关闭后不能再次查看秘密值</strong>
                    <p>
                      Access Key: <code>{oneTimeKey.accessKey}</code>
                    </p>
                    <p>
                      Secret Key: <code>{oneTimeKey.secretKey}</code>
                    </p>
                    <button
                      className="av-button"
                      onClick={() => {
                        setOneTimeKey(null);
                        void load();
                      }}
                    >
                      已保存，关闭
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {area === "buckets" && (
            <>
              <section className="av-manage-section">
                <h2>存储桶</h2>
                <div className="av-manage-table">
                  {buckets
                    .filter((b) => contains(b.name))
                    .map((b) => (
                      <button
                        className="av-manage-list-row"
                        key={b.name}
                        onClick={() => navigate(pathFor("buckets", b.name))}
                      >
                        <strong>{b.name}</strong>
                        <span>{b.access || "访问设置"} · 查看配置 →</span>
                      </button>
                    ))}
                  {buckets.length === 0 && <Empty>尚无可访问存储桶</Empty>}
                </div>
              </section>
              {name && (
                <>
                  <section className="av-manage-section">
                    <h2>匿名访问策略</h2>
                    <p>
                      留空并保存可移除桶策略。公开访问会影响整个策略指定的资源，请逐项核对。
                    </p>
                    <textarea
                      className="av-manage-code"
                      aria-label="桶策略 JSON"
                      value={bucketPolicy}
                      onChange={(e) => setBucketPolicy(e.target.value)}
                    />
                    <button
                      className="av-button av-primary"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`确认更新 ${name} 的匿名访问策略？`))
                          void mutate(
                            `/buckets/${encodeURIComponent(name)}/policy`,
                            "PUT",
                            { policy: bucketPolicy },
                          );
                      }}
                    >
                      保存桶策略
                    </button>
                  </section>
                  <section className="av-manage-section">
                    <h2>版本控制</h2>
                    <p>
                      当前状态：{versioning}
                      。启用后对象更新将保留历史版本；暂停不会删除已有版本。
                    </p>
                    <div className="av-manage-inline">
                      <button
                        className="av-button"
                        disabled={busy || versioning === "Enabled"}
                        onClick={() =>
                          void mutate(
                            `/buckets/${encodeURIComponent(name)}/versioning`,
                            "PUT",
                            { status: "Enabled" },
                          )
                        }
                      >
                        启用
                      </button>
                      <button
                        className="av-button"
                        disabled={busy || versioning !== "Enabled"}
                        onClick={() => {
                          if (window.confirm(`暂停 ${name} 的版本控制？`))
                            void mutate(
                              `/buckets/${encodeURIComponent(name)}/versioning`,
                              "PUT",
                              { status: "Suspended" },
                            );
                        }}
                      >
                        暂停
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          {area === "config" && (
            <>
              <section className="av-manage-section">
                <h2>配置目录</h2>
                <p>
                  此处只显示服务端提供的字段说明，不回显密码、令牌或其他配置值。主机网关、证书与路由器不在这里修改。
                </p>
                <div className="av-manage-table">
                  <div className="av-manage-list-head">
                    <span>分类</span>
                    <span>说明</span>
                  </div>
                  {configNames.map((c) => (
                    <button
                      className="av-manage-list-row"
                      key={c}
                      onClick={() => navigate(pathFor("config", c))}
                    >
                      <strong>{c}</strong>
                      <span>
                        {
                          {
                            api: "HTTP API 行为与限制",
                            browser: "浏览器访问设置",
                            identity_openid: "OIDC 身份提供方",
                            identity_ldap: "LDAP 身份提供方",
                            notify_webhook: "Webhook 事件目标",
                            audit_webhook: "审计 Webhook 目标",
                          }[c]
                        }
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              {name && help && (
                <section className="av-manage-section">
                  <h2>{help.subSys}</h2>
                  <p>{help.description}</p>
                  <div className="av-manage-table">
                    {help.keysHelp?.map((k) => (
                      <div className="av-manage-config-row" key={k.key}>
                        <strong>{k.key}</strong>
                        <span>{k.description}</span>
                        <small>
                          {k.type}
                          {k.optional ? " · 可选" : " · 必填"}
                        </small>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
