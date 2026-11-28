// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BucketCard from "./BucketCard";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { AppState } from "../store";
import { getSessionGrantsWildCard } from "../screens/Console/Buckets/ListBuckets/UploadPermissionUtils";
import { permissionItems } from "../screens/Console/Buckets/ListBuckets/Objects/utils";
import { api } from "../api";
import { Bucket, BucketObject } from "../api/consoleApi";
import { hasPermission } from "../common/SecureComponent";
import {
  Modal,
  PageHeader,
  State,
  FieldLabel,
  V2Icon,
  bytes,
  shortDate,
  errorMessage,
} from "./V2";
import ObjectUpload from "./ObjectUpload";
import ObjectPreview from "./ObjectPreview";
import ObjectBreadcrumbs from "./ObjectBreadcrumbs";
import ObjectDetailsPanel from "./ObjectDetailsPanel";
import WorkspacePopover from "./WorkspacePopover";
import {
  isAudioObject,
  objectBrowserPath,
  subscribeObjectList,
} from "./objectListing";
import Icon from "./Icon";
import "./objectWorkspace.css";
export function objectURL(
  bucket: string,
  name: string,
  version = "",
  preview = false,
) {
  return (
    "/api/v1/buckets/" +
    encodeURIComponent(bucket) +
    "/objects/download?" +
    new URLSearchParams({
      prefix: name,
      ...(version ? { version_id: version } : {}),
      ...(preview ? { preview: "true" } : {}),
    }).toString()
  );
}
type Item = BucketObject & { delete_flag?: boolean };
export default function BrowserWorkspace() {
  const location = useLocation(),
    navigate = useNavigate(),
    parts = location.pathname.split("/"),
    bucket = decodeURIComponent(parts[2] || ""),
    prefix = decodeURIComponent(parts.slice(3).join("/") || "");
  const query = new URLSearchParams(location.search);
  const previewName = bucket ? query.get("preview") || "" : "";
  const previewOpen = !!previewName;
  const [buckets, setBuckets] = useState<Bucket[]>([]),
    [records, setRecords] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<Item | null>(null),
    [detailsState, setDetailsState] = useState<"closed" | "open" | "closing">(
      "closed",
    ),
    [metadata, setMetadata] = useState<Record<string, any>>({}),
    [detailError, setDetailError] = useState(""),
    [detailBusy, setDetailBusy] = useState(false);
  const [sort, setSort] = useState<{
      key: "name" | "size" | "last_modified";
      desc: boolean;
    }>({ key: "name", desc: false }),
    [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(100);
  const [dialog, setDialog] = useState(""),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [dialogError, setDialogError] = useState(""),
    [copied, setCopied] = useState(false),
    [notice, setNotice] = useState("");
  const [rewind, setRewind] = useState(""),
    [versions, setVersions] = useState<Item[]>([]),
    [chosenVersion, setChosenVersion] = useState<Item | null>(null),
    [allVersions, setAllVersions] = useState(false);
  const [tags, setTags] = useState<Array<[string, string]>>([]),
    [expires, setExpires] = useState("3600"),
    [maxExpiry, setMaxExpiry] = useState(604800),
    [share, setShare] = useState("");
  const epoch = useRef(0);
  const objectLayout = useRef<HTMLDivElement>(null);
  const objectRecords = useRef<HTMLTableSectionElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const detailPreview = useRef<HTMLButtonElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const session = useSelector((s: AppState) => s.console.session);
  const can = (action: string, name = prefix) => {
    const resource = bucket ? (name ? bucket + "/" + name : bucket) : "*";
    if (resource === "*") return hasPermission("*", [action]);
    const scopeResource = /s3:(ListBucket|GetBucket)/.test(action)
      ? bucket
      : resource;
    return hasPermission(
      [
        scopeResource,
        ...getSessionGrantsWildCard(session?.permissions || {}, resource, [
          action,
        ]),
      ],
      [action],
    );
  };
  const canPreviewObject = (object: Item) =>
    !!object.name &&
    !object.name.endsWith("/") &&
    !object.is_delete_marker &&
    can("s3:GetObject", object.name);
  const refresh = useCallback(() => setRevision((x) => x + 1), []);
  const go = (b: string, p = "") => navigate(objectBrowserPath(b, p));
  const showDetails = (object: Item, trigger: HTMLButtonElement) => {
    detailTrigger.current = trigger;
    setDetailsState("open");
    setDetail(object);
  };
  const closeDetails = () => {
    setDetailsState("closing");
    detailTrigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (detailsState !== "closing") return;
    const layout = objectLayout.current;
    // Flush the updated grid tracks before looking for the closing transition.
    layout?.getBoundingClientRect();
    const transition = layout?.getAnimations()[0];
    let current = true;
    const finish = () => {
      if (!current) return;
      setDetail(null);
      setDetailsState("closed");
    };
    if (transition) void transition.finished.then(finish, finish);
    else finish();
    return () => {
      current = false;
    };
  }, [detailsState]);
  const setPreview = (object: Item, replace = false) => {
    const search = new URLSearchParams(location.search);
    search.set("preview", object.name || "");
    navigate(
      { pathname: location.pathname, search: search.toString() },
      {
        replace,
        state: {
          ...location.state,
          previewObject: object,
          previewFromList: !replace || location.state?.previewFromList === true,
        },
      },
    );
  };
  const choosePreview = (object: Item, trigger: HTMLButtonElement) => {
    previewTrigger.current =
      trigger.closest("tr")?.querySelector<HTMLButtonElement>(".v2-file-name") ??
      null;
    setPreview(object);
  };
  const closePreview = () => {
    if (location.state?.previewFromList === true) {
      navigate(-1);
      return;
    }
    const search = new URLSearchParams(location.search);
    search.delete("preview");
    navigate(
      { pathname: location.pathname, search: search.toString() },
      { replace: true },
    );
  };
  useLayoutEffect(() => {
    const list = workspace.current;
    if (!list) return;
    const wasPreviewing = list.inert;
    list.inert = previewOpen;
    if (previewOpen || !wasPreviewing) return;
    const trigger = previewTrigger.current;
    previewTrigger.current = null;
    const target = trigger?.isConnected
      ? trigger
      : detailPreview.current ?? objectRecords.current;
    target?.focus({ preventScroll: true });
  }, [previewOpen]);
  useLayoutEffect(() => {
    setFilter("");
    setSelected([]);
    setDetail(null);
    setDetailsState("closed");
    setPage(0);
    setRewind("");
  }, [bucket, prefix, location.pathname]);
  useEffect(() => {
    let alive = true;
    if (!bucket) {
      setLoading(true);
      setError("");
    }
    api.buckets
      .listBuckets()
      .then((r) => {
        if (alive) setBuckets(r.data.buckets || []);
      })
      .catch((e) => {
        if (alive && !bucket) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive && !bucket) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bucket, revision]);
  useLayoutEffect(() => {
    if (!bucket) return;
    setLoading(true);
    setError("");
    setDenied(false);
    setRecords([]);
    const pendingRecords: Item[] = [];
    return subscribeObjectList(
      bucket,
      prefix,
      {
        items: (items) => {
          for (const item of items) pendingRecords.push(item);
        },
        done: () => {
          setRecords(pendingRecords);
          setLoading(false);
        },
        error: (message, status) => {
          if (status === 403) {
            const paths = permissionItems(
              bucket,
              prefix,
              session?.allowResources || [],
            );
            if (paths?.length) {
              setRecords(paths);
              setLoading(false);
              return;
            }
          }
          setDenied(status === 403);
          setError(status === 403 ? "当前账户没有查看此路径的权限。" : message);
          setLoading(false);
        },
      },
      rewind,
    );
  }, [bucket, prefix, revision, rewind, session?.allowResources]);
  useEffect(() => {
    setPage(0);
  }, [filter, sort]);
  useEffect(() => {
    let alive = true;
    setMetadata({});
    setDetailError("");
    if (!detail?.name || detail.name.endsWith("/")) return;
    setDetailBusy(true);
    Promise.all([
      api.buckets.getObjectMetadata(bucket, {
        prefix: detail.name,
        versionID: detail.version_id || "",
      }),
      api.buckets.listObjects(bucket, {
        prefix: detail.name,
        with_metadata: true,
        with_versions: !!detail.version_id,
      }),
    ])
      .then(([m, r]) => {
        if (!alive) return;
        setMetadata(m.data.objectMetadata || {});
        const full = r.data.objects?.find(
          (o) =>
            o.name === detail.name &&
            (!detail.version_id || o.version_id === detail.version_id),
        );
        if (full) setDetail((d) => (d ? { ...d, ...full } : d));
      })
      .catch((e) => {
        if (alive) setDetailError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setDetailBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [bucket, detail?.name, detail?.version_id, revision]);
  const visible = useMemo(
    () =>
      records
        .filter((o) =>
          (o.name || "").toLowerCase().includes(filter.toLowerCase()),
        )
        .sort((a, b) => {
          const k = sort.key,
            cmp =
              k === "size"
                ? (a.size || 0) - (b.size || 0)
                : String(a[k] || "").localeCompare(
                    String(b[k] || ""),
                    undefined,
                    { numeric: true },
                  );
          return sort.desc ? -cmp : cmp;
        }),
    [records, filter, sort],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  useLayoutEffect(() => {
    if (objectRecords.current) objectRecords.current.scrollTop = 0;
  }, [bucket, prefix, currentPage, pageSize, filter, sort]);
  useEffect(() => {
    if (!loading && page !== currentPage) setPage(currentPage);
  }, [loading, page, currentPage]);
  const filteredBuckets = buckets.filter((b) =>
      b.name.toLowerCase().includes(filter.toLowerCase()),
    ),
    bucketInfo = buckets.find((b) => b.name === bucket);
  const objectBytes = useMemo(
    () => records.reduce((sum, object) => sum + (object.size || 0), 0),
    [records],
  );
  const generateShare = async (seconds: string, id = epoch.current) => {
    if (!detail?.name) return;
    setBusy(true);
    setShare("");
    setCopied(false);
    setDialogError("");
    try {
      const r = await api.buckets.shareObject(bucket, {
        prefix: detail.name,
        version_id: detail.version_id || "null",
        expires: seconds + "s",
      });
      if (id === epoch.current) setShare(r.data);
    } catch (e) {
      if (id === epoch.current) setDialogError(errorMessage(e));
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  };
  const copyShare = () =>
    navigator.clipboard
      .writeText(share)
      .then(() => {
        setCopied(true);
        setDialogError("");
      })
      .catch(() => setDialogError("无法自动复制，请选择链接手动复制。"));
  const open = async (kind: string, initial = "") => {
    const id = ++epoch.current;
    setDialog(kind);
    setValue(initial);
    setDialogError("");
    setShare("");
    setCopied(false);
    setChosenVersion(null);
    setAllVersions(false);
    if (kind === "tags")
      setTags(
        Object.keys(detail?.tags || {}).length
          ? Object.entries(detail?.tags || {}).map(([k, v]) => [k, String(v)])
          : [["", ""]],
      );
    if (kind === "share")
      try {
        setBusy(true);
        const r = await api.buckets.getMaxShareLinkExp();
        if (id === epoch.current) {
          setMaxExpiry(r.data.exp);
          setExpires(String(Math.min(604800, r.data.exp)));
          await generateShare(String(Math.min(604800, r.data.exp)), id);
        }
      } catch (e) {
        if (id === epoch.current) {
          setDialogError(errorMessage(e));
          setBusy(false);
        }
      }
    if (kind === "versions" && detail?.name) {
      setVersions([]);
      setBusy(true);
      try {
        const r = await api.buckets.listObjects(bucket, {
          prefix: detail.name,
          with_versions: true,
          with_metadata: true,
          limit: 10000,
        });
        if (id === epoch.current)
          setVersions(
            (r.data.objects || []).filter((o) => o.name === detail.name),
          );
      } catch (e) {
        if (id === epoch.current) setDialogError(errorMessage(e));
      } finally {
        if (id === epoch.current) setBusy(false);
      }
    }
  };
  const close = () => {
    epoch.current++;
    setDialog("");
    setDialogError("");
  };
  const task = async (fn: () => Promise<any>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setDialogError("");
    try {
      await fn();
      if (after) after();
      else {
        close();
        refresh();
        setNotice("操作已完成");
      }
    } catch (e) {
      setDialogError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const download = (o = detail) => {
    if (o?.name) {
      const a = document.createElement("a");
      a.href = objectURL(bucket, o.name, o.version_id);
      a.download = o.name.split("/").pop() || "download";
      document.body.append(a);
      a.click();
      a.remove();
    }
  };
  const downloadSelected = async () => {
    if (selected.length === 1 && !selected[0].endsWith("/")) {
      download(records.find((o) => o.name === selected[0]));
      return;
    }
    setNotice("正在准备下载…");
    try {
      const r = await fetch(
        "/api/v1/buckets/" +
          encodeURIComponent(bucket) +
          "/objects/download-multiple",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selected),
        },
      );
      if (!r.ok) throw new Error("下载失败 (" + r.status + ")");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = bucket + ".zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("下载已开始");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const submit = () => {
    if (dialog === "bucket")
      return task(() => api.buckets.makeBucket({ name: value }));
    if (dialog === "path") {
      const clean = value.split("/").filter(Boolean).join("/");
      if (!clean) return;
      go(bucket, prefix + clean + "/");
      close();
      return;
    }
    if (dialog === "rewind") {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return;
      setRewind(date.toISOString());
      close();
      return;
    }
    if (dialog === "share") return copyShare();
    if (dialog === "tags" && detail?.name) {
      if (new Set(tags.map((t) => t[0])).size !== tags.length) {
        setDialogError("标签键不能重复。");
        return;
      }
      return task(() =>
        api.buckets.putObjectTags(
          bucket,
          { prefix: detail.name!, version_id: detail.version_id || "null" },
          { tags: Object.fromEntries(tags.filter((t) => t[0])) },
        ),
      );
    }
    if (dialog === "delete")
      return task(
        () =>
          api.buckets.deleteMultipleObjects(
            bucket,
            (selected.length
              ? selected
              : detail?.name
                ? [detail.name]
                : []
            ).map((path) => ({
              path,
              recursive: path.endsWith("/"),
              versionID: detail?.name === path ? detail.version_id : undefined,
            })),
            { all_versions: allVersions },
          ),
        () => {
          close();
          setSelected([]);
          setDetail(null);
          setDetailsState("closed");
          refresh();
          setNotice("已删除所选对象");
        },
      );
    if (dialog === "restore" && chosenVersion?.name)
      return task(() =>
        api.buckets.putObjectRestore(bucket, {
          prefix: chosenVersion.name!,
          version_id: chosenVersion.version_id || "",
        }),
      );
  };
  const text = (label: string, fn: () => void, disabled = false) => (
    <button
      type="button"
      className="v2-text-button"
      disabled={disabled}
      onClick={fn}
    >
      {label}
    </button>
  );
  const sortHead = (key: typeof sort.key, label: string) => (
    <th
      className={key === "size" ? "v2-number" : undefined}
      aria-sort={
        sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined
      }
    >
      <button
        type="button"
        className="v2-text-button v2-file-sort"
        onClick={() =>
          setSort({ key, desc: sort.key === key ? !sort.desc : false })
        }
      >
        {label}
        {sort.key === key && (
          <span data-descending={sort.desc}>
            <V2Icon name="objectSort" />
          </span>
        )}
      </button>
    </th>
  );
  const allSelected =
    visible.length > 0 &&
    visible.every((item) => selected.includes(item.name || ""));
  const someSelected =
    !allSelected && visible.some((item) => selected.includes(item.name || ""));
  const selectedSize = records
    .filter((o) => selected.includes(o.name || ""))
    .reduce((s, o) => s + (o.size || 0), 0);
  const detailType = String(
    metadata["Content-Type"] ||
      metadata["content-type"] ||
      detail?.content_type ||
      "",
  );
  const requestedPreview = location.state?.previewObject as Item | undefined;
  const previewRecord = previewOpen
    ? requestedPreview?.name === previewName
      ? requestedPreview
      : records.find((object) => object.name === previewName)
    : undefined;
  const previewObject = previewRecord ?? { name: previewName };
  const previewIndex = previewOpen
    ? visible.findIndex((object) => object.name === previewName)
    : -1;
  const adjacentPreview = (step: number) => {
    if (previewIndex < 0) return;
    for (let i = previewIndex + step; i >= 0 && i < visible.length; i += step) {
      if (canPreviewObject(visible[i])) return visible[i];
    }
  };
  const previous = adjacentPreview(-1);
  const next = adjacentPreview(1);
  return (
    <>
      {previewOpen && (
        <ObjectPreview
          bucket={bucket}
          object={previewObject}
          loading={loading && !previewRecord}
          onPrevious={previous && (() => setPreview(previous, true))}
          onNext={next && (() => setPreview(next, true))}
          onClose={closePreview}
          download={() => download(previewObject)}
        />
      )}
      <main
        ref={workspace}
        className={
          bucket
            ? "v2-page v2-browser" +
              (detailsState === "open" ? " v2-with-details" : "")
            : "v2-page v2-buckets"
        }
        data-list-pending={bucket && loading ? true : undefined}
      >
        {bucket ? (
          <ObjectBreadcrumbs
            key={location.pathname}
            bucket={bucket}
            prefix={prefix}
            buckets={buckets}
            grants={session?.allowResources}
            go={go}
          />
        ) : (
          <PageHeader
            title="存储桶"
            description="浏览对象，或查看存储桶配置。"
            actions={
              <button
                className="av-button av-primary"
                disabled={!can("s3:CreateBucket")}
                onClick={() => open("bucket")}
              >
                创建存储桶
              </button>
            }
          />
        )}
        <div className={"v2-toolbar" + (bucket ? " v2-object-toolbar" : "")}>
          <label className="v2-object-filter">
            {bucket && <Icon name="search" />}
            <input
              className="av-field"
              aria-label={bucket ? "筛选对象" : "筛选存储桶"}
              placeholder={bucket ? "筛选对象" : "筛选存储桶"}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {bucket && (
            <>
              <span className="v2-object-count">
                {bucketInfo?.access?.toLowerCase() === "private" && "私有 · "}
                {records.length} 个对象 · {bytes(objectBytes)}
              </span>
              <span className="v2-object-toolbar-gap" />
              <WorkspacePopover
                className="av-button av-ghost v2-object-more"
                label="更多操作"
                align="end"
                trigger={
                  <>
                    <span>更多操作</span>
                    <V2Icon name="more" />
                  </>
                }
              >
                {text("刷新", refresh, loading)}
                {text("新建路径", () => open("path"), !can("s3:PutObject"))}
                {text(
                  "历史回溯",
                  () => open("rewind"),
                  !can("s3:ListBucketVersions"),
                )}
                {rewind && text("退出回溯", () => setRewind(""))}
              </WorkspacePopover>
              <button
                className="av-button av-primary v2-object-upload"
                disabled={!can("s3:PutObject")}
                onClick={() => open("upload")}
              >
                上传
              </button>
            </>
          )}
        </div>
        {notice && (
          <p className="v2-notice" role="status">
            {notice}
          </p>
        )}
        {rewind && (
          <p className="v2-notice">
            历史快照 · {shortDate(rewind)}。恢复版本后才会修改当前对象。
          </p>
        )}
        {error ? (
          <State
            title={
              denied ? "没有访问权限" : bucket ? "对象读取失败" : "无法加载内容"
            }
            error
            action={
              <button
                className="av-button"
                onClick={denied ? () => go("") : refresh}
              >
                {denied ? "返回存储桶" : "重新加载"}
              </button>
            }
          >
            {denied
              ? "当前账户无法读取此存储桶，请联系管理员核对策略。"
              : error}
          </State>
        ) : !bucket ? (
          <>
            <div className="v2-bucket-list">
              <div className="v2-bucket-grid">
                {filteredBuckets.map((entry) => (
                  <BucketCard key={entry.name} bucket={entry} />
                ))}
              </div>
              <p className="v2-bucket-count v2-muted">
                {filteredBuckets.length} 个存储桶
              </p>
            </div>
            {!filteredBuckets.length && (
              <State
                title={
                  loading
                    ? "正在加载…"
                    : filter
                      ? "没有匹配的存储桶"
                      : "尚未创建存储桶"
                }
              >
                {filter ? "尝试其他名称。" : "创建存储桶以开始存储对象。"}
              </State>
            )}
          </>
        ) : (
          <div
            ref={objectLayout}
            className={
              "v2-object-layout" +
              (detailsState === "open" ? " v2-with-details" : "")
            }
          >
            <div className="v2-object-list">
              <table
                className="v2-table v2-files"
                aria-label="对象列表"
                role="table"
              >
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="选择全部对象"
                        checked={allSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someSelected;
                        }}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? visible.map((o) => o.name || "")
                              : [],
                          )
                        }
                      />
                    </th>
                    {sortHead("name", "名称")}
                    {sortHead("last_modified", "修改时间")}
                    {sortHead("size", "大小")}
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody
                  className="v2-file-records"
                  ref={objectRecords}
                  tabIndex={0}
                  aria-busy={loading}
                >
                  {visible
                    .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                    .map((object, index) => {
                      const name = object.name || "";
                      const label = name.slice(prefix.length) || name;
                      const folder = name.endsWith("/");
                      const audio = isAudioObject(name, object.content_type);
                      const canPreview = canPreviewObject(object);
                      const checked = selected.includes(name);
                      const actionsActive =
                        (checked && selected.length === 1) ||
                        (detail?.name === name && detailsState !== "closed");
                      return (
                        <tr
                          key={name + object.version_id + index}
                          role="row"
                          aria-selected={checked}
                        >
                          <td role="cell">
                            <input
                              type="checkbox"
                              aria-label={"选择 " + name}
                              checked={checked}
                              onChange={(event) =>
                                setSelected((previous) =>
                                  event.target.checked
                                    ? [...previous, name]
                                    : previous.filter((item) => item !== name),
                                )
                              }
                            />
                          </td>
                          <td role="cell">
                            <button
                              type="button"
                              className="v2-text-button v2-file-name"
                              title={label}
                              aria-expanded={
                                folder
                                  ? undefined
                                  : detailsState === "open" &&
                                    detail?.name === name
                              }
                              onClick={(event) =>
                                folder
                                  ? go(bucket, name)
                                  : showDetails(object, event.currentTarget)
                              }
                            >
                              <V2Icon
                                name={
                                  folder
                                    ? "folder"
                                    : audio
                                      ? "objectAudio"
                                      : "file"
                                }
                              />
                              <span className="v2-file-label">{label}</span>
                            </button>
                            <small className="v2-file-secondary">
                              {folder
                                ? "目录"
                                : shortDate(object.last_modified) +
                                  " · " +
                                  bytes(object.size)}
                            </small>
                          </td>
                          <td role="cell">{shortDate(object.last_modified)}</td>
                          <td role="cell" className="v2-number">
                            {folder ? "—" : bytes(object.size)}
                          </td>
                          <td role="cell">
                            {!folder && (
                              <div
                                className="v2-actions v2-file-desktop-actions"
                                data-active={actionsActive || undefined}
                              >
                                <button
                                  type="button"
                                  className="v2-text-button"
                                  disabled={!canPreview}
                                  onClick={(event) =>
                                    choosePreview(object, event.currentTarget)
                                  }
                                >
                                  <V2Icon name="objectPlay" />
                                  {audio ? "试听" : "预览"}
                                </button>
                                <button
                                  type="button"
                                  className="v2-text-button"
                                  onClick={(event) =>
                                    showDetails(object, event.currentTarget)
                                  }
                                >
                                  <V2Icon name="objectPanel" />
                                  详情
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              className="v2-file-next av-button av-ghost"
                              aria-label={
                                (folder ? "打开目录 " : "查看对象详情 ") + name
                              }
                              onClick={(event) => {
                                if (folder) {
                                  go(bucket, name);
                                  return;
                                }
                                setSelected([name]);
                                showDetails(object, event.currentTarget);
                              }}
                            >
                              <V2Icon name="next" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {!loading && !visible.length && (
                    <tr className="v2-file-empty">
                      <td colSpan={5}>
                        <State
                          title={
                            filter
                              ? "没有找到匹配的对象"
                              : prefix
                                ? "此路径暂无对象"
                                : "此存储桶还没有对象"
                          }
                          action={
                            filter ? (
                              <button
                                className="av-button"
                                onClick={() => setFilter("")}
                              >
                                清除筛选
                              </button>
                            ) : can("s3:PutObject") ? (
                              <button
                                className="av-button"
                                onClick={() => open("upload")}
                              >
                                上传文件
                              </button>
                            ) : undefined
                          }
                        >
                          {filter
                            ? "调整关键词，或清除筛选查看全部对象。"
                            : "上传文件或创建路径，开始整理对象。"}
                        </State>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="v2-table-caption">
                <div className="v2-actions v2-file-statistics">
                  <span className="v2-file-totals">
                    {records.length} 个对象 · {bytes(objectBytes)}
                  </span>
                  {selected.length ? (
                    <span className="v2-file-selection">
                      已选 {selected.length} 项 · {bytes(selectedSize)}
                    </span>
                  ) : (
                    <span className="v2-file-filter-count">
                      {visible.length} 个对象
                    </span>
                  )}
                  {selected.length > 0 && (
                    <WorkspacePopover
                      className="av-button av-ghost v2-file-batch"
                      trigger="批量操作"
                    >
                      {text(
                        "下载",
                        () => void downloadSelected(),
                        !can("s3:GetObject"),
                      )}
                      {text(
                        "删除",
                        () => open("delete"),
                        !can("s3:DeleteObject"),
                      )}
                    </WorkspacePopover>
                  )}
                </div>
                <div className="v2-actions v2-file-pagination">
                  <label>
                    每页{" "}
                    <select
                      className="av-field"
                      aria-label="每页显示数量"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(0);
                      }}
                    >
                      {[50, 100, 200, 500].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>{" "}
                    条
                  </label>
                  <button
                    type="button"
                    className="av-button v2-file-page-button"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    上一页
                  </button>
                  <label>
                    <select
                      className="av-field"
                      aria-label="跳转页码"
                      value={currentPage}
                      onChange={(e) => setPage(Number(e.target.value))}
                    >
                      {Array.from({ length: pageCount }, (_, i) => (
                        <option key={i} value={i}>
                          {i + 1}
                        </option>
                      ))}
                    </select>{" "}
                    / {pageCount}
                  </label>
                  <button
                    type="button"
                    className="av-button v2-file-page-button"
                    disabled={currentPage + 1 >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              </div>
            </div>
            <div className="v2-detail-track">
              {detail && detailsState !== "closed" && !previewName && (
                <ObjectDetailsPanel
                  closing={detailsState === "closing"}
                  onClose={closeDetails}
                >
                  <header>
                    <h2>对象详情</h2>
                    <button
                      type="button"
                      className="v2-close"
                      aria-label="关闭对象详情"
                      onClick={closeDetails}
                    >
                      <V2Icon name="objectClose" />
                    </button>
                  </header>
                  <h3 title={detail.name?.split("/").pop()}>
                    {detail.name?.split("/").pop()}
                  </h3>
                  <div className="v2-actions v2-detail-primary-actions">
                    <button
                      ref={detailPreview}
                      className="av-button"
                      onClick={(event) =>
                        choosePreview(
                          { ...detail, content_type: detailType },
                          event.currentTarget,
                        )
                      }
                      disabled={!canPreviewObject(detail)}
                    >
                      {isAudioObject(detail.name, detailType) ? "试听" : "预览"}
                    </button>
                    <button
                      className="av-button"
                      onClick={() => download()}
                      disabled={!can("s3:GetObject", detail.name)}
                    >
                      下载
                    </button>
                    <WorkspacePopover
                      className="av-button av-ghost v2-detail-more"
                      label="更多对象操作"
                      trigger={<V2Icon name="objectMore" />}
                    >
                      {text(
                        "分享",
                        () => open("share"),
                        !can("s3:GetObject", detail.name),
                      )}
                      {text(
                        "标签",
                        () => open("tags"),
                        !can("s3:PutObjectTagging", detail.name),
                      )}
                      {text(
                        "版本",
                        () => open("versions"),
                        !can("s3:ListBucketVersions"),
                      )}
                      {text(
                        "删除",
                        () => {
                          setSelected([]);
                          open("delete");
                        },
                        !can("s3:DeleteObject", detail.name),
                      )}
                    </WorkspacePopover>
                  </div>
                  <div className="v2-object-properties">
                    {detailBusy && (
                      <p className="v2-muted" role="status">
                        正在读取详情…
                      </p>
                    )}
                    {detailError && <p role="alert">{detailError}</p>}
                    <dl>
                      <dt>大小</dt>
                      <dd>{bytes(detail.size)}</dd>
                      <dt>修改时间</dt>
                      <dd>{shortDate(detail.last_modified)}</dd>
                      <dt>内容类型</dt>
                      <dd>{detailType || "—"}</dd>
                    </dl>
                    <details key={detail.name}>
                      <summary>
                        对象属性
                        <V2Icon name="objectNext" />
                      </summary>
                      <dl>
                        <dt>标签</dt>
                        <dd>{Object.keys(detail.tags || {}).length || "无"}</dd>
                        <dt>法律保留</dt>
                        <dd>
                          {detail.legal_hold_status === "ON"
                            ? "已开启"
                            : "已关闭"}
                        </dd>
                        <dt>保留策略</dt>
                        <dd>{detail.retention_mode || "无"}</dd>
                        <dt>ETag</dt>
                        <dd className="v2-etag">
                          {detail.etag || metadata.ETag || "—"}
                        </dd>
                      </dl>
                    </details>
                  </div>
                </ObjectDetailsPanel>
              )}
            </div>
          </div>
        )}
      </main>
      {dialog === "upload" ? (
        <ObjectUpload
          bucket={bucket}
          prefix={prefix}
          onClose={close}
          onDone={refresh}
        />
      ) : (
        dialog && (
          <Modal
            title={
              {
                bucket: "创建存储桶",
                path: "新建路径",
                rewind: "历史回溯",
                share: "分享 " + detail?.name?.split("/").pop(),
                tags: "对象标签",
                delete: "删除所选对象",
                versions: "对象版本",
                restore: "恢复对象版本",
              }[dialog] || "对象操作"
            }
            description={
              {
                bucket: "为对象创建一个独立的存储空间。",
                path: "当前位置 · " + bucket + " / " + prefix,
                rewind: "查看指定时间可见的对象。",
                share: "获得链接的人无需登录即可访问，到期后链接失效。",
                tags:
                  (detail?.name || "") +
                  " · " +
                  (Object.keys(detail?.tags || {}).length
                    ? "编辑对象标签"
                    : "当前没有标签"),
                delete:
                  "将删除 " +
                  (selected.length > 1
                    ? selected.length + " 个所选对象"
                    : (detail?.name || selected[0]) +
                      "（" +
                      bytes(detail?.size) +
                      "）") +
                  "。",
                versions: (detail?.name || "") + " · 历史版本",
                restore: "将所选历史版本恢复为当前对象。",
              }[dialog]
            }
            busy={busy}
            onClose={close}
            footer={
              dialog === "versions" ? (
                <>
                  <button className="av-button" onClick={close}>
                    取消
                  </button>
                  <button className="av-button av-primary" onClick={close}>
                    关闭
                  </button>
                </>
              ) : (
                <>
                  <button className="av-button" onClick={close} disabled={busy}>
                    取消
                  </button>
                  <button
                    form="v2-object-form"
                    type="submit"
                    className="av-button av-primary"
                    disabled={busy || (dialog === "share" && !share)}
                  >
                    {busy
                      ? "正在处理…"
                      : dialog === "share"
                        ? "复制链接"
                        : dialog === "bucket"
                          ? "创建存储桶"
                          : dialog === "delete"
                            ? "确认删除"
                            : dialog === "rewind"
                              ? "查看历史对象"
                              : dialog === "restore"
                                ? "恢复版本"
                                : dialog === "path"
                                  ? "创建路径"
                                  : dialog === "tags"
                                    ? "保存标签"
                                    : "保存"}
                  </button>
                </>
              )
            }
          >
            {dialogError && (
              <div className="v2-alert" role="alert">
                {dialogError}
              </div>
            )}
            <form
              id="v2-object-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {dialog === "bucket" && (
                <>
                  <FieldLabel label="存储桶名称">
                    <input
                      className="av-field"
                      autoFocus
                      required
                      minLength={3}
                      maxLength={63}
                      placeholder="输入存储桶名称"
                      pattern="[a-z0-9][a-z0-9.-]*[a-z0-9]"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </FieldLabel>
                  <p className="v2-muted">
                    名称不能包含空格，请使用符合服务端规则的名称。
                  </p>
                </>
              )}
              {dialog === "path" && (
                <>
                  <FieldLabel label="路径名称">
                    <input
                      className="av-field"
                      required
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </FieldLabel>
                  <p className="v2-muted">
                    新路径创建后，返回当前存储桶继续上传。
                  </p>
                </>
              )}
              {dialog === "rewind" && (
                <>
                  <FieldLabel label="回溯时间">
                    <input
                      className="av-field"
                      type="datetime-local"
                      required
                      max={new Date().toISOString().slice(0, 16)}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </FieldLabel>
                  <p className="v2-muted">
                    仅在存储桶与服务端支持历史版本时可用。
                  </p>
                </>
              )}
              {dialog === "share" && (
                <>
                  <FieldLabel label="有效期">
                    <select
                      className="v2-select"
                      value={expires}
                      disabled={busy}
                      onChange={(e) => {
                        setExpires(e.target.value);
                        setShare("");
                        setCopied(false);
                        void generateShare(e.target.value);
                      }}
                    >
                      {Array.from(
                        new Set([Math.min(3600, maxExpiry), 86400, 604800]),
                      )
                        .filter((v) => v <= maxExpiry)
                        .map((v) => (
                          <option key={v} value={v}>
                            {v >= 86400
                              ? v / 86400 + " 天"
                              : Math.round(v / 60) + " 分钟"}
                          </option>
                        ))}
                    </select>
                  </FieldLabel>
                  <FieldLabel label="分享链接">
                    <input
                      className="av-field"
                      readOnly
                      value={share}
                      placeholder="生成链接后显示"
                    />
                  </FieldLabel>
                  {!share && !busy && dialogError && (
                    <button
                      type="button"
                      className="av-button"
                      onClick={() => generateShare(expires)}
                    >
                      重试生成链接
                    </button>
                  )}
                  {copied && (
                    <p className="v2-notice" role="status">
                      链接已复制。
                    </p>
                  )}
                </>
              )}
              {dialog === "tags" && (
                <>
                  <div className="v2-tag-rows">
                    {tags.map(([k, v], i) => (
                      <div key={i}>
                        <FieldLabel label="标签键">
                          <input
                            className="av-field"
                            required={!!v}
                            placeholder="输入标签键"
                            value={k}
                            onChange={(e) =>
                              setTags((t) =>
                                t.map((x, j) =>
                                  i === j ? [e.target.value, x[1]] : x,
                                ),
                              )
                            }
                          />
                        </FieldLabel>
                        <FieldLabel label="标签值">
                          <input
                            className="av-field"
                            placeholder="输入标签值"
                            value={v}
                            onChange={(e) =>
                              setTags((t) =>
                                t.map((x, j) =>
                                  i === j ? [x[0], e.target.value] : x,
                                ),
                              )
                            }
                          />
                        </FieldLabel>
                        {(tags.length > 1 || k || v) &&
                          text("移除", () =>
                            setTags((t) => t.filter((x, j) => j !== i)),
                          )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="av-button"
                    disabled={tags.length >= 10}
                    onClick={() => setTags((t) => [...t, ["", ""]])}
                  >
                    添加标签
                  </button>
                </>
              )}
              {dialog === "delete" && (
                <>
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      checked={allVersions}
                      onChange={(e) => setAllVersions(e.target.checked)}
                    />
                    同时删除所有版本
                  </label>
                  <p className="v2-muted">
                    删除所有版本不可撤销；保留策略或法律保留可能阻止删除。
                  </p>
                </>
              )}
              {dialog === "versions" && (
                <>
                  <div className="v2-table-wrap">
                    <table className="v2-table">
                      <thead>
                        <tr>
                          <th>名称 / 版本</th>
                          <th>说明</th>
                          <th>状态 / 大小</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.map((v) => (
                          <tr
                            key={v.version_id}
                            aria-selected={
                              chosenVersion?.version_id === v.version_id
                            }
                          >
                            <td>
                              {v.is_latest ? (
                                "当前版本"
                              ) : (
                                <button
                                  className="v2-text-button"
                                  type="button"
                                  onClick={() => setChosenVersion(v)}
                                >
                                  {v.is_delete_marker ? "删除标记" : "历史版本"}
                                </button>
                              )}
                            </td>
                            <td>{shortDate(v.last_modified)}</td>
                            <td>{bytes(v.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!versions.length && !busy && (
                    <p className="v2-muted">未找到历史版本。</p>
                  )}
                  <div className="v2-actions">
                    <button
                      type="button"
                      className="av-button"
                      disabled={
                        !chosenVersion ||
                        !!chosenVersion.is_delete_marker ||
                        !can("s3:PutObject", chosenVersion.name)
                      }
                      onClick={() => setDialog("restore")}
                    >
                      恢复此版本
                    </button>
                    {chosenVersion && !chosenVersion.is_delete_marker && (
                      <button
                        type="button"
                        className="v2-text-button"
                        onClick={() => download(chosenVersion)}
                      >
                        下载此版本
                      </button>
                    )}
                  </div>
                  <p className="v2-muted">
                    版本操作取决于存储桶配置和当前权限。
                  </p>
                </>
              )}
              {dialog === "restore" && (
                <>
                  <FieldLabel label="对象">
                    <input
                      className="av-field"
                      readOnly
                      value={chosenVersion?.name || ""}
                    />
                  </FieldLabel>
                  <FieldLabel label="Version ID">
                    <input
                      className="av-field"
                      readOnly
                      value={chosenVersion?.version_id || "null"}
                    />
                  </FieldLabel>
                </>
              )}
            </form>
          </Modal>
        )
      )}
    </>
  );
}
