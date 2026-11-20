// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useId, useRef } from "react";
import bucket from "./assets/v2/v2-bucket.svg";
import folder from "./assets/v2/v2-folder.svg";
import grid from "./assets/v2/v2-grid.svg";
import users from "./assets/v2/v2-users.svg";
import settings from "./assets/v2/v2-settings.svg";
import help from "./assets/v2/v2-help.svg";
import file from "./assets/v2/v2-file.svg";
import sun from "./assets/v2/v2-sun.svg";
import logout from "./assets/v2/v2-logout.svg";
import check from "./assets/v2/v2-check.svg";
import back from "./assets/v2/v2-back.svg";
import volume from "./assets/v2/v2-volume.svg";
import close from "./assets/v2/v2-close.svg";

import crumbDown from "./assets/v2/v2-crumb-down.svg";
import mobileMenu from "./assets/v2/v2-mobile-menu.svg";
import more from "./assets/v2/v2-more.svg";
import next from "./assets/v2/v2-next.svg";

import objectAudio from "./assets/v2/v2-object-audio.svg";
import objectPlay from "./assets/v2/v2-object-play.svg";
import objectPanel from "./assets/v2/v2-object-panel.svg";
import objectSort from "./assets/v2/v2-object-sort.svg";
import objectClose from "./assets/v2/v2-object-close.svg";
import objectMore from "./assets/v2/v2-object-more.svg";
import objectNext from "./assets/v2/v2-object-next.svg";

const icons = {
  objectAudio,
  objectPlay,
  objectPanel,
  objectSort,
  objectClose,
  objectMore,
  objectNext,
  crumbDown,
  mobileMenu,
  more,
  next,
  bucket,
  folder,
  grid,
  users,
  settings,
  help,
  file,
  sun,
  logout,
  check,
  back,
  volume,
  close,
};
const sizes = {
  objectAudio: 18,
  objectPlay: 15,
  objectPanel: 15,
  objectSort: 14,
  objectClose: 16,
  objectMore: 16,
  objectNext: 16,
  crumbDown: 12,
  mobileMenu: 18,
  more: 18,
  next: 18,
  bucket: 18,
  folder: 18,
  grid: 18,
  users: 18,
  settings: 18,
  help: 16,
  file: 16,
  sun: 16,
  logout: 16,
  check: 14,
  back: 16,
  volume: 18,
  close: 20,
};
export function V2Icon({
  name,
  size,
}: {
  name: keyof typeof icons;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="v2-icon"
      style={{
        width: size ?? sizes[name],
        height: size ?? sizes[name],
        maskImage: `url(${icons[name]})`,
        WebkitMaskImage: `url(${icons[name]})`,
      }}
    />
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="v2-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="v2-actions">{actions}</div>
    </header>
  );
}
export function State({
  title,
  children,
  action,
  error = false,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  error?: boolean;
}) {
  return (
    <section className="v2-state" role={error ? "alert" : "status"}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <div className="v2-actions">{action}</div>}
    </section>
  );
}
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  busy = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="v2-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) closeRef.current();
      }}
    >
      <div className="v2-dialog-body">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="v2-close"
            aria-label="关闭窗口"
            disabled={busy}
            onClick={onClose}
          >
            <V2Icon name="close" />
          </button>
        </header>
        {description && <p className="v2-description">{description}</p>}
        {children}
        {footer && <footer>{footer}</footer>}
      </div>
    </dialog>
  );
}
export function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const generatedId = useId();
  const field = React.isValidElement(children)
    ? (children as React.ReactElement<any>)
    : null;
  const controlId = field?.props.id || generatedId;
  return (
    <label className="v2-field-label" htmlFor={controlId}>
      <span id={generatedId + "-label"}>{label}</span>
      {field
        ? React.cloneElement(field, {
            id: controlId,
            "aria-labelledby": generatedId + "-label",
          })
        : children}
    </label>
  );
}
export function errorMessage(error: unknown) {
  const e = error as {
    status?: number;
    error?: { detailedMessage?: string; message?: string };
    message?: string;
  };
  return e.status === 403
    ? "当前账户没有执行此操作的权限。"
    : e.status === 401
      ? "登录已过期，请重新登录。"
      : e.error?.detailedMessage ||
        e.error?.message ||
        e.message ||
        "暂时无法完成操作，请重试。";
}
export function bytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value.toFixed(1)} B`;
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
export function shortDate(value?: string) {
  if (!value || value.startsWith("0001-")) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const time = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return d.toDateString() === new Date().toDateString()
    ? `今天 ${time}`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${time}`;
}
