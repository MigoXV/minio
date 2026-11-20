// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import { Link } from "react-router-dom";
import type { Bucket } from "../api/consoleApi";
import { bytes } from "./V2";

export default function BucketCard({ bucket }: { bucket: Bucket }) {
  const name = encodeURIComponent(bucket.name);
  const path = "/browser/" + name;
  const versioning = bucket.details?.versioningSuspended
    ? "版本控制已暂停"
    : bucket.details?.versioning === undefined
      ? "版本控制未知"
      : bucket.details.versioning
        ? "版本控制已启用"
        : "版本控制未启用";
  const access =
    bucket.access?.toLowerCase() === "private"
      ? "私有"
      : bucket.access ||
        (bucket.rw_access?.read && bucket.rw_access.write
          ? "可读写"
          : bucket.rw_access?.read
            ? "可读"
            : bucket.rw_access?.write
              ? "可写"
              : "访问权限未知");
  return (
    <article className="v2-bucket-card">
      <Link className="v2-bucket-name v2-text-button" to={path}>
        {bucket.name}
      </Link>
      <Link
        className="av-button av-ghost v2-bucket-config"
        to={"/manage/buckets/" + name}
      >
        查看配置
      </Link>
      <div className="v2-bucket-summary">
        {bucket.objects !== undefined && (
          <span>
            <strong>{bucket.objects}</strong> 个对象
          </span>
        )}
        {bucket.size !== undefined && <span>{bytes(bucket.size)}</span>}
        {bucket.objects === undefined &&
          bucket.size === undefined &&
          "暂无对象统计"}
      </div>
      <span className="v2-bucket-status">
        {access} · {versioning}
      </span>
      <Link className="av-button v2-bucket-browse" to={path}>
        浏览对象
      </Link>
    </article>
  );
}
