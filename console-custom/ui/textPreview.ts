// SPDX-License-Identifier: AGPL-3.0-or-later

export const TEXT_PREVIEW_BYTES = 1024 * 1024;
export const FORMATTED_TEXT_BYTES = 256 * 1024;

const languages: Record<string, string> = {
  py: "python",
  pyw: "python",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  sql: "sql",
  json: "json",
  jsonl: "json",
  ndjson: "json",
  yml: "yaml",
  yaml: "yaml",
  html: "markup",
  htm: "markup",
  xml: "markup",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
};

function filename(name: string) {
  return name.split("/").pop()?.toLowerCase() || "";
}

function extension(name: string) {
  const file = filename(name);
  return file.includes(".") ? file.split(".").pop() || "" : "";
}

export function textLanguage(name: string) {
  if (/^dockerfile(?:\.|$)/.test(filename(name))) return "docker";
  return languages[extension(name)];
}

export function textFormat(name: string, type: string) {
  const ext = extension(name);
  const mime = type.toLowerCase().split(";")[0].trim();
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (textLanguage(name) === "markdown") return "markdown";
  if (mime === "text/csv") return "csv";
  if (mime === "text/tab-separated-values") return "tsv";
  if (mime === "text/markdown") return "markdown";
  return "text";
}

export function knownBinary(name: string, type: string) {
  const mime = type.toLowerCase().split(";")[0].trim();
  if (mime.startsWith("text/")) return false;
  return (
    /^(zip|rar|7z|gz|tgz|bz2|xz|tar|zst|docx?|xlsx?|pptx?|odt|ods|odp|exe|dll|wasm)$/.test(
      extension(name),
    ) ||
    /^application\/(?:zip|gzip|x-(?:gzip|7z-compressed|rar-compressed|tar|bzip2|xz|msdownload)|vnd\.(?:rar|openxmlformats-officedocument\..+|oasis\.opendocument\..+|ms-(?:excel|powerpoint))|msword|wasm|zstd)$/.test(
      mime,
    )
  );
}

export type TextSample = {
  bytes: Uint8Array;
  truncated: boolean;
  contentType: string;
};

export class TextReadError extends Error {
  constructor(public status: number) {
    super("Text preview request failed");
  }
}

export async function fetchTextSample(
  path: string,
  size: number | undefined,
  signal: AbortSignal,
): Promise<TextSample> {
  const response = await fetch(path, {
    credentials: "same-origin",
    redirect: "error",
    headers:
      size !== undefined && size > 0
        ? { Range: "bytes=0-" + (TEXT_PREVIEW_BYTES - 1) }
        : undefined,
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new TextReadError(response.status);
  }
  const contentType = response.headers.get("Content-Type") || "";
  const range = response.headers
    .get("Content-Range")
    ?.match(/^bytes 0-(\d+)\/(\d+|\*)$/i);
  const lengthHeader = response.headers.get("Content-Length");
  const length = lengthHeader !== null ? Number(lengthHeader) : NaN;
  // When HTTP applies a content encoding, Content-Length describes the wire body.
  const encoded = response.headers.has("Content-Encoding");
  if (!response.body) {
    if (length === 0)
      return { bytes: new Uint8Array(0), truncated: false, contentType };
    throw new Error("Response body unavailable");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  let truncated =
    response.status === 206 &&
    (!range || range[2] === "*" || Number(range[1]) + 1 < Number(range[2]));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = TEXT_PREVIEW_BYTES - count;
      chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
      count += Math.min(value.length, remaining);
      if (count === TEXT_PREVIEW_BYTES) {
        const fullLength = range ? Number(range[2]) : length;
        truncated ||=
          value.length > remaining || encoded || fullLength !== count;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated, contentType };
}

export type TextEncoding = "auto" | "utf-8" | "gb18030";
export type DecodedText =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "encoding" };

export function decodeText(
  sample: TextSample,
  encoding: TextEncoding,
): DecodedText {
  const { bytes, truncated } = sample;
  const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
  const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
  const chosen =
    encoding !== "auto"
      ? encoding
      : littleEndian
        ? "utf-16le"
        : bigEndian
          ? "utf-16be"
          : "utf-8";
  // Common binary signatures that can also be valid input to a legacy decoder.
  const signature = String.fromCharCode(...bytes.subarray(0, 8));
  if (
    // eslint-disable-next-line no-control-regex -- inspect binary signature bytes
    /^(?:\x89PNG|%PDF-|PK[\x03\x05\x07]|\x1f\x8b|\x7fELF|\x00asm|\xff\xd8\xff)/.test(
      signature,
    )
  ) {
    return { kind: "binary" };
  }
  if (!littleEndian && !bigEndian && bytes.includes(0))
    return { kind: "binary" };
  try {
    // A prefix can end before the rest of a multibyte character arrives.
    const text = new TextDecoder(chosen, { fatal: true }).decode(bytes, {
      stream: truncated,
    });
    const controls =
      // eslint-disable-next-line no-control-regex -- detect binary control characters
      text.match(/[\u0001-\u0008\u000e-\u001a\u001c-\u001f\u007f]/g)?.length ??
      0;
    if (text.includes("\0") || controls > Math.max(1, text.length * 0.01)) {
      return { kind: "binary" };
    }
    return { kind: "text", text };
  } catch {
    return { kind: "encoding" };
  }
}
