#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser acceptance uses only an explicitly supplied isolated instance.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(
  path.join(repo, ".local/console-workspace/web-app/package.json"),
);
const { chromium, expect } = require("@playwright/test");
const { Client } = require("minio");
const [s3URL, base, envFile] = process.argv.slice(2);
if (!s3URL || !base || !envFile)
  throw new Error(
    "Usage: test-design-sync.mjs <isolated S3 URL> <isolated Console URL> <synthetic env file>",
  );
if (
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  new URL(base).port !== "19101"
)
  throw new Error("Design acceptance requires the isolated 19101 Console");
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const endpoint = new URL(s3URL);
const client = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port),
  useSSL: false,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD,
});
const output = path.join(repo, ".local/design-sync-test/screenshots");
fs.mkdirSync(output, { recursive: true });
const suffix = Date.now().toString(36),
  bucket = `design-review-${suffix}`,
  user = `design-user-${suffix}`,
  group = `design-group-${suffix}`,
  policy = `design-policy-${suffix}`;
const mediaName = "voice-demo.wav";
const wav = Buffer.alloc(44 + 16000 * 6 * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < (wav.length - 44) / 2; i++)
  wav.writeInt16LE(
    Math.round(7000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
    44 + i * 2,
  );
const cache = path.join(os.homedir(), ".cache/ms-playwright");
const executablePath = fs
  .readdirSync(cache)
  .filter((n) => /^chromium-\d+$/.test(n))
  .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
  .map((n) => path.join(cache, n, "chrome-linux64/chrome"))
  .find((p) => fs.existsSync(p));
let browser,
  page,
  created = false,
  key;
const errors = [],
  captures = [],
  checks = [];
let cookie = "";
async function api(resource, method = "GET", body) {
  const r = await fetch(new URL(`/api/v1${resource}`, base), {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resource === "/login")
    cookie = r.headers.get("set-cookie")?.split(";")[0] || "";
  if (!r.ok) throw new Error(`${method} ${resource}: ${r.status}`);
  return r.status === 204 ? null : r.json();
}
async function capture(name) {
  if (await page.locator(".modalBoxMain").count())
    await expect(page.locator(".modalBoxMain .overlay").last()).toHaveClass(
      /active/,
    );
  if (await page.locator(".av-modal-close").count()) {
    await expect(page.locator(".closeModalButton")).not.toBeVisible();
    const close = page.getByRole("button", { name: "关闭窗口", exact: true });
    await expect(close).toHaveCount(1);
    await expect(close).toHaveCSS("width", "32px");
    await expect(close).toHaveCSS("height", "32px");
  }
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  captures.push(name);
}
async function theme(value) {
  await page
    .getByRole("button", { name: "外观主题", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", {
      name: value === "vallum" ? "浅色 · 白垣" : "深色 · 苍渊",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}
async function selectObject(name) {
  await page.goto(`${base}/browser/${bucket}`, { waitUntil: "networkidle" });
  await page.getByText(name, { exact: true }).click();
  await expect(page.locator("#details-panel")).toHaveCSS("opacity", "1");
}
try {
  await api("/login", "POST", {
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
  });
  await client.makeBucket(bucket);
  created = true;
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
  await client.putObject(bucket, mediaName, wav, {
    "Content-Type": "audio/wav",
  });
  await client.putObject(
    bucket,
    "README.txt",
    Buffer.from("Isolated UI acceptance fixture"),
    { "Content-Type": "text/plain" },
  );
  for (const [name, file, type] of [
    ["image.png", "internode.png", "image/png"],
    ["document.pdf", "file1.pdf", "application/pdf"],
  ])
    await client.putObject(
      bucket,
      name,
      fs.readFileSync(
        path.join(repo, ".local/console-workspace/web-app/tests/uploads", file),
      ),
      { "Content-Type": type },
    );
  const video = path.join(repo, ".local/audio-tests/video.mp4");
  if (fs.existsSync(video))
    await client.putObject(bucket, "video.mp4", fs.readFileSync(video), {
      "Content-Type": "video/mp4",
    });
  await api("/manage/users", "POST", {
    name: user,
    password: "synthetic-review-pass-123",
  });
  await api("/manage/groups", "POST", { name: group, members: [user] });
  await api(`/manage/policies/${policy}`, "PUT", {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
    ],
  });
  key = await api("/manage/keys", "POST", { name: `review-${suffix}` });
  browser = await chromium.launch({ headless: true, executablePath });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.locator(".av-login-form")).toBeVisible();
  assert.equal(
    await page.locator(".av-login-logo").evaluate((n) => n.naturalWidth),
    120,
  );
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await capture(`login-${mode}-${width}`);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#accessKey").fill("incorrect-account");
  await page.locator("#secretKey").fill("incorrect-password");
  const original = await page.locator("#do-login").boundingBox();
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(page.locator("#secretKey")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await page.locator("#do-login").click();
  await expect(page.getByRole("alert")).toHaveText(
    "用户名或密码不正确，请核对后重试。",
  );
  assert.deepEqual(
    await page.locator("#do-login").boundingBox(),
    original,
    "error must not shift login button",
  );
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    await capture(`login-error-${mode}`);
  }
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route("**/api/v1/login", async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "Service unavailable",
    });
  });
  await page.locator("#secretKey").fill("another-incorrect-password");
  await page.locator("#secretKey").press("Enter");
  await expect(page.locator("#do-login")).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("正在验证凭据，请稍候。");
  assert.deepEqual(
    await page.locator("#do-login").boundingBox(),
    original,
    "sending must not shift login button",
  );
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    await capture(`login-sending-${mode}`);
  }
  release();
  await expect(page.getByRole("alert")).toHaveText(
    "暂时无法连接服务，请稍后重试。",
  );
  await page.unroute("**/api/v1/login");
  checks.push(
    "login default/error/pending/service failure, password visibility, stable geometry, responsive themes",
  );
  await page.locator("#accessKey").fill(env.MINIO_ROOT_USER);
  await page.locator("#secretKey").fill(env.MINIO_ROOT_PASSWORD);
  await page.locator("#do-login").click();
  await page.waitForURL("**/browser*");
  if (await page.locator("#acknowledge-confirm").isVisible()) {
    for (const mode of ["vallum", "abyssus"]) {
      await page.evaluate(
        (v) => (document.documentElement.dataset.theme = v),
        mode,
      );
      await capture(`license-acknowledgment-${mode}`);
    }
    await page.locator("#acknowledge-confirm").click();
  }
  for (const route of [
    "overview",
    "buckets",
    "users",
    `groups/${group}`,
    `policies/${policy}`,
    "keys",
    "config/api",
  ]) {
    await page.goto(`${base}/manage/${route}`, { waitUntil: "networkidle" });
    await expect(page.locator(".av-manage-header")).toBeVisible();
    await expect(page.getByText("正在加载…", { exact: true })).toHaveCount(0);
    for (const mode of ["vallum", "abyssus"]) {
      await page.evaluate((v) => {
        localStorage.setItem("minio-appearance", v);
      }, mode);
      await page.reload({ waitUntil: "networkidle" });
      await capture(`manage-${route.split("/")[0]}-${mode}`);
    }
  }
  await page.goto(`${base}/manage/users`, { waitUntil: "networkidle" });
  const field = page.getByLabel("用户名", { exact: true }).first();
  await expect(field).toHaveCSS("height", "32px");
  await expect(field).toHaveCSS("border-radius", "2px");
  checks.push(
    "seven management routes, shared field dimensions and double-theme captures",
  );
  await selectObject(mediaName);
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    await capture(`object-details-${mode}`);
  }
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByTestId("audio-preview");
  await expect(preview).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    await capture(`audio-paused-${mode}`);
    const button = page.getByRole("button", { name: "播放", exact: true });
    const before = await button.boundingBox(),
      time = await page.getByTestId("audio-position").boundingBox();
    assert.equal(before.width, 88);
    assert.equal(before.height, 32);
    await button.hover();
    assert.equal(
      await button.evaluate((n) => getComputedStyle(n).backgroundColor),
      mode === "vallum" ? "rgb(37, 42, 42)" : "rgb(159, 196, 226)",
      "primary hover retains a readable background",
    );
    await button.click();
    const pause = page.getByRole("button", { name: "暂停", exact: true });
    await expect(pause).toBeVisible();
    const after = await pause.boundingBox();
    assert.equal(after.width, 88);
    assert.equal(after.height, 32);
    assert.equal(
      (await page.getByTestId("audio-position").boundingBox()).x,
      time.x,
    );
    await capture(`audio-playing-${mode}`);
    await pause.click();
    await page.locator("audio").evaluate((n) => {
      n.currentTime = 0;
    });
  }
  await page
    .getByRole("combobox", { name: "播放速度", exact: true })
    .selectOption("1.5");
  await expect(preview.locator(".av-speed select")).toHaveCSS("width", "56px");
  await expect(preview.locator(".av-speed select")).toHaveCSS(
    "appearance",
    "none",
  );
  await capture("audio-speed-1.5x");
  assert.equal(
    await preview
      .locator("button")
      .filter({ hasText: /^(按钮|Button)$/ })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  checks.push(
    "audio fixed 88x32 play/pause, aligned timecode, no placeholders and real playback",
  );
  await page.goto(`${base}/browser/${bucket}`, { waitUntil: "networkidle" });
  for (const [name, selector] of [
    ["create-bucket", ".av-nav > .av-button"],
    ["rewind", "#rewind-objects-list"],
  ]) {
    const button = page.locator(selector);
    await expect(button).toBeEnabled();
    await button.click();
    for (const mode of ["vallum", "abyssus"]) {
      await page.evaluate(
        (v) => (document.documentElement.dataset.theme = v),
        mode,
      );
      await capture(`${name}-${mode}`);
    }
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "新建路径", exact: true }).click();
  for (const mode of ["vallum", "abyssus"]) {
    await page.evaluate(
      (v) => (document.documentElement.dataset.theme = v),
      mode,
    );
    await capture(`new-path-${mode}`);
  }
  await page.keyboard.press("Escape");
  await page.locator("#upload-main").click();
  await capture("upload-menu");
  await page.keyboard.press("Escape");
  for (const action of ["Share", "Tags", "Delete"]) {
    await selectObject(mediaName);
    const button =
      action === "Delete"
        ? page.locator(".av-detail-delete button")
        : page.getByRole("button", { name: action, exact: true });
    await expect(button).toBeVisible();
    {
      await button.click();
      for (const mode of ["vallum", "abyssus"]) {
        await page.evaluate((v) => {
          document.documentElement.dataset.theme = v;
        }, mode);
        await capture(`object-${action.toLowerCase()}-${mode}`);
      }
      await page.keyboard.press("Escape");
    }
  }
  for (const name of [
    "image.png",
    "document.pdf",
    ...(fs.existsSync(video) ? ["video.mp4"] : []),
  ]) {
    await selectObject(name);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    for (const mode of ["vallum", "abyssus"]) {
      await page.evaluate((v) => {
        document.documentElement.dataset.theme = v;
      }, mode);
      await capture(`preview-${name.split(".").pop()}-${mode}`);
    }
    await page.keyboard.press("Escape");
  }
  await page.goto(`${base}/license`, { waitUntil: "networkidle" });
  for (const mode of ["vallum", "abyssus"]) {
    await theme(mode);
    await capture(`license-${mode}`);
  }
  await page.goto(`${base}/manage/users`, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("management-mobile");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  checks.push(
    "object actions, non-audio previews, license, narrow-screen management, no browser exceptions",
  );
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify({ checks, captures }, null, 2),
  );
  console.log(
    `PASS design synchronization: ${checks.join("; ")}; ${captures.length} screenshots`,
  );
} catch (e) {
  if (page) {
    await capture("failure").catch(() => {});
    fs.writeFileSync(path.join(output, "failure.txt"), String(e.stack));
  }
  throw e;
} finally {
  await browser?.close();
  if (cookie) {
    if (key)
      await api(`/manage/keys/${key.accessKey}`, "DELETE").catch(() => {});
    await api(`/manage/groups/${group}`, "PUT", {
      member: user,
      remove: true,
    }).catch(() => {});
    await api(`/manage/users/${user}`, "DELETE").catch(() => {});
    await api(`/manage/policies/${policy}`, "DELETE").catch(() => {});
  }
  if (created) {
    const objects = [];
    for await (const o of client.listObjects(bucket, "", true, {
      IncludeVersion: true,
    }))
      objects.push({ name: o.name, versionId: o.versionId });
    if (objects.length) await client.removeObjects(bucket, objects);
    await client.removeBucket(bucket);
  }
}
