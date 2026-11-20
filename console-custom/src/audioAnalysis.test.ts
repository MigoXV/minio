// SPDX-License-Identifier: AGPL-3.0-or-later
import { analysisLimit, formatAudioTime, MAX_AUDIO_BYTES, readLimitedAudio } from "./audioAnalysis";

test("rejects oversized or long analysis while allowing ordinary short recordings", () => {
  expect(analysisLimit(1024, 30)).toBe("");
  expect(analysisLimit(MAX_AUDIO_BYTES + 1, 30)).toMatch(/64 MiB/);
  expect(analysisLimit(1024, 601)).toMatch(/10 分钟/);
  expect(analysisLimit(1024, Infinity)).not.toBe("");
  expect(formatAudioTime(125.5)).toBe("2:05");
});

test("rejects an unauthorized response before consuming its body", async () => {
  const read = jest.fn();
  await expect(readLimitedAudio({ ok: false, status: 403, body: { getReader: read } } as unknown as Response)).rejects.toThrow(/403/);
  expect(read).not.toHaveBeenCalled();
});

test("stops an oversized transfer even when its advertised size is absent", async () => {
  const value = new Uint8Array(33 * 1024 * 1024);
  const cancel = jest.fn().mockResolvedValue(undefined);
  const releaseLock = jest.fn();
  const read = jest.fn().mockResolvedValue({ done: false, value });
  const response = { ok: true, headers: { get: () => null }, body: { getReader: () => ({ read, cancel, releaseLock }) } } as unknown as Response;
  await expect(readLimitedAudio(response)).rejects.toThrow(/64 MiB/);
  expect(read).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(releaseLock).toHaveBeenCalledTimes(1);
});
