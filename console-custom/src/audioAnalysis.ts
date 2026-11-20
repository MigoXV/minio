// SPDX-License-Identifier: AGPL-3.0-or-later
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 10 * 60;
export const MAX_PCM_BYTES = 128 * 1024 * 1024;

export function analysisLimit(size: number, duration: number): string {
  if (size > MAX_AUDIO_BYTES) return "文件超过 64 MiB，保留普通播放和下载，已跳过波形及频谱分析。";
  if (!Number.isFinite(duration) || duration <= 0) return "无法读取音频时长，请尝试下载后播放。";
  if (duration > MAX_AUDIO_SECONDS) return "音频超过 10 分钟，保留普通播放和下载，已跳过波形及频谱分析。";
  return "";
}

// Enforce the cap even when Content-Length or object metadata is missing/wrong.
export async function readLimitedAudio(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`音频读取失败（HTTP ${response.status}），请检查访问权限。`);
  if (Number(response.headers.get("Content-Length")) > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw new Error(analysisLimit(MAX_AUDIO_BYTES + 1, 1));
  }
  if (!response.body) throw new Error("浏览器无法读取音频数据，请下载后播放。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error(analysisLimit(total, 1));
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("Content-Type") || "application/octet-stream" });
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
