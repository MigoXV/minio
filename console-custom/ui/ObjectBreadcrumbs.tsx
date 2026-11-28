// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type { Bucket } from "../api/consoleApi";
import { V2Icon } from "./V2";
import WorkspacePopover from "./WorkspacePopover";
import { objectBrowserPath, subscribeObjectList } from "./objectListing";
import { permissionItems } from "../screens/Console/Buckets/ListBuckets/Objects/utils";

type Grants = Parameters<typeof permissionItems>[2];

function useDirectories(
  bucket: string,
  parent: string,
  grants?: Grants,
  delay = 0,
) {
  const [result, setResult] = useState<{
    parent: string;
    folders: string[];
    error?: string;
  }>();
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const load = () => {
      const paths = new Set<string>();
      const add = (items: Array<{ name?: string }>) => {
        for (const { name } of items) {
          if (!name?.startsWith(parent)) continue;
          const delimiter = name.indexOf("/", parent.length);
          if (delimiter >= 0) paths.add(name.slice(0, delimiter + 1));
        }
      };
      const complete = () =>
        setResult({
          parent,
          folders: [...paths].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true }),
          ),
        });
      cancel = subscribeObjectList(bucket, parent, {
        items: add,
        done: complete,
        error: (message, code) => {
          const allowed =
            code === 403 ? permissionItems(bucket, parent, grants || []) : null;
          if (allowed?.length) {
            add(allowed);
            complete();
          } else {
            setResult({
              parent,
              folders: [],
              error: code === 403 ? "没有读取此层目录的权限。" : message,
            });
          }
        },
      });
    };
    const timer = window.setTimeout(load, delay);
    return () => {
      window.clearTimeout(timer);
      cancel?.();
    };
  }, [bucket, parent, grants, delay]);
  return result?.parent === parent ? result : undefined;
}

function SiblingOptions({
  bucket,
  parent,
  current,
  grants,
  go,
}: {
  bucket: string;
  parent: string;
  current: string;
  grants?: Grants;
  go: (bucket: string, path?: string) => void;
}) {
  const result = useDirectories(bucket, parent, grants);
  const folders = result?.folders.includes(current)
    ? result.folders
    : [...(result?.folders || []), current];
  return (
    <>
      {result?.error && <p role="status">{result.error}</p>}
      {folders.map((folder) => (
        <button
          type="button"
          key={folder}
          aria-current={folder === current ? "true" : undefined}
          onClick={() => {
            if (folder !== current) go(bucket, folder);
          }}
        >
          {folder.slice(parent.length, -1) || "/"}
          {folder === current && <V2Icon name="check" />}
        </button>
      ))}
    </>
  );
}

function PrefixInput({
  bucket,
  prefix,
  grants,
  onNavigate,
  onCancel,
}: {
  bucket: string;
  prefix: string;
  grants?: Grants;
  onNavigate: (prefix: string) => void;
  onCancel: (restoreFocus: boolean) => void;
}) {
  const [value, setValue] = useState(prefix);
  const [active, setActive] = useState(-1);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const parent = value.slice(0, value.lastIndexOf("/") + 1);
  const result = useDirectories(bucket, parent, grants, 150);
  const folders = (result?.folders || [])
    .filter((folder) => folder.startsWith(value))
    .slice(0, 20);
  const selected = folders[active];
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    if (selected)
      document
        .getElementById(id + "-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id, selected]);

  return (
    <>
      <input
        ref={input}
        className="av-field v2-prefix-input"
        role="combobox"
        aria-label="对象前缀"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={id}
        aria-activedescendant={selected ? id + "-" + active : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="输入对象前缀"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setActive(-1);
        }}
        onBlur={() => onCancel(false)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel(true);
          } else if (event.key === "Enter") {
            event.preventDefault();
            onNavigate(
              selected || (value && !value.endsWith("/") ? value + "/" : value),
            );
          } else if (
            folders.length &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
            setActive(
              event.key === "ArrowDown"
                ? (active + 1) % folders.length
                : active <= 0
                  ? folders.length - 1
                  : active - 1,
            );
          }
        }}
      />
      <div className="v2-prefix-options">
        {!folders.length && (
          <p role="status">
            {result ? result.error || "没有匹配的目录" : "正在读取目录…"}
          </p>
        )}
        <div id={id} role="listbox" aria-label="前缀补全">
          {folders.map((folder, index) => (
            <button
              type="button"
              role="option"
              id={id + "-" + index}
              aria-selected={active === index}
              key={folder}
              tabIndex={-1}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onNavigate(folder)}
            >
              <V2Icon name="folder" />
              <span>{folder}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ObjectBreadcrumbs({
  bucket,
  prefix,
  buckets,
  grants,
  go,
}: {
  bucket: string;
  prefix: string;
  buckets: Bucket[];
  grants?: Grants;
  go: (bucket: string, path?: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [editing, setEditing] = useState(false);
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      editButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [bucket, prefix, editing]);
  const levels = prefix ? prefix.replace(/\/$/, "").split("/") : [];
  return (
    <div className="v2-object-address">
      {editing ? (
        <PrefixInput
          bucket={bucket}
          prefix={prefix}
          grants={grants}
          onNavigate={(path) => {
            setEditing(false);
            if (path !== prefix) go(bucket, path);
          }}
          onCancel={(focus) => {
            restoreFocus.current = focus;
            setEditing(false);
          }}
        />
      ) : (
        <>
          <nav ref={ref} className="v2-breadcrumb" aria-label="当前位置">
            <PathSegment
              name={bucket}
              bucketSegment
              to={objectBrowserPath(bucket)}
              current={!prefix}
              menuLabel={"选择同级存储桶 · " + bucket}
            >
              {[...new Set([bucket, ...buckets.map((entry) => entry.name)])]
                .sort()
                .map((name) => (
                  <button
                    type="button"
                    key={name}
                    aria-current={name === bucket ? "true" : undefined}
                    onClick={() => {
                      if (name !== bucket) go(name);
                    }}
                  >
                    {name}
                    {name === bucket && <V2Icon name="check" />}
                  </button>
                ))}
            </PathSegment>
            {levels.map((level, index) => {
              const parent = index
                ? levels.slice(0, index).join("/") + "/"
                : "";
              const current = parent + level + "/";
              return (
                <PathSegment
                  key={current}
                  name={level || "/"}
                  to={objectBrowserPath(bucket, current)}
                  current={index === levels.length - 1}
                  menuLabel={"选择同级目录 · " + (level || "/")}
                >
                  <SiblingOptions
                    bucket={bucket}
                    parent={parent}
                    current={current}
                    grants={grants}
                    go={go}
                  />
                </PathSegment>
              );
            })}
          </nav>
          <button
            type="button"
            className="v2-address-edit"
            ref={editButton}
            onClick={() => setEditing(true)}
          >
            编辑路径
          </button>
        </>
      )}
    </div>
  );
}

function PathSegment({
  name,
  to,
  current,
  menuLabel,
  bucketSegment,
  children,
}: {
  name: string;
  to: string;
  current: boolean;
  menuLabel: string;
  bucketSegment?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={"v2-crumb" + (bucketSegment ? " v2-crumb-bucket" : "")}>
      <Link
        to={to}
        title={name}
        aria-current={current ? "location" : undefined}
      >
        {name}
      </Link>
      <WorkspacePopover
        label={menuLabel}
        className="v2-crumb-toggle"
        trigger={<V2Icon name="crumbDown" />}
      >
        {children}
      </WorkspacePopover>
      {!bucketSegment && (
        <svg
          className="v2-crumb-edge v2-crumb-edge-start"
          viewBox="0 0 8 32"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M0 0L8 16L0 32" />
        </svg>
      )}
      <svg
        className="v2-crumb-edge v2-crumb-edge-end"
        viewBox="0 0 8 32"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 0L8 16L0 32" />
      </svg>
    </div>
  );
}
