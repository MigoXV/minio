// SPDX-License-Identifier: AGPL-3.0-or-later
export type LoginFailure = {
  kind: "credentials" | "unavailable" | "forbidden";
  message: string;
};

// Console returns 401 for rejected credentials, 503 for an unreachable MinIO.
// Do not expose backend details or depend on every proxy returning JSON.
export function loginFailureFrom(error: unknown): LoginFailure {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : 0;
  if (status === 401)
    return {
      kind: "credentials",
      message: "用户名或密码不正确，请核对后重试。",
    };
  if (status === 400 || status === 403)
    return {
      kind: "forbidden",
      message: "此账户暂时无法登录控制台，请联系管理员。",
    };
  return { kind: "unavailable", message: "暂时无法连接服务，请稍后重试。" };
}
