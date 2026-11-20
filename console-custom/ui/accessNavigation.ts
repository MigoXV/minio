// SPDX-License-Identifier: AGPL-3.0-or-later
import { hasPermission } from "../common/SecureComponent";
import { IAM_SCOPES } from "../common/SecureComponent/permissions";

export const accessNavigation = [
  { area: "users", label: "用户", scope: IAM_SCOPES.ADMIN_LIST_USERS },
  { area: "groups", label: "用户组", scope: IAM_SCOPES.ADMIN_LIST_GROUPS },
  { area: "policies", label: "策略", scope: IAM_SCOPES.ADMIN_GET_POLICY },
  { area: "keys", label: "访问密钥" },
];

export const availableAccessNavigation = () =>
  accessNavigation.filter(({ scope }) => !scope || hasPermission("*", [scope]));
