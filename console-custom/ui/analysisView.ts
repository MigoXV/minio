// SPDX-License-Identifier: AGPL-3.0-or-later
export type TimeRange = [number, number];
export function clampRange(
  start: number,
  end: number,
  duration: number,
): TimeRange {
  return [
    Math.max(0, Math.min(start, end, duration)),
    Math.max(0, Math.min(Math.max(start, end), duration)),
  ];
}
export function zoomRange(
  range: TimeRange,
  anchor: number,
  factor: number,
  duration: number,
): TimeRange {
  const width = Math.min(
    duration,
    Math.max(0.05, (range[1] - range[0]) * factor),
  );
  const ratio = (anchor - range[0]) / (range[1] - range[0] || 1);
  const start = Math.max(0, Math.min(duration - width, anchor - ratio * width));
  return [start, start + width];
}
export function preciseTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
}
