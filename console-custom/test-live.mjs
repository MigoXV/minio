#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Small production smoke: one short WAV, no load tests or existing data changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(
  path.join(repo, ".local/console-workspace/web-app/package.json"),
);
const { Client } = require("minio");
const { chromium, expect } = require("@playwright/test");
const [s3URL, consoleURL] = process.argv.slice(2);
if (!s3URL || !consoleURL)
  throw new Error("Usage: test-live.mjs <S3 URL> <Console URL>");
const prod =
  process.env.MINIO_PROD_DIR ||
  path.join(os.homedir(), ".local/share/minio-prod");
const env = process.env.MINIO_TEST_ENV
  ? Object.fromEntries(
      fs
        .readFileSync(process.env.MINIO_TEST_ENV, "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    )
  : {
      MINIO_ROOT_USER: fs
        .readFileSync(path.join(prod, "secrets/root-user"), "utf8")
        .trim(),
      MINIO_ROOT_PASSWORD: fs
        .readFileSync(path.join(prod, "secrets/root-password"), "utf8")
        .trim(),
    };
const s3 = new URL(s3URL),
  ca =
    s3.protocol === "https:"
      ? fs.readFileSync(
          process.env.MINIO_TEST_CA || path.join(prod, "config/certs/ca.crt"),
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
const bucket = `ui-release-smoke-${Date.now()}`;
let browser,
  created = false;
try {
  await client.makeBucket(bucket, "us-east-1");
  created = true;
  const rate = 16000,
    samples = rate * 2,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      44 + i * 2,
    );
  await client.putObject(bucket, "release-check.wav", wav, {
    "Content-Type": "audio/wav",
  });
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  const installed = fs
    .readdirSync(cache)
    .filter((x) => /^chromium-\d+$/.test(x))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const executablePath = installed
    .map((x) => path.join(cache, x, "chrome-linux64/chrome"))
    .find((x) => fs.existsSync(x));
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(consoleURL, { waitUntil: "networkidle" });
  await page.locator("#accessKey").fill(env.MINIO_ROOT_USER);
  await page.locator("#secretKey").fill(env.MINIO_ROOT_PASSWORD);
  await page.locator("#do-login").click();
  await page.waitForURL("**/browser*");
  if (await page.locator("#acknowledge-confirm").isVisible())
    await page.locator("#acknowledge-confirm").click();
  await page.goto(`${consoleURL}/browser/${bucket}`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "release-check.wav", exact: true })
    .click();
  await page
    .locator(".v2-object-details")
    .getByRole("button", { name: "试听", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "展开频谱图", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  assert.equal(await page.locator("audio").evaluate((e) => e.paused), true);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("audio").evaluate((e) => e.paused), false);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "展开频谱图", exact: true }).click();
  await expect(
    page.getByTestId("audio-spectrogram-canvas").locator("canvas"),
  ).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByText("正在计算频谱")).toHaveCount(0, {
    timeout: 20000,
  });
  assert.equal(
    await page.locator("audio").evaluate((e) => e.playbackRate),
    1.5,
  );
  const preview = page.getByTestId("audio-preview");
  await page.getByRole("button", { name: /^外观 ·/ }).click();
  await page.getByRole("button", { name: /^深色 · 苍渊/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyssus");
  await page.keyboard.press("Escape");
  await expect(preview).toBeVisible();
  assert.equal(
    await page.locator("audio").evaluate((e) => e.playbackRate),
    1.5,
  );
  const shots = path.join(repo, ".local/figma-v2/live");
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "analysis-dark.png") });
  await page
    .getByRole("button", { name: "返回 " + bucket, exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, "objects-dark.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS live HTTPS console: login, object details, playback, lazy spectrogram, theme and cleanup",
  );
} finally {
  await browser?.close();
  if (created) {
    await client.removeObject(bucket, "release-check.wav");
    await client.removeBucket(bucket);
    console.log("PASS smoke object and bucket removed");
  }
}
