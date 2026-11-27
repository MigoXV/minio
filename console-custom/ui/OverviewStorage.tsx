// SPDX-License-Identifier: AGPL-3.0-or-later
import { bytes } from "./V2";
import "./overview-storage.css";

type DriveCapacity = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
};

type Drive = {
  path: string;
  state: "online" | "offline" | "abnormal" | "unknown";
  capacity: DriveCapacity | null;
};

export type StorageNode = {
  endpoint: string;
  drives: Drive[];
};

const driveStates = {
  online: "在线",
  offline: "离线",
  abnormal: "异常",
  unknown: "未知",
} as const;

const usage = (capacity: DriveCapacity) =>
  (capacity.usedBytes / capacity.totalBytes) * 100;

const refreshTime = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function DriveList({ drives }: { drives: Drive[] }) {
  if (drives.length === 0) {
    return <p className="v2-muted v2-drive-empty">暂无驱动器数据。</p>;
  }

  return (
    <ul className="v2-drives">
      {drives.map(({ path, state, capacity }, index) => {
        const percent = capacity ? usage(capacity) : undefined;
        const level =
          percent === undefined
            ? undefined
            : percent >= 90
              ? "critical"
              : percent >= 80
                ? "warning"
                : "normal";
        return (
          <li className="v2-drive" key={path || index}>
            <div className="v2-drive-utilization" data-level={level}>
              <span className="v2-drive-ring">
                <svg viewBox="0 0 72 72" aria-hidden="true">
                  <circle
                    className="v2-drive-ring-track"
                    cx="36"
                    cy="36"
                    r="31"
                  />
                  {percent !== undefined && (
                    <circle
                      className="v2-drive-ring-used"
                      cx="36"
                      cy="36"
                      r="31"
                      pathLength="100"
                      strokeDasharray={`${percent} 100`}
                      transform="rotate(-90 36 36)"
                    />
                  )}
                </svg>
                <span className="v2-drive-ring-readout">
                  <span className="v2-drive-ring-caption">占用率</span>
                  <span className="v2-drive-ring-value">
                    {percent === undefined ? "—" : `${percent.toFixed(1)}%`}
                  </span>
                </span>
              </span>
              {level === "warning" && <small>余量偏低</small>}
              {level === "critical" && <small>接近满盘</small>}
            </div>
            <div className="v2-drive-details">
              <div className="v2-drive-heading">
                <h3 className="v2-drive-path" title={path || undefined}>
                  {path || "—"}
                </h3>
                <span className="v2-drive-state" data-state={state}>
                  {driveStates[state]}
                </span>
              </div>
              <dl className="v2-drive-capacity">
                <div>
                  <dt>总容量</dt>
                  <dd>{bytes(capacity?.totalBytes)}</dd>
                </div>
                <div>
                  <dt>已用</dt>
                  <dd>{bytes(capacity?.usedBytes)}</dd>
                </div>
                <div>
                  <dt>可用</dt>
                  <dd>{bytes(capacity?.availableBytes)}</dd>
                </div>
              </dl>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function OverviewStorage({
  nodes,
  updatedAt,
  refreshFailed,
}: {
  nodes: StorageNode[];
  updatedAt: number;
  refreshFailed: boolean;
}) {
  const counts = { online: 0, offline: 0, abnormal: 0, unknown: 0 };
  let mostUsed:
    | { path: string; endpoint: string; percent: number; available: number }
    | undefined;
  for (const { endpoint, drives } of nodes) {
    for (const { path, state, capacity } of drives) {
      counts[state]++;
      if (!capacity) continue;
      const percent = usage(capacity);
      if (!mostUsed || percent > mostUsed.percent) {
        mostUsed = {
          path,
          endpoint,
          percent,
          available: capacity.availableBytes,
        };
      }
    }
  }
  const hasDrives = Object.values(counts).some((count) => count > 0);

  return (
    <section className="v2-overview-storage" aria-labelledby="storage-title">
      <div className="v2-storage-heading">
        <div>
          <h2 id="storage-title">磁盘容量</h2>
          <p className="v2-muted">
            容量按数据路径所在的文件系统统计，包含该文件系统上的其他数据。
          </p>
        </div>
        <p className="v2-muted" role="status">
          最近成功刷新{" "}
          <time dateTime={new Date(updatedAt).toISOString()}>
            {refreshTime.format(updatedAt)}
          </time>
        </p>
      </div>
      {refreshFailed && (
        <p className="v2-storage-refresh-error" role="status">
          刷新失败，当前显示上次取得的数据。
        </p>
      )}
      {hasDrives && (
        <dl className="v2-storage-summary">
          <div>
            <dt>驱动器状态</dt>
            <dd>
              {counts.online} 在线 · {counts.offline} 离线 · {counts.abnormal}{" "}
              异常
              {counts.unknown > 0 && ` · ${counts.unknown} 未知`}
            </dd>
          </div>
          <div>
            <dt>占用最高</dt>
            <dd className="v2-storage-highest">
              {mostUsed ? (
                <>
                  <span>
                    {nodes.length > 1 &&
                      mostUsed.endpoint &&
                      `${mostUsed.endpoint} · `}
                    {mostUsed.path || "未知路径"}
                  </span>
                  <span>
                    {mostUsed.percent.toFixed(1)}% · 可用{" "}
                    {bytes(mostUsed.available)}
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      )}
      {nodes.length > 1 && hasDrives ? (
        nodes.map(({ endpoint, drives }, index) => (
          <details className="v2-drive-node" key={endpoint || index}>
            <summary>
              {endpoint || "未知节点"}{" "}
              <span className="v2-muted">{drives.length} 个驱动器</span>
            </summary>
            <DriveList drives={drives} />
          </details>
        ))
      ) : (
        <DriveList drives={nodes[0]?.drives ?? []} />
      )}
    </section>
  );
}
