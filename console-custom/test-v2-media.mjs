#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end test against an explicitly selected isolated or deployed instance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(
  path.join(repo, ".local/console-workspace/web-app/package.json"),
);
const { Client } = require("minio");
const { chromium, expect } = require("@playwright/test");
const output = path.join(repo, ".local/audio-tests");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const env = Object.fromEntries(
  fs
    .readFileSync(
      process.env.MINIO_TEST_ENV ||
        path.join(repo, ".local/design-sync-test/env"),
      "utf8",
    )
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const p = line.indexOf("=");
      return [line.slice(0, p), line.slice(p + 1)];
    }),
);
const base = process.env.MINIO_TEST_CONSOLE || "http://127.0.0.1:19101";
const s3 = new URL(process.env.MINIO_TEST_S3 || "http://127.0.0.1:19100");
const ca =
  s3.protocol === "https:"
    ? fs.readFileSync(
        process.env.MINIO_TEST_CA ||
          path.join(
            os.homedir(),
            ".local/share/minio-prod/config/certs/ca.crt",
          ),
      )
    : undefined;
const client = new Client({
  endPoint: s3.hostname,
  port: Number(s3.port),
  useSSL: s3.protocol === "https:",
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD,
  ...(s3.protocol === "https:"
    ? { transportAgent: new https.Agent({ ca }) }
    : {}),
});
if (
  !["19101", "19201"].includes(new URL(base).port) ||
  !["19100", "19200"].includes(s3.port) ||
  s3.hostname !== "127.0.0.1" ||
  new URL(base).hostname !== "127.0.0.1"
)
  throw new Error("Media stress tests require the isolated instance");
const bucket = `audio-preview-test-${Date.now()}`;
const names = [];
let browser;
const errors = [];

function wav(seconds = 3) {
  const rate = 16000,
    samples = rate * seconds;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.round(
        16000 *
          (0.2 + 0.8 * Math.sin((Math.PI * 6 * i) / samples) ** 2) *
          Math.sin((2 * Math.PI * 1000 * i) / rate),
      ),
      44 + i * 2,
    );
  return b;
}
async function put(name, data, type) {
  await client.putObject(bucket, name, data, { "Content-Type": type });
  names.push(name);
}

try {
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
  const wave = wav();
  fs.writeFileSync(path.join(output, "tone.wav"), wave);
  const filename = "tone space + 汉字.WAV";
  await put(filename, wave, "application/octet-stream");
  await put("corrupt.wav", Buffer.from("not an audio stream"), "audio/wav");
  await put("long.wav", wav(601), "audio/wav");
  // A valid header with a large payload exercises the metadata size guard.
  const oversized = Buffer.alloc(64 * 1024 * 1024 + 1024);
  wave.copy(oversized, 0, 0, 44);
  oversized.writeUInt32LE(oversized.length - 8, 4);
  oversized.writeUInt32LE(oversized.length - 44, 40);
  await put("oversized.wav", oversized, "audio/wav");
  await put(
    "image.png",
    fs.readFileSync(
      path.join(
        repo,
        ".local/console-workspace/web-app/tests/uploads/internode.png",
      ),
    ),
    "image/png",
  );
  await put(
    "document.pdf",
    fs.readFileSync(
      path.join(
        repo,
        ".local/console-workspace/web-app/tests/uploads/file1.pdf",
      ),
    ),
    "application/pdf",
  );
  const formats = [
    ["mp3", "audio/mpeg"],
    ["flac", "audio/flac"],
    ["ogg", "audio/ogg"],
    ["opus", "audio/ogg"],
    ["m4a", "audio/mp4"],
    ["aac", "audio/aac"],
  ];
  const testFormats = [];
  for (const [ext, mime] of formats) {
    const target = path.join(output, `tone.${ext}`);
    if (process.env.TEST_FFMPEG)
      execFileSync(process.env.TEST_FFMPEG, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        path.join(output, "tone.wav"),
        target,
      ]);
    if (fs.existsSync(target)) {
      await put(`tone.${ext}`, fs.readFileSync(target), mime);
      testFormats.push([ext, mime]);
    }
  }
  const video = path.join(output, "video.mp4");
  if (process.env.TEST_FFMPEG)
    execFileSync(process.env.TEST_FFMPEG, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x120:d=1",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
  const hasVideo = fs.existsSync(video);
  if (hasVideo) await put("video.mp4", fs.readFileSync(video), "video/mp4");
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  const installed = fs
    .readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const executablePath =
    process.env.MINIO_TEST_BROWSER ||
    installed
      .map((name) => path.join(cache, name, "chrome-linux64/chrome"))
      .find((p) => fs.existsSync(p));
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const audioReads = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith("/objects/download") &&
      request.resourceType() === "fetch" &&
      !request.headers().range
    )
      audioReads.push(url.searchParams.get("prefix"));
  });
  page.on("console", (message) => {
    if (
      /appearance-init|inline script/i.test(message.text()) &&
      /Content Security Policy|Refused to execute/i.test(message.text())
    )
      errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const createURL = URL.createObjectURL.bind(URL),
      revokeURL = URL.revokeObjectURL.bind(URL);
    window.__audioBlobURLs = new Set();
    URL.createObjectURL = (blob) => {
      const url = createURL(blob);
      if (
        blob.type.startsWith("audio/") ||
        blob.type === "application/octet-stream"
      )
        window.__audioBlobURLs.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__audioBlobURLs.delete(url);
      revokeURL(url);
    };
    const NativeWorker = window.Worker;
    window.__audioWorkerStats = { created: 0, active: 0, messages: 0 };
    window.Worker = class extends NativeWorker {
      alive = true;
      constructor(...args) {
        super(...args);
        window.__audioWorkerStats.created++;
        window.__audioWorkerStats.active++;
        this.addEventListener("message", (e) => {
          if (e.data.type === "frequenciesResult")
            window.__fftFrames = e.data.result?.[0]?.length;
        });
      }
      postMessage(...args) {
        window.__audioWorkerStats.messages++;
        if (window.__holdAudioFFT && args[0]?.type === "calculateFrequencies")
          return;
        return super.postMessage(...args);
      }
      terminate() {
        if (this.alive) {
          window.__audioWorkerStats.active--;
          this.alive = false;
        }
        super.terminate();
      }
    };
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#accessKey").fill(env.MINIO_ROOT_USER);
  await page.locator("#secretKey").fill(env.MINIO_ROOT_PASSWORD);
  await page.locator("#do-login").click();
  await page.waitForURL("**/browser*");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#acknowledge-confirm")).toBeVisible();
  if (await page.locator("#acknowledge-confirm").isVisible())
    await page.locator("#acknowledge-confirm").click();
  async function open(name) {
    await page.goto(`${base}/browser/${bucket}`, { waitUntil: "networkidle" });
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name, exact: true }) });
    await row.getByRole("button", { name, exact: true }).click();
    await row.getByRole("button", { name: /^(试听|预览)$/ }).click();
  }
  await open(filename);
  await expect(
    page.getByRole("button", { name: "展开频谱图", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  assert.equal(
    await page.locator("audio").evaluate((e) => e.paused),
    true,
    "preview must not autoplay",
  );
  assert.equal(
    await page.evaluate(() => window.__audioWorkerStats.created),
    0,
    "collapsed preview must not create an FFT worker",
  );
  assert.equal(
    audioReads.filter((name) => name === filename).length,
    1,
    "analysis must fetch the audio only once",
  );
  assert.ok(
    (await page.evaluate(() => window.__audioBlobURLs.size)) > 0,
    "the bounded audio Blob should supply playback",
  );
  const waveCanvas = page.getByTestId("audio-waveform");
  await expect(waveCanvas.locator("canvas").first()).toBeVisible();
  const box = await waveCanvas.boundingBox();
  await waveCanvas.click({ position: { x: box.width * 0.5, y: 60 } });
  assert.ok(
    (await page.locator("audio").evaluate((e) => e.currentTime)) > 0.5,
    "waveform click must seek",
  );
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  assert.equal(
    await page.locator("audio").evaluate((e) => e.playbackRate),
    1.5,
  );
  await page.locator("audio").evaluate(async (e) => {
    e.volume = 0.25;
    await e.play();
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("audio").evaluate((e) => e.paused), false);
  await page.locator("audio").evaluate((e) => e.pause());
  const audioPreview = page.getByTestId("audio-preview");
  async function theme(label) {
    if (page.viewportSize().width <= 700) {
      await page.getByRole("button", { name: "导航", exact: true }).click();
      await page.getByRole("button", { name: /^外观 ·/ }).click();
    } else {
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("button", { name: "外观设置", exact: true }).click();
    }
    await page.getByRole("button", { name: new RegExp("^" + label) }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".v2-appearance-page")).toHaveCount(0);
  }
  const preserved = await page.locator("audio").evaluate((e) => ({
    time: e.currentTime,
    volume: e.volume,
    rate: e.playbackRate,
    src: e.currentSrc,
  }));
  await theme("深色 · 苍渊");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyssus");
  assert.deepEqual(
    await page.locator("audio").evaluate((e) => ({
      time: e.currentTime,
      volume: e.volume,
      rate: e.playbackRate,
      src: e.currentSrc,
    })),
    preserved,
  );
  assert.equal(await page.evaluate(() => window.__audioWorkerStats.created), 0);
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "preview-abyssus.png"),
  });
  await theme("浅色 · 白垣");
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "preview-vallum.png"),
  });
  await theme("跟随系统");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "vallum");
  const js = [];
  page.on("request", (r) => {
    if (/\.chunk\.js(?:\?|$)/.test(r.url())) js.push(r.url());
  });
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await expect(
    page.getByText("对数频率 · 0–8 kHz", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByTestId("audio-spectrogram-canvas").locator("canvas").last(),
  ).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = [
      ...document.querySelectorAll(
        '[data-testid="audio-spectrogram-canvas"] canvas',
      ),
    ].find((c) => c.width > 200);
    if (!canvas) return false;
    const context = canvas.getContext("2d");
    const brightness = (frequency) => {
      const axis = (hz) =>
        hz <= 100 ? (0.1 * hz) / 100 : 0.1 + Math.log2(hz / 100);
      const y = Math.round(
        (canvas.height - 1) * (1 - axis(frequency) / axis(8000)),
      );
      const pixels = context.getImageData(
        Math.floor(canvas.width / 2),
        y - 2,
        1,
        5,
      ).data;
      let result = 0;
      for (let i = 0; i < pixels.length; i += 4)
        result = Math.max(result, pixels[i] + pixels[i + 1] + pixels[i + 2]);
      return result;
    };
    return brightness(1000) > brightness(6000) + 80;
  });
  assert.ok(js.length > 0, "spectrogram code must load on first expansion");
  assert.equal(
    audioReads.filter((name) => name === filename).length,
    1,
    "spectrogram must reuse decoded audio without downloading again",
  );
  const stats = await page.evaluate(() => ({ ...window.__audioWorkerStats }));
  assert.equal(
    await page.evaluate(() => window.__fftFrames),
    Math.ceil((48000 * 3 - 1024) / 256),
    "75% overlap must be honored by the actual Worker",
  );
  assert.ok(
    stats.created > 0 && stats.active > 0 && stats.messages > 0,
    "FFT must run in a Worker",
  );
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "waveform-spectrum.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "试听", exact: true }).click();
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await expect(
    page.getByText("对数频率 · 0–8 kHz", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => ({ ...window.__audioWorkerStats })),
    stats,
    "cached spectrum must not create a Worker or submit new FFT work",
  );
  const chart = audioPreview.locator(".av-wave-section .av-chart");
  const spectrumChart = audioPreview.locator(".av-spectrum");
  const slider = audioPreview.getByRole("slider", { name: "平移时间窗口" });
  const player = audioPreview.locator("audio");
  const position = () => player.evaluate((audio) => audio.currentTime);
  const readSelection = async (edge) => {
    const label = await page.getByTestId("selection-" + edge).innerText();
    const [minutes, seconds] = label.split(":").map(Number);
    return minutes * 60 + seconds;
  };
  const dragChart = async (plot, from, to) => {
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
    await page.mouse.up();
  };
  const assertFrequencyCoordinates = async () => {
    const tick = await audioPreview
      .locator('.av-frequency-axis [data-frequency="1000"]')
      .boundingBox();
    const line = await audioPreview
      .locator('.av-frequency-grid [data-frequency="1000"]')
      .boundingBox();
    assert.ok(Math.abs(tick.y + tick.height / 2 - line.y) < 1);
    await page.mouse.move(line.x + line.width / 2, line.y);
    const reading = await audioPreview
      .locator(".v2-cursor-reading")
      .innerText();
    const result = reading.match(/([\d.]+) (kHz|Hz)/);
    assert.ok(result, reading);
    const hz = Number(result[1]) * (result[2] === "kHz" ? 1000 : 1);
    assert.ok(Math.abs(hz - 1000) < 35, reading);
  };
  await expect(slider).toHaveCount(0);
  await expect(
    audioPreview.locator('.av-frequency-axis [data-frequency="0"]'),
  ).toHaveText("0 Hz");
  await expect(
    audioPreview.locator('.av-frequency-axis [data-frequency="100"]'),
  ).toHaveCount(0);
  await assertFrequencyCoordinates();
  const waveBox = await chart.boundingBox();
  await page.mouse.click(waveBox.x + waveBox.width * 0.15, waveBox.y + 35);
  await expect(page.getByTestId("selection-start")).toHaveText("—");
  assert.equal(await player.evaluate((audio) => audio.paused), true);
  await dragChart(chart, 0.15, 0.152);
  await expect(page.getByTestId("selection-start")).toHaveText("—");
  assert.equal(await player.evaluate((audio) => audio.paused), true);
  await dragChart(chart, 0.1, 0.85);
  await expect(
    audioPreview.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await dragChart(spectrumChart, 0.7, 0.3);
  await expect(
    audioPreview.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  assert.ok(Math.abs((await readSelection("start")) - 0.9) < 0.02);
  assert.ok(Math.abs((await readSelection("end")) - 2.1) < 0.02);
  assert.ok(
    Math.abs((await position()) - (await readSelection("start"))) < 0.3,
  );
  await dragChart(chart, 0.25, 0.65);
  await expect(
    audioPreview.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  assert.ok(Math.abs((await readSelection("start")) - 0.75) < 0.02);
  await expect(
    audioPreview.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible({ timeout: 4000 });
  assert.ok(Math.abs((await position()) - (await readSelection("end"))) < 0.02);
  await expect(
    page.getByRole("button", { name: "循环选区", exact: true }),
  ).toBeEnabled();
  const selectionText = await page.getByTestId("selection-start").innerText();
  await page.getByRole("button", { name: "缩放至选区", exact: true }).click();
  await page.waitForTimeout(300);
  const axes = await audioPreview.locator(".av-time-axis").allTextContents();
  assert.equal(axes[0], axes[1], "waveform and spectrum time axes must match");
  assert.ok(
    !axes[0].startsWith("0.000 s"),
    "selection zoom must change viewport",
  );
  await theme("深色 · 苍渊");
  await expect(page.getByTestId("selection-start")).toHaveText(selectionText);
  const scroll = await waveCanvas
    .locator('[part="scroll"]')
    .evaluate((e) => e.scrollLeft);
  const spectrumTransform = await page
    .getByTestId("audio-spectrogram-canvas")
    .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  assert.ok(scroll > 0, "waveform must actually scroll into the selection");
  assert.ok(
    Math.abs(scroll + spectrumTransform) < 2,
    "spectrum drawing must scroll with waveform, not only its labels",
  );
  await assertFrequencyCoordinates();
  await expect(slider).toHaveCount(1);
  const darkStart = await slider.evaluate((input) => input.valueAsNumber);
  const darkPosition = await position();
  await slider.press("ArrowLeft");
  await expect
    .poll(() => slider.evaluate((input) => input.valueAsNumber))
    .toBeLessThan(darkStart - 0.01);
  await slider.press("ArrowRight");
  await expect
    .poll(async () =>
      Math.abs(
        (await slider.evaluate((input) => input.valueAsNumber)) - darkStart,
      ),
    )
    .toBeLessThan(0.01);
  assert.equal(await position(), darkPosition);
  const overlayZ = await audioPreview
    .locator(".av-chart-overlay")
    .first()
    .evaluate((e) => Number(getComputedStyle(e).zIndex));
  assert.ok(overlayZ > 4, "selection must be above the spectrum canvases");

  await page.setViewportSize({ width: 1280, height: 720 });
  const timeRange = (text) =>
    text
      .match(/\d+\.\d+ s/g)
      .filter((_, i, all) => i === 0 || i === all.length - 1)
      .map(parseFloat);
  const initialRange = timeRange(axes[0]);
  await expect
    .poll(async () => {
      const compactAxes = await audioPreview
        .locator(".av-time-axis")
        .allTextContents();
      assert.equal(compactAxes[0], compactAxes[1]);
      return Math.max(
        ...timeRange(compactAxes[0]).map((time, i) =>
          Math.abs(time - initialRange[i]),
        ),
      );
    })
    .toBeLessThan(0.01);
  const plotGeometry = async (selector) => {
    const [waveBounds, spectrumBounds] = await Promise.all(
      [".av-wave-section", "#audio-spectrogram"].map((plot) =>
        audioPreview.locator(plot + " " + selector).boundingBox(),
      ),
    );
    assert.ok(Math.abs(waveBounds.x - spectrumBounds.x) < 1, selector);
    assert.ok(Math.abs(waveBounds.width - spectrumBounds.width) < 1, selector);
  };
  for (const selector of [".av-chart", ".av-selection", ".av-playhead"]) {
    await plotGeometry(selector);
  }
  await expect
    .poll(async () => {
      const left = await waveCanvas
        .locator('[part="scroll"]')
        .evaluate((node) => node.scrollLeft);
      const shift = await page
        .getByTestId("audio-spectrogram-canvas")
        .evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).m41,
        );
      return Math.abs(left + shift);
    })
    .toBeLessThan(2);
  for (const selector of [
    ".v2-transport",
    ".av-wave-section",
    "#audio-spectrogram",
    ".av-analysis-inspector",
    ".av-audio-footer",
  ]) {
    const bounds = await audioPreview.locator(selector).boundingBox();
    assert.ok(bounds.y >= 48 && bounds.y + bounds.height <= 720, selector);
  }
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "analysis-zoom-1280x720.png"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "analysis-selection-abyssus.png"),
  });
  await theme("浅色 · 白垣");
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "analysis-selection-vallum.png"),
  });
  await assertFrequencyCoordinates();
  await expect(slider).toHaveCount(1);
  const pausedPosition = await position();
  await slider.press("Home");
  await expect
    .poll(() => slider.evaluate((input) => input.valueAsNumber))
    .toBeLessThan(0.01);
  await slider.press("ArrowRight");
  await expect
    .poll(() => slider.evaluate((input) => input.valueAsNumber))
    .toBeGreaterThan(0.01);
  await slider.press("End");
  await expect
    .poll(() =>
      slider.evaluate((input) => Number(input.max) - input.valueAsNumber),
    )
    .toBeLessThan(0.01);
  assert.equal(await position(), pausedPosition);
  assert.equal(await player.evaluate((audio) => audio.paused), true);
  assert.equal(
    await waveCanvas
      .locator('[part="scroll"]')
      .evaluate((node) => getComputedStyle(node).scrollbarWidth),
    "none",
  );
  await slider.press("Home");
  const sliderBox = await slider.boundingBox();
  await page.mouse.move(
    sliderBox.x + sliderBox.width * 0.2,
    sliderBox.y + sliderBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sliderBox.x + sliderBox.width * 0.66,
    sliderBox.y + sliderBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(() => slider.evaluate((input) => input.valueAsNumber))
    .toBeGreaterThan(0.5);
  const pannedAxes = await audioPreview
    .locator(".av-time-axis")
    .allTextContents();
  assert.equal(pannedAxes[0], pannedAxes[1]);
  assert.equal(await position(), pausedPosition);

  // Run real touch pointer sequences at the mobile viewport, in both themes.
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await page.context().newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const touchDrag = async (
    locator,
    from,
    to,
    end = "touchEnd",
    height = 0.5,
  ) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const point = (fraction) => ({
      x: box.x + box.width * fraction,
      y: box.y + box.height * height,
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(from)],
    });
    for (let i = 1; i <= 5; i++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(from + ((to - from) * i) / 5)],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: end,
      touchPoints: [],
    });
  };
  for (const label of ["浅色 · 白垣", "深色 · 苍渊"]) {
    await theme(label);
    await expect(slider).toHaveCount(1);
    await slider.press("Home");
    await expect
      .poll(() => slider.evaluate((input) => input.valueAsNumber))
      .toBeLessThan(0.01);
    await touchDrag(slider, 0.2, 0.65);
    await expect
      .poll(() => slider.evaluate((input) => input.valueAsNumber))
      .toBeGreaterThan(0.2);
    const [waveAxis, frequencyAxis] = await audioPreview
      .locator(".av-time-axis")
      .allTextContents();
    assert.equal(waveAxis, frequencyAxis);
    assert.equal(await player.evaluate((audio) => audio.paused), true);
    const previousStart = await page.getByTestId("selection-start").innerText();
    await spectrumChart.scrollIntoViewIfNeeded();
    const plotBox = await spectrumChart.boundingBox();
    const line = await audioPreview
      .locator('.av-frequency-grid [data-frequency="1000"]')
      .boundingBox();
    await touchDrag(
      spectrumChart,
      0.15,
      0.8,
      "touchCancel",
      (line.y - plotBox.y) / plotBox.height,
    );
    await expect(page.getByTestId("selection-start")).toHaveText(previousStart);
    const reading = await audioPreview
      .locator(".v2-cursor-reading")
      .innerText();
    const match = reading.match(/([\d.]+) (kHz|Hz)/);
    assert.ok(match, reading);
    assert.ok(
      Math.abs(Number(match[1]) * (match[2] === "kHz" ? 1000 : 1) - 1000) < 50,
      reading,
    );
    assert.equal(await player.evaluate((audio) => audio.paused), true);
    await touchDrag(spectrumChart, 0.1, 0.8);
    await expect(
      audioPreview.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    const firstTouchStart = await readSelection("start");
    await touchDrag(chart, 0.85, 0.25);
    assert.ok((await readSelection("start")) > firstTouchStart + 0.05);
    await expect(
      audioPreview.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect(
      audioPreview.getByRole("button", { name: "播放", exact: true }),
    ).toBeVisible({ timeout: 4000 });
    const mobileEnd = await readSelection("end");
    assert.ok(Math.abs((await position()) - mobileEnd) < 0.02);

    const loopButton = audioPreview.getByRole("button", {
      name: "循环选区",
      exact: true,
    });
    await loopButton.click();
    await audioPreview
      .getByRole("button", { name: "播放", exact: true })
      .click();
    await page.waitForTimeout(1300);
    assert.equal(await player.evaluate((audio) => audio.paused), false);
    const mobileLoopPosition = await position();
    assert.ok(
      mobileLoopPosition >= (await readSelection("start")) - 0.02 &&
        mobileLoopPosition <= mobileEnd + 0.02,
    );
    await audioPreview
      .getByRole("button", { name: "暂停", exact: true })
      .click();
    await loopButton.click();
    await slider.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      path: path.join(
        output,
        label.includes("白垣")
          ? "analysis-touch-vallum.png"
          : "analysis-touch-abyssus.png",
      ),
    });
  }
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await touch.detach();
  const mobileStart = await slider.evaluate((input) => input.valueAsNumber);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(slider).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs(
        (await slider.evaluate((input) => input.valueAsNumber)) - mobileStart,
      ),
    )
    .toBeLessThan(0.02);
  await page.getByRole("tab", { name: "试听", exact: true }).click();
  await expect(slider).toBeVisible();
  await page.getByRole("tab", { name: "音频分析", exact: true }).click();
  await page.getByRole("button", { name: "显示全段", exact: true }).click();
  await expect(slider).toHaveCount(0);
  const resumeEnd = await readSelection("end");
  await page.getByRole("button", { name: "循环选区", exact: true }).click();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(1800);
  const loopPosition = await position();
  assert.ok(
    loopPosition >= (await readSelection("start")) - 0.02 &&
      loopPosition <= resumeEnd + 0.02,
    `loop playback escaped selection: ${loopPosition}`,
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "清除选区", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "循环选区", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "调整参数", exact: true }).click();
  await page.getByLabel("FFT", { exact: true }).selectOption("2048");
  await page.getByLabel("重叠", { exact: true }).selectOption("0.5");
  await page.getByRole("button", { name: "重新计算", exact: true }).click();
  await expect(page.getByText(/FFT 2048/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("正在计算频谱")).toHaveCount(0, {
    timeout: 20000,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "analysis-1280x720.png"),
  });
  const closeRect = await page.locator(".v2-back").boundingBox();
  assert.ok(
    closeRect.y >= 0 && closeRect.y + closeRect.height <= 720,
    "close must stay on screen",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNav = page.getByRole("button", { name: "导航", exact: true });
  await mobileNav.click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mobileNav).toHaveAttribute("aria-expanded", "false");
  const mobileTransport = await audioPreview
    .locator(".v2-transport")
    .boundingBox();
  const mobileWave = await audioPreview
    .locator(".av-wave-section")
    .boundingBox();
  assert.ok(mobileTransport.y + mobileTransport.height <= mobileWave.y);
  await page.screenshot({
    animations: "disabled",
    path: path.join(output, "analysis-mobile.png"),
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile layout must not overflow horizontally",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log(
    "PASS browser upload/download data path and direct preview integration",
  );
  console.log(
    "PASS appearance persistence, system listener, selection, synchronized zoom, loop, FFT parameters and small-screen layout",
  );
  await page.locator(".v2-back").click();
  await expect(page.getByTestId("audio-preview")).toHaveCount(0);
  assert.equal(
    await page.evaluate(() => window.__audioWorkerStats.active),
    0,
    "closing the modal must terminate its Worker",
  );
  assert.equal(
    await page.evaluate(() => window.__audioBlobURLs.size),
    0,
    "closing the modal must revoke its audio Blob URLs",
  );
  console.log(
    "PASS WAV: no autoplay, waveform, seek, playback, volume, speed, lazy FFT Worker, cached reopening and modal cleanup",
  );

  // Hold an in-flight worker response to deterministically test cancellation.
  await open(filename);
  await expect(
    page.getByRole("button", { name: "展开频谱图", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => {
    window.__holdAudioFFT = true;
  });
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.messages > 0);
  await page.getByRole("tab", { name: "试听", exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  await page.evaluate(() => {
    window.__holdAudioFFT = false;
  });
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await expect(
    page.getByText("对数频率 · 0–8 kHz", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.locator(".v2-back").click();
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  await open(filename);
  await expect(
    page.getByRole("button", { name: "展开频谱图", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => {
    window.__holdAudioFFT = true;
  });
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.messages > 0);
  await page.locator(".v2-back").click();
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  console.log(
    "PASS 1 kHz spectral band and cancellation during FFT on collapse/close, followed by successful retry",
  );

  if (testFormats.length) {
    for (const [ext] of testFormats) {
      await open(`tone.${ext}`);
      await page.waitForFunction(
        () =>
          !!document.querySelector("audio") &&
          (document.querySelector("audio").readyState >= 1 ||
            !!document.querySelector("audio").error),
      );
      const supported = await page.locator("audio").evaluate((e) => !e.error);
      if (supported) {
        await expect(
          page.getByRole("button", { name: "展开频谱图", exact: true }),
        ).toBeVisible({ timeout: 20000 });
        await page.locator("audio").evaluate(async (e) => {
          e.volume = 0;
          await e.play();
          e.pause();
        });
        console.log(`PASS ${ext}: browser playback and waveform`);
      } else {
        await expect(page.getByRole("alert")).toContainText("浏览器无法播放");
        console.log(
          `PASS ${ext}: browser codec unavailable; download fallback shown`,
        );
      }
    }
  }
  await open("long.wav");
  await expect(page.getByText(/音频超过 10 分钟/)).toBeVisible();
  assert.equal(await page.evaluate(() => window.__audioWorkerStats.created), 0);
  await open("oversized.wav");
  await expect(page.getByText(/文件超过 64 MiB/)).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "展开频谱图", exact: true }),
  ).toBeDisabled();
  await open("corrupt.wav");
  await expect(page.getByRole("alert")).toContainText("浏览器无法播放");
  console.log(
    "PASS long, oversized and corrupt audio: graceful playback/download fallback without FFT",
  );
  await page.route("**/objects/download?**", (route) =>
    route.fulfill({ status: 403, body: "Forbidden" }),
  );
  await open(filename);
  await expect(page.getByRole("alert")).toContainText("浏览器无法播放");
  await page.unroute("**/objects/download?**");
  console.log("PASS denied audio read: permission error fallback");

  await open("image.png");
  await expect(page.locator(".v2-image-stage img")).toBeVisible();
  await open("document.pdf");
  await expect(page.locator(".react-pdf__Page canvas").first()).toBeVisible({
    timeout: 20000,
  });
  if (hasVideo) {
    await open("video.mp4");
    await expect(page.locator("video")).toBeVisible();
  }
  console.log("PASS image, PDF and video preview regression");
  assert.deepEqual(errors, [], "unexpected browser exceptions");
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page
        .screenshot({
          animations: "disabled",
          path: path.join(output, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
      fs.writeFileSync(
        path.join(output, "failure.txt"),
        `${error.stack}\n${await page.locator("body").innerText()}\nBrowser errors: ${JSON.stringify(errors)}`,
      );
    }
  }
  throw error;
} finally {
  await browser?.close();
  // Remove every version, including delete markers, belonging to this test bucket.
  const versions = [];
  for await (const object of client.listObjects(bucket, "", true, {
    IncludeVersion: true,
  }))
    versions.push({ name: object.name, versionId: object.versionId });
  if (versions.length) await client.removeObjects(bucket, versions);
  await client.removeBucket(bucket);
  console.log("PASS temporary test objects, versions and bucket removed");
}
