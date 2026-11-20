// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useRef, useState } from "react";
import { Modal, bytes } from "./V2";
import { useSelector } from "react-redux";
import { AppState } from "../store";
import {
  getPolicyAllowedFileExtensions,
  extractFileExtn,
} from "../screens/Console/Buckets/ListBuckets/UploadPermissionUtils";
type Item = {
  file: File;
  key: string;
  progress: number;
  state: "queued" | "sending" | "done" | "error" | "cancelled";
  error?: string;
};
export default function ObjectUpload({
  bucket,
  prefix,
  onClose,
  onDone,
}: {
  bucket: string;
  prefix: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]),
    itemsRef = useRef(items);
  itemsRef.current = items;
  const session = useSelector((s: AppState) => s.console.session);
  const allowed = getPolicyAllowedFileExtensions(
    session?.permissions || {},
    bucket + (prefix ? "/" + prefix.replace(/\/$/, "") : ""),
    ["s3:PutObject", "s3:Put*"],
  );
  const [inputError, setInputError] = useState("");
  const running = useRef(false);
  const active = useRef(new Map<string, XMLHttpRequest>()),
    alive = useRef(true),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      alive.current = false;
      active.current.forEach((x) => x.abort());
    },
    [],
  );
  const patch = (key: string, values: Partial<Item>) => {
    if (alive.current)
      setItems((a) => a.map((i) => (i.key === key ? { ...i, ...values } : i)));
  };
  const add = (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(
      (f) =>
        !allowed || allowed.split(",").includes("." + extractFileExtn(f.name)),
    );
    setInputError(
      valid.length < files.length
        ? "部分文件不符合当前账户允许上传的文件类型：" + allowed
        : "",
    );
    setItems((a) => {
      const keys = new Set(a.map((i) => i.key));
      return [
        ...a,
        ...valid
          .map((file) => ({
            file,
            key: file.webkitRelativePath || file.name,
            progress: 0,
            state: "queued" as const,
          }))
          .filter((i) => !keys.has(i.key)),
      ];
    });
  };
  const run = async (item: Item) => {
    const xhr = new XMLHttpRequest();
    active.current.set(item.key, xhr);
    patch(item.key, { state: "sending", progress: 0, error: "" });
    await new Promise<void>((resolve) => {
      xhr.open(
        "POST",
        "/api/v1/buckets/" +
          encodeURIComponent(bucket) +
          "/objects/upload?prefix=" +
          encodeURIComponent(prefix + item.key),
      );
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          patch(item.key, { progress: Math.round((e.loaded * 100) / e.total) });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300)
          patch(item.key, { state: "done", progress: 100 });
        else {
          let message = "上传失败 (" + xhr.status + ")";
          try {
            message = JSON.parse(xhr.responseText).detailedMessage || message;
          } catch {}
          patch(item.key, { state: "error", error: message });
        }
        resolve();
      };
      xhr.onerror = () => {
        patch(item.key, { state: "error", error: "网络连接中断，请重试。" });
        resolve();
      };
      xhr.onabort = () => {
        patch(item.key, { state: "cancelled" });
        resolve();
      };
      const form = new FormData();
      form.append(String(item.file.size), item.file, item.file.name);
      xhr.send(form);
    });
    active.current.delete(item.key);
  };
  const start = async () => {
    if (running.current) return;
    running.current = true;
    const queue = itemsRef.current.filter(
      (i) =>
        i.state === "queued" || i.state === "error" || i.state === "cancelled",
    );
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (index < queue.length && alive.current) {
          const item = queue[index++];
          if (itemsRef.current.some((i) => i.key === item.key)) await run(item);
        }
      }),
    );
    running.current = false;
    if (alive.current) onDone();
  };
  const uploading = items.some((i) => i.state === "sending");
  return (
    <Modal
      title={"上传到 " + bucket + (prefix ? " / " + prefix : "")}
      description="上传文件或文件夹，传输状态在当前窗口可见。"
      onClose={onClose}
      busy={uploading}
      footer={
        <>
          <button className="av-button" disabled={uploading} onClick={onClose}>
            取消
          </button>
          <button
            className="av-button av-primary"
            disabled={uploading}
            onClick={items.some((i) => i.state !== "done") ? start : onClose}
          >
            {uploading
              ? "正在上传…"
              : items.some((i) => i.state === "error")
                ? "重试失败项"
                : items.some((i) => i.state !== "done")
                  ? "开始上传"
                  : "完成"}
          </button>
        </>
      }
    >
      {inputError && (
        <p className="v2-alert" role="alert">
          {inputError}
        </p>
      )}
      <div
        className="v2-upload-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) add(e.dataTransfer.files);
        }}
      >
        <div className="v2-actions">
          <button
            className="av-button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            上传文件
          </button>
          <button
            className="av-button"
            disabled={uploading}
            onClick={() => folderInput.current?.click()}
          >
            上传文件夹
          </button>
        </div>
      </div>
      <input
        hidden
        ref={fileInput}
        type="file"
        multiple
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={folderInput}
        type="file"
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {items.length > 0 && (
        <div className="v2-upload-list">
          {items.map((i) => (
            <div key={i.key}>
              <span>
                {i.key}
                <small>
                  {bytes(i.file.size)} ·{" "}
                  {i.state === "done"
                    ? "已完成"
                    : i.state === "error"
                      ? i.error
                      : i.state === "cancelled"
                        ? "已取消"
                        : i.state === "sending"
                          ? i.progress + "%"
                          : "等待上传"}
                </small>
                {i.state === "sending" && (
                  <progress
                    max="100"
                    value={i.progress}
                    aria-label={i.key + " 上传进度"}
                  />
                )}
              </span>
              <button
                className="v2-text-button"
                disabled={i.state === "done"}
                onClick={() =>
                  i.state === "sending"
                    ? active.current.get(i.key)?.abort()
                    : setItems((a) => a.filter((x) => x.key !== i.key))
                }
              >
                {i.state === "sending" ? "取消" : "移除"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
