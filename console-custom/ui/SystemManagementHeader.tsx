// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import { Link } from "react-router-dom";
import { hasPermission } from "../common/SecureComponent";
import { IAM_SCOPES } from "../common/SecureComponent/permissions";
import { PageHeader } from "./V2";

const pages = [
  { id: "overview", label: "概览", path: "/manage/overview" },
  { id: "config", label: "系统配置", path: "/manage/config" },
  { id: "license", label: "许可证", path: "/license" },
];

export default function SystemManagementHeader({
  active,
  description,
  actions,
}: {
  active: string;
  description: string;
  actions?: React.ReactNode;
}) {
  const canManageSystem = hasPermission("*", [IAM_SCOPES.ADMIN_SERVER_INFO]);
  return (
    <>
      <PageHeader
        title="系统管理"
        description={description}
        actions={actions}
      />
      <nav
        className="v2-tabs v2-system-tabs"
        role="tablist"
        aria-label="系统管理"
      >
        {pages
          .filter(
            ({ id }) => canManageSystem || id === "license" || id === active,
          )
          .map(({ id, label, path }) => (
            <Link key={id} to={path} role="tab" aria-selected={id === active}>
              {label}
            </Link>
          ))}
      </nav>
    </>
  );
}
