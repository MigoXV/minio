// SPDX-License-Identifier: AGPL-3.0-or-later
import { frequencyAtHeight } from "custom/analysisView";

// WaveSurfer supplies time-resampled columns of linear FFT bins and its palette.
export function drawFrequencyRows(
  ctx: CanvasRenderingContext2D,
  frames: Uint8Array[],
  width: number,
  height: number,
  offsetY: number,
  nyquist: number,
  maxHz: number,
  colors: number[][],
) {
  const binCount = frames[0].length;
  const pixels = ctx.createImageData(width, height);
  const lastRow = Math.max(1, height - 1);
  for (let y = 0; y < height; y++) {
    const hz = frequencyAtHeight(y / lastRow, maxHz);
    const bin = Math.min(binCount - 1, (hz * binCount) / nyquist);
    const lower = Math.floor(bin);
    const upper = Math.min(lower + 1, binCount - 1);
    const fraction = bin - lower;
    for (let x = 0; x < width; x++) {
      const frame = frames[Math.floor((x * frames.length) / width)];
      const strength = Math.round(
        frame[lower] + (frame[upper] - frame[lower]) * fraction,
      );
      const [red, green, blue, alpha] = colors[strength];
      const index = 4 * (y * width + x);
      pixels.data[index] = 255 * red;
      pixels.data[index + 1] = 255 * green;
      pixels.data[index + 2] = 255 * blue;
      pixels.data[index + 3] = 255 * alpha;
    }
  }
  ctx.putImageData(pixels, 0, offsetY);
}
