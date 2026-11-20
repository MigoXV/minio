// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BucketObject } from "../api/consoleApi";

export function objectBrowserPath(bucket: string, prefix = "") {
  return (
    "/browser/" +
    encodeURIComponent(bucket) +
    (prefix ? "/" + encodeURIComponent(prefix) : "")
  );
}

export function isAudioObject(name = "", type = "") {
  return (
    type.startsWith("audio/") ||
    /\.(wav|mp3|flac|m4a|ogg|aac|opus)$/i.test(name)
  );
}

export function subscribeObjectList(
  bucket: string,
  prefix: string,
  events: {
    items: (items: BucketObject[]) => void;
    done: () => void;
    error: (message: string, status?: number) => void;
  },
  rewind = "",
) {
  const url = new URL("/ws/objectManager", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  let active = true;
  const finish = (message?: string, status?: number) => {
    if (!active) return;
    active = false;
    socket.close();
    if (message) events.error(message, status);
    else events.done();
  };
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        bucket_name: bucket,
        prefix,
        mode: rewind ? "rewind" : "objects",
        date: rewind || null,
        request_id: 1,
      }),
    );
  socket.onmessage = (event) => {
    if (!active) return;
    let response;
    try {
      response = JSON.parse(event.data);
    } catch {
      finish("收到无法解析的对象列表，请重试。");
      return;
    }
    if (response.request_id !== 1) return;
    if (response.error) {
      finish(
        response.error.APIError?.detailedMessage ||
          response.error.APIError?.message ||
          "无法读取对象列表。",
        response.error.Code,
      );
      return;
    }
    if (response.data) events.items(response.data);
    if (response.request_end) finish();
  };
  socket.onerror = () => finish("无法连接对象列表服务，请重试。");
  socket.onclose = () => finish("列表连接已中断，请刷新重试。");
  return () => {
    if (!active) return;
    active = false;
    socket.close();
  };
}
