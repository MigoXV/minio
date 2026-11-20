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

export function frequencyToAxis(hz: number) {
  return hz <= 100 ? (0.1 * hz) / 100 : 0.1 + Math.log2(hz / 100);
}

export function frequencyAtHeight(y: number, maxHz: number) {
  const axis = (1 - Math.max(0, Math.min(1, y))) * frequencyToAxis(maxHz);
  return axis <= 0.1 ? (100 * axis) / 0.1 : 100 * 2 ** (axis - 0.1);
}

export function frequencyTicks(maxHz: number) {
  if (!maxHz) return [];
  const limit = frequencyToAxis(maxHz);
  const ticks = [maxHz];
  for (const hz of [4000, 2000, 1000, 500, 200]) {
    if (
      hz < maxHz &&
      frequencyToAxis(ticks[ticks.length - 1]) - frequencyToAxis(hz) >=
        limit * 0.08
    ) {
      ticks.push(hz);
    }
  }
  return [...ticks, 0].map((hz) => ({
    hz,
    top: 100 * (1 - frequencyToAxis(hz) / limit),
  }));
}
