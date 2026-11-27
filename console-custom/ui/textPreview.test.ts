/** @jest-environment node */
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  decodeText,
  fetchTextSample,
  knownBinary,
  textFormat,
  textLanguage,
  TEXT_PREVIEW_BYTES,
} from "./textPreview";

const sample = (bytes: Uint8Array, truncated = false) => ({
  bytes,
  truncated,
  contentType: "",
});
const utf8 = (text: string) => new TextEncoder().encode(text);
const originalFetch = global.fetch;
const fetcher: jest.MockedFunction<typeof fetch> = jest.fn();

beforeEach(() => {
  fetcher.mockReset();
  global.fetch = fetcher;
});
afterAll(() => {
  global.fetch = originalFetch;
});

function mockResponse(
  bytes: Uint8Array | null,
  {
    status = 200,
    headers = {},
  }: { status?: number; headers?: Record<string, string> } = {},
  cancel = jest.fn(),
): Response {
  const entries = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({ value: bytes, done: false })
      .mockResolvedValue({ done: true }),
    releaseLock: jest.fn(),
    cancel,
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => entries.get(name.toLowerCase()) ?? null,
      has: (name: string) => entries.has(name.toLowerCase()),
    },
    body: bytes === null ? null : { getReader: () => reader, cancel },
  } as unknown as Response;
}

test("recognizes special text formats and leaves unknown names eligible for decoding", () => {
  expect(textFormat("x.csv", "text/plain")).toBe("csv");
  expect(textFormat("x", "text/tab-separated-values; charset=utf-8")).toBe(
    "tsv",
  );
  expect(textFormat("README", "text/markdown")).toBe("markdown");
  expect(textLanguage("src/MAIN.C")).toBe("c");
  expect(textLanguage("src/Dockerfile.prod")).toBe("docker");
  expect(knownBinary("README", "application/octet-stream")).toBe(false);
  expect(
    knownBinary(
      "renamed",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  ).toBe(true);
});

test("reads UTF-8, UTF-16 BOMs and explicit GB18030", () => {
  expect(decodeText(sample(utf8("中文")), "auto")).toEqual({
    kind: "text",
    text: "中文",
  });
  expect(decodeText(sample(Uint8Array.of(255, 254, 45, 78)), "auto")).toEqual({
    kind: "text",
    text: "中",
  });
  expect(decodeText(sample(Uint8Array.of(254, 255, 78, 45)), "auto")).toEqual({
    kind: "text",
    text: "中",
  });
  const gb = sample(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4));
  expect(decodeText(gb, "auto")).toEqual({ kind: "encoding" });
  expect(decodeText(gb, "gb18030")).toEqual({ kind: "text", text: "中文" });
  expect(decodeText(sample(Uint8Array.of()), "auto")).toEqual({
    kind: "text",
    text: "",
  });
});

test("handles partial characters and binary filenames", () => {
  const partial = utf8("prefix中").slice(0, -1);
  expect(decodeText(sample(partial, true), "auto")).toEqual({
    kind: "text",
    text: "prefix",
  });
  expect(decodeText(sample(partial), "auto")).toEqual({ kind: "encoding" });
  expect(decodeText(sample(Uint8Array.of(120, 0, 121)), "auto")).toEqual({
    kind: "binary",
  });
  expect(
    decodeText(sample(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)), "gb18030"),
  ).toEqual({ kind: "binary" });
});

test("requests the bounded range and handles a partial response", async () => {
  const signal = new AbortController().signal;
  fetcher.mockResolvedValue(
    mockResponse(utf8("partial"), {
      status: 206,
      headers: {
        "Content-Range": "bytes 0-6/200",
        "Content-Type": "text/plain",
      },
    }),
  );
  expect(await fetchTextSample("/file", 200, signal)).toEqual({
    bytes: utf8("partial"),
    truncated: true,
    contentType: "text/plain",
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/file",
    expect.objectContaining({
      headers: { Range: "bytes=0-1048575" },
      signal,
    }),
  );
});

test("cancels a 200 stream that sends more than the limit", async () => {
  const cancel = jest.fn();
  fetcher.mockResolvedValue(
    mockResponse(new Uint8Array(TEXT_PREVIEW_BYTES + 16), {}, cancel),
  );
  const result = await fetchTextSample(
    "/file",
    undefined,
    new AbortController().signal,
  );
  expect(result.bytes.length).toBe(TEXT_PREVIEW_BYTES);
  expect(result.truncated).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("handles empty objects and distinguishes denied responses", async () => {
  fetcher
    .mockResolvedValueOnce(
      mockResponse(null, { headers: { "Content-Length": "0" } }),
    )
    .mockResolvedValueOnce(mockResponse(utf8("denied"), { status: 403 }));
  const signal = new AbortController().signal;
  expect(await fetchTextSample("/empty", 0, signal)).toMatchObject({
    bytes: new Uint8Array(),
    truncated: false,
  });
  expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
  await expect(fetchTextSample("/denied", 64, signal)).rejects.toMatchObject({
    status: 403,
  });
});
