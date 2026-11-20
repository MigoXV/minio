#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Destructive flows below are confined to a named isolated instance and test-owned resources.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(
  path.join(repo, ".local/console-workspace/web-app/package.json"),
);
const { chromium, expect } = require("@playwright/test"),
  { Client } = require("minio");
const base = process.argv[2] || "http://127.0.0.1:19201";
const s3 = new URL(process.env.MINIO_TEST_S3 || "http://127.0.0.1:19100");
if (
  s3.hostname !== "127.0.0.1" ||
  !["19100", "19200"].includes(s3.port) ||
  new URL(base).hostname !== "127.0.0.1" ||
  !["19101", "19201"].includes(new URL(base).port)
)
  throw new Error("Only the isolated Console is permitted");
const env = Object.fromEntries(
  fs
    .readFileSync(
      process.env.MINIO_TEST_ENV ||
        path.join(repo, ".local/design-sync-test/env"),
      "utf8",
    )
    .split("\n")
    .filter((x) => x && !x.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const client = new Client({
  endPoint: s3.hostname,
  port: Number(s3.port),
  useSSL: false,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD,
});
const suffix = Date.now().toString(36),
  bucket = "v2-acceptance-" + suffix,
  user = "v2-user-" + suffix,
  group = "v2-group-" + suffix,
  policy = "v2-policy-" + suffix,
  createdBuckets = [];
const output = path.join(repo, ".local/figma-v2/acceptance");
fs.mkdirSync(output, { recursive: true });
const cache = path.join(os.homedir(), ".cache/ms-playwright"),
  exe = fs
    .readdirSync(cache)
    .filter((x) => /^chromium-\d+$/.test(x))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map((x) => path.join(cache, x, "chrome-linux64/chrome"))
    .find((x) => fs.existsSync(x));
const browser = await chromium.launch({ headless: true, executablePath: exe }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  }),
  page = await context.newPage();
const errors = [],
  shots = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(15000);
const pass = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
  shots.push(name);
};
const button = (name, root = page) =>
    root.getByRole("button", { name, exact: true }),
  dialog = () => page.locator(".v2-dialog[open]");
const close = async () => {
  await button("关闭窗口", dialog()).click();
  await expect(dialog()).toHaveCount(0);
};
const api = async (url, method = "GET", data) => {
  const r = await context.request.fetch(base + "/api/v1/manage" + url, {
    method,
    data,
    headers: { Origin: base },
  });
  if (!r.ok())
    throw new Error(url + ": " + r.status() + " " + (await r.text()));
  return r.json().catch(() => ({}));
};
const goto = async (url) => {
  await page.goto(base + url, { waitUntil: "networkidle" });
};
const row = (text) =>
  page.getByRole("row").filter({ has: page.getByText(text, { exact: true }) });
const nav = page.getByRole("navigation", { name: "主导航" });
const more = button("更多", nav);
const access = button("访问管理", nav);
const menuLink = (name) => nav.getByRole("link", { name, exact: true });
const openAppearance = async () => {
  await more.click();
  await button("外观设置", nav).click();
};
const checkWorkspace = async (active) => {
  const viewport = page.viewportSize();
  const workspace = page.locator(".v2-workspace");
  const header = page.locator(
    ".v2-workspace-content:not([inert]) .v2-page:visible > :is(.v2-page-header,.v2-object-address), .v2-appearance-page .v2-page-header",
  );
  await expect(nav.locator(".v2-top-link[aria-current]")).toHaveText(active);
  assert.equal((await nav.boundingBox()).height, 48);
  assert.equal((await workspace.boundingBox()).y, 48);
  const bounds = await header.boundingBox();
  assert.equal(bounds.x, 32);
  assert.equal(bounds.x + bounds.width, viewport.width - 32);
  assert.equal(
    await workspace.evaluate((node) => node.scrollWidth - node.clientWidth),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    viewport.width,
  );
};
const compactViewport = { width: 1280, height: 720 };
const desktopViewport = { width: 1440, height: 900 };
const setTheme = async (theme) => {
  await openAppearance();
  await page
    .getByRole("button", {
      name: new RegExp(
        "^" + (theme === "abyssus" ? "深色 · 苍渊" : "浅色 · 白垣"),
      ),
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.keyboard.press("Escape");
  await expect(page.locator(".v2-appearance-page")).toHaveCount(0);
};
const openDetails = async (name) => {
  await button(name).click();
  await button("详情", row(name)).click();
  await expect(page.locator(".v2-object-details")).toBeVisible();
  await page.locator(".v2-object-layout").evaluate(async (layout) => {
    await Promise.all(
      layout.getAnimations().map((animation) => animation.finished),
    );
  });
};
const viewObject = async (name) => {
  await goto("/browser/" + bucket);
  await openDetails(name);
};
const preview = async (name) => {
  await goto("/browser/" + bucket);
  await button(name).click();
  await button(name.startsWith("tone.") ? "试听" : "预览", row(name)).click();
  await expect(page.locator(".v2-preview")).toBeVisible();
};
const objectBody = async (key) => {
  const s = await client.getObject(bucket, key);
  const b = [];
  for await (const x of s) b.push(x);
  return Buffer.concat(b);
};
let accessKey = "";
try {
  await client.makeBucket(bucket);
  createdBuckets.push(bucket);
  for (const [file, type] of [
    ["tone.wav", "audio/wav"],
    ["tone.mp3", "audio/mpeg"],
    ["tone.flac", "audio/flac"],
    ["tone.m4a", "audio/mp4"],
    ["tone.ogg", "audio/ogg"],
    ["video.mp4", "video/mp4"],
  ])
    await client.putObject(
      bucket,
      file,
      fs.readFileSync(path.join(repo, ".local/audio-tests", file)),
      { "Content-Type": type },
    );
  await client.putObject(
    bucket,
    "sample.svg",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#637774"/><text x="80" y="220" fill="#f8f7f2" font-size="40">MinIO preview fixture</text></svg>',
    ),
    { "Content-Type": "image/svg+xml" },
  );
  await client.putObject(bucket, "README.txt", Buffer.from("version one"), {
    "Content-Type": "text/plain",
  });
  const pdfPage = await context.newPage();
  await pdfPage.setContent(
    "<style>@page{size:A4;margin:40px}section{break-after:page;font:24px sans-serif}</style><section>Page one</section><section>Page two</section><section>Page three</section>",
  );
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  await client.putObject(bucket, "sample.pdf", pdf, {
    "Content-Type": "application/pdf",
  });
  // Login in both themes and compact viewport: geometry and fixed feedback do not move.
  for (const theme of ["vallum", "abyssus"]) {
    await goto("/login");
    await page.evaluate(
      (p) => localStorage.setItem("minio-appearance", p),
      theme,
    );
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    assert.equal(
      (await page.locator(".av-login-form").boundingBox()).width,
      400,
    );
    assert.equal((await page.locator("#accessKey").boundingBox()).height, 40);
    assert.equal(
      await page
        .locator("#accessKey")
        .evaluate((node) => getComputedStyle(node).borderRadius),
      "3px",
    );
    assert.equal(
      await page
        .locator("#secretKey")
        .evaluate((node) => getComputedStyle(node).borderRadius),
      "3px",
    );
    await shot("login-" + theme);
    await page.locator("#accessKey").fill("invalid-v2-user");
    await page.locator("#secretKey").fill("invalid-v2-password");
    const before = await page.locator("#do-login").boundingBox();
    let submitLogin;
    const pendingLogin = new Promise((resolve) => {
      submitLogin = resolve;
    });
    await page.route(
      "**/api/v1/login",
      async (route) => {
        await pendingLogin;
        await route.continue();
      },
      { times: 1 },
    );
    await button("登录").click();
    try {
      await expect(button("登录中…")).toBeDisabled();
      await expect(page.getByRole("status")).toHaveText(
        "正在验证凭据，请稍候。",
      );
      await shot("login-pending-" + theme);
    } finally {
      submitLogin();
    }
    await expect(page.getByRole("alert")).toHaveText(
      "用户名或密码不正确，请核对后重试。",
    );
    assert.equal((await page.locator("#do-login").boundingBox()).y, before.y);
    await shot("login-error-" + theme);
    await page.setViewportSize({ width: 320, height: 360 });
    await page.locator("#secretKey").focus();
    await expect(page.locator("#secretKey")).toBeInViewport();
    await page.getByRole("alert").scrollIntoViewIfNeeded();
    await expect(page.getByRole("alert")).toBeInViewport();
    await page.locator("#do-login").scrollIntoViewIfNeeded();
    await expect(page.locator("#do-login")).toBeInViewport();
    await shot("login-mobile-short-" + theme);
    await page.setViewportSize(desktopViewport);

    await button("显示密码").click();
    await expect(page.locator("#secretKey")).toHaveAttribute("type", "text");
    await button("隐藏密码").click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await shot("login-compact-" + theme);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  pass("双主题登录、提交中、错误文案、固定反馈、密码显隐、1280×720");
  await page.locator("#accessKey").fill(env.MINIO_ROOT_USER);
  await page.locator("#secretKey").fill(env.MINIO_ROOT_PASSWORD);
  await button("登录").click();
  await page.waitForURL("**/browser*");
  await expect(page.locator("#acknowledge-confirm")).toBeVisible();
  await shot("license-consent");
  await page.locator("#acknowledge-confirm").click();
  await expect(nav).toBeVisible();
  assert.deepEqual(await nav.boundingBox(), {
    x: 0,
    y: 0,
    width: 1440,
    height: 48,
  });
  assert.deepEqual(await nav.locator(".v2-top-link").allTextContents(), [
    "存储桶",
    "系统管理",
    "访问管理",
    "更多",
  ]);
  await expect(
    page.getByRole("heading", { name: "存储桶", exact: true }),
  ).toBeVisible();
  // Test the UI mutation itself, then independently verify backend state.
  const newBucket = "v2-created-" + suffix;
  await button("创建存储桶").click();
  await dialog().getByLabel("存储桶名称", { exact: true }).fill(newBucket);
  await button("创建存储桶", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  createdBuckets.push(newBucket);
  assert.equal(await client.bucketExists(newBucket), true);
  await page.getByLabel("筛选存储桶").fill(bucket);
  await expect(
    page.getByRole("link", { name: bucket, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: bucket, exact: true }).click();
  await expect(button("tone.wav")).toBeVisible();
  assert.equal(
    (await page.locator(".v2-table tbody tr").first().boundingBox()).height,
    42,
  );
  await page.getByLabel("筛选对象").fill("no-match-v2");
  await expect(
    page.getByText("没有找到匹配的对象", { exact: true }),
  ).toBeVisible();
  await shot("objects-no-results");
  await page.getByLabel("筛选对象").fill("");
  pass("创建存储桶、流式对象列表、筛选、紧凑行高");
  // Upload into a new path with UTF-8 and spaces; verify bytes and delete via the UI.
  await button("更多操作").click();
  await button("新建路径").click();
  await dialog().getByLabel("路径名称", { exact: true }).fill("审阅 文件");
  await button("创建路径", dialog()).click();
  await expect(page.getByText("此路径暂无对象", { exact: true })).toBeVisible();
  await button("上传").click();
  await dialog()
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "新文件.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("uploaded through v2"),
    });
  await shot("upload-queued");
  await button("开始上传", dialog()).click();
  await expect(dialog().getByText(/已完成/)).toBeVisible();
  await button("完成", dialog()).click();
  assert.equal(
    (await objectBody("审阅 文件/新文件.txt")).toString(),
    "uploaded through v2",
  );
  await openDetails("新文件.txt");
  await button("更多对象操作").click();
  await button("删除", page.locator(".v2-object-details")).click();
  await shot("delete-object");
  await button("确认删除", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  assert.equal(
    (await client.listObjectsV2(bucket, "审阅 文件/", true).toArray()).length,
    0,
  );
  pass("新建路径、含中文和空格的真实上传、删除");
  await page.setViewportSize({ width: 390, height: 844 });
  await goto("/browser/" + bucket);
  await button("上传").click();
  await dialog()
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "retry.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("retry upload"),
    });
  await page.route(
    "**/objects/upload?**",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detailedMessage: "测试网络故障" }),
      }),
    { times: 1 },
  );
  await button("开始上传", dialog()).click();
  await expect(dialog().getByText(/测试网络故障/)).toBeVisible();
  const uploadSheet = await dialog().boundingBox();
  assert.equal(uploadSheet.y + uploadSheet.height, 844);
  await shot("upload-failed-mobile");
  await button("重试失败项", dialog()).click();
  await expect(dialog().getByText(/已完成/)).toBeVisible();
  await button("完成", dialog()).click();
  assert.equal((await objectBody("retry.txt")).toString(), "retry upload");
  await page.setViewportSize(desktopViewport);
  pass("移动上传底部面板、失败反馈和真实重试");
  const folderDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-upload-folder-"));
  try {
    fs.mkdirSync(path.join(folderDir, "子目录"));
    fs.writeFileSync(
      path.join(folderDir, "子目录", "folder.txt"),
      "folder upload bytes",
    );
    await button("上传").click();
    await dialog()
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles(folderDir);
    await button("开始上传", dialog()).click();
    await expect(dialog().getByText(/已完成/)).toBeVisible();
    await button("完成", dialog()).click();
    assert.equal(
      (
        await objectBody(path.basename(folderDir) + "/子目录/folder.txt")
      ).toString(),
      "folder upload bytes",
    );
  } finally {
    fs.rmSync(folderDir, { recursive: true, force: true });
  }
  let pendingUpload;
  const holdUpload = (route) => {
    pendingUpload = route;
  };
  await page.route("**/objects/upload?**", holdUpload);
  await button("上传").click();
  await dialog()
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "cancelled.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("cancelled upload"),
    });
  await button("开始上传", dialog()).click();
  await expect.poll(() => !!pendingUpload).toBe(true);
  await dialog()
    .locator(".v2-upload-list")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await pendingUpload.abort().catch(() => {});
  await expect(dialog().getByText(/已取消/)).toBeVisible();
  await dialog()
    .locator("footer")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.unroute("**/objects/upload?**", holdUpload);
  await assert.rejects(() => client.statObject(bucket, "cancelled.txt"));
  pass("真实文件夹上传保留目录、取消传输且对象未落盘");

  // Details, tags, signed expiry and version recovery.
  await viewObject("tone.wav");
  await button("更多对象操作").click();
  await button("标签", page.locator(".v2-object-details")).click();
  await dialog().getByLabel("标签键", { exact: true }).fill("review");
  await dialog().getByLabel("标签值", { exact: true }).fill("v2");
  await shot("tags");
  await button("保存标签", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  assert.equal(
    (await client.getObjectTagging(bucket, "tone.wav"))[0].Value,
    "v2",
  );
  await button("更多对象操作").click();
  await button("分享", page.locator(".v2-object-details")).click();
  await dialog().getByLabel("有效期").selectOption("3600");
  await expect(dialog().getByLabel("分享链接")).not.toHaveValue("");
  const shared = await dialog().getByLabel("分享链接").inputValue();
  const signed = new URL(
    Buffer.from(
      decodeURIComponent(new URL(shared).pathname.split("/").pop()),
      "base64url",
    ).toString(),
  );
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "3600");
  const sharedResponse = await fetch(shared);
  assert.equal(sharedResponse.status, 200);
  assert.equal(
    (await sharedResponse.arrayBuffer()).byteLength,
    (await client.statObject(bucket, "tone.wav")).size,
  );
  await shot("share");
  await button("复制链接", dialog()).click();
  await expect(dialog().getByText("链接已复制。")).toBeVisible();
  await close();
  pass("元数据、标签、带过期时间的分享链接及下载内容校验");
  await api("/buckets/" + bucket + "/versioning", "PUT", { status: "Enabled" });
  await client.putObject(bucket, "versioned.txt", Buffer.from("old version"));
  await new Promise((r) => setTimeout(r, 40));
  await client.putObject(bucket, "versioned.txt", Buffer.from("new version"));
  await viewObject("versioned.txt");
  await button("更多对象操作").click();
  await button("版本", page.locator(".v2-object-details")).click();
  await expect(dialog().locator("tbody tr")).toHaveCount(2);
  await shot("versions");
  await button("历史版本", dialog()).last().click();
  await button("恢复此版本", dialog()).click();
  await shot("restore-version");
  await button("恢复版本", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  assert.equal((await objectBody("versioned.txt")).toString(), "old version");
  pass("历史版本列表和恢复后内容校验");
  // Native audio remains mounted across theme selection and parameter dialogs.
  await preview("tone.wav");
  await expect(button("展开频谱图")).toBeEnabled({ timeout: 25000 });
  assert.equal(await page.locator("audio").evaluate((e) => e.paused), true);
  assert.equal(
    await page
      .getByTestId("audio-spectrogram-canvas")
      .locator("canvas")
      .count(),
    0,
  );
  const play = await button("播放").boundingBox(),
    position = await page.getByTestId("audio-position").boundingBox();
  await button("播放").click();
  await expect(button("暂停")).toBeVisible();
  const pause = await button("暂停").boundingBox();
  assert.equal(play.width, 88);
  assert.equal(play.height, 40);
  assert.equal(pause.width, play.width);
  assert.equal(
    (await page.getByTestId("audio-position").boundingBox()).x,
    position.x,
  );
  await shot("audio-playing");
  await button("暂停").click();
  await page.getByLabel("播放速度", { exact: true }).selectOption("1.5");
  await page.locator("audio").evaluate((e) => {
    e.currentTime = 1.2;
    e.volume = 0.45;
  });
  await page.getByRole("tab", { name: "音频分析", exact: true }).click();
  await expect(
    page.getByTestId("audio-spectrogram-canvas").locator("canvas"),
  ).toHaveCount(1, { timeout: 25000 });
  await expect(page.getByText("正在计算频谱")).toHaveCount(0, {
    timeout: 25000,
  });
  assert.equal(
    await page.locator("audio").evaluate((e) => e.playbackRate),
    1.5,
  );
  assert.equal(await page.locator("audio").evaluate((e) => e.currentTime), 1.2);
  const chart = page.locator(".av-wave-section .av-chart"),
    rect = await chart.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.getByTestId("selection-start")).not.toHaveText("—");
  const selected = await page.getByTestId("selection-start").innerText();
  await button("循环选区").click();
  await expect(button("循环选区")).toHaveAttribute("aria-pressed", "true");
  for (const theme of ["vallum", "abyssus"]) {
    await setTheme(theme);
    assert.equal(
      await page.locator("audio").evaluate((e) => e.playbackRate),
      1.5,
    );
    assert.equal(await page.locator("audio").evaluate((e) => e.volume), 0.45);
    await expect(page.getByTestId("selection-start")).toHaveText(selected);
    await expect(button("循环选区")).toHaveAttribute("aria-pressed", "true");
    await shot("analysis-" + theme);
    await checkWorkspace("存储桶");
    await page.setViewportSize(compactViewport);
    await checkWorkspace("存储桶");
    await shot("analysis-compact-" + theme);
    await page.setViewportSize(desktopViewport);
    await button("调整参数").click();
    await shot("analysis-parameters-" + theme);
    await button("取消", dialog()).click();
  }
  await button("缩放至选区").click();
  await expect(button("显示全段")).toBeVisible();
  await shot("analysis-zoom");
  await button("显示全段").click();
  await button("调整参数").click();
  await dialog().getByLabel("FFT", { exact: true }).selectOption("2048");
  await button("重新计算", dialog()).click();
  await expect(page.getByText(/FFT 2048/)).toBeVisible();
  await expect(page.getByText("正在计算频谱")).toHaveCount(0, {
    timeout: 25000,
  });
  await button("调整参数").click();
  await button("重新计算", dialog()).click();
  await expect(
    page.getByTestId("audio-spectrogram-canvas").locator("canvas"),
  ).toHaveCount(1, { timeout: 25000 });
  await expect(page.getByText("正在计算频谱")).toHaveCount(0, {
    timeout: 25000,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await shot("analysis-compact");
  assert.ok(await page.locator(".av-spectrum").isVisible());
  await page.setViewportSize({ width: 1440, height: 900 });
  await button("清除选区").click();
  await expect(page.getByTestId("selection-start")).toHaveText("—");
  pass(
    "音频播放/暂停固定几何、懒加载 FFT、选区、循环、缩放、参数、主题保留播放状态",
  );
  for (const ext of ["mp3", "flac", "m4a", "ogg"]) {
    await preview("tone." + ext);
    await expect(button("播放")).toBeEnabled({ timeout: 20000 });
    await button("播放").click();
    await expect(button("暂停")).toBeVisible();
    await button("暂停").click();
  }
  pass("WAV、MP3、FLAC、M4A、OGG 编码播放");
  for (const [name, key] of [
    ["sample.svg", "image"],
    ["sample.pdf", "pdf"],
    ["video.mp4", "video"],
    ["README.txt", "unsupported"],
  ]) {
    await preview(name);
    if (key === "image")
      await expect(page.locator(".v2-image-stage img")).toBeVisible();
    if (key === "pdf") {
      await expect(page.getByText("第 1 页 / 共 3 页")).toBeVisible();
      await button("下一页").click();
      await expect(page.getByText("第 2 页 / 共 3 页")).toBeVisible();
    }
    if (key === "video") {
      await button("播放").click();
      await expect(button("暂停")).toBeVisible();
      await button("暂停").click();
    }
    for (const theme of ["vallum", "abyssus"]) {
      await setTheme(theme);
      await checkWorkspace("存储桶");
      await shot(key + "-" + theme);
      await page.setViewportSize(compactViewport);
      await checkWorkspace("存储桶");
      if (key === "pdf" || key === "video") {
        const controls = await page.locator(".v2-media-controls").boundingBox();
        assert.ok(controls.y + controls.height <= 720);
      }
      await shot(key + "-compact-" + theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(button("返回对象浏览")).toBeVisible();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        390,
      );
      if (key === "pdf" || key === "video") {
        const controls = await page.locator(".v2-media-controls").boundingBox();
        assert.ok(controls.x >= 0 && controls.x + controls.width <= 390);
      }
      await shot(key + "-mobile-" + theme);
      await page.setViewportSize(desktopViewport);
    }
    await button("返回对象浏览").click();
    await expect(page).toHaveURL(base + "/browser/" + bucket);
    await expect(page.locator(".v2-object-details")).toHaveCount(0);
    await expect(row(name).getByRole("checkbox")).toBeChecked();
  }
  pass("双主题三种尺寸图片、PDF 翻页、视频播放、非预览格式降级及返回对象");
  // Management CRUD via visible controls, with API checks only for verification and cleanup.
  await goto("/manage/users");
  await button("创建用户").click();
  await dialog().getByLabel("用户名", { exact: true }).fill(user);
  await dialog()
    .getByLabel("初始密码", { exact: true })
    .fill("test-only-v2-password");
  await shot("create-user");
  await button("创建用户", dialog()).click();
  await expect(row(user)).toBeVisible();
  assert.ok((await api("/users")).some((u) => u.name === user));
  await goto("/manage/policies");
  await button("创建策略").click();
  await dialog().getByLabel("名称", { exact: true }).fill(policy);
  const doc = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: ["arn:aws:s3:::" + bucket],
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject"],
        Resource: ["arn:aws:s3:::" + bucket + "/*"],
      },
    ],
  };
  await dialog()
    .getByLabel("策略 JSON", { exact: true })
    .fill(JSON.stringify(doc, null, 2));
  await shot("policy-editor");
  await page.route(
    "**/api/v1/manage/policies/" + policy,
    (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试保存失败" }),
      }),
    { times: 1 },
  );
  await button("保存策略", dialog()).click();
  await expect(dialog().getByRole("alert")).toHaveText("测试保存失败");
  await expect(dialog().getByLabel("策略 JSON")).toHaveValue(
    JSON.stringify(doc, null, 2),
  );
  await shot("save-failed");
  await button("保存策略", dialog()).click();
  await expect(row(policy)).toBeVisible();
  await button("查看 JSON", row("readonly")).click();
  await expect(
    dialog().getByRole("heading", { name: "查看内置策略" }),
  ).toBeVisible();
  await expect(dialog().getByLabel("策略 JSON")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(button("保存策略", dialog())).toHaveCount(0);
  await button("关闭", dialog()).click();
  pass("保存失败保留输入并成功重试、内置策略只读");
  await goto("/manage/users");
  await button("管理策略", row(user)).click();
  await dialog().getByLabel("策略", { exact: true }).selectOption(policy);
  await shot("user-policy");
  await button("附加策略", dialog()).click();
  await expect(dialog().getByText("已附加策略", { exact: true })).toBeVisible();
  await button("完成", dialog()).click();
  await expect(row(user)).toContainText(policy);
  await button("停用", row(user)).click();
  await shot("disable-user");
  await button("确认停用", dialog()).click();
  await expect(row(user)).toContainText("已停用");
  await button("启用", row(user)).click();
  await button("确认启用", dialog()).click();
  await goto("/manage/groups");
  await button("创建组").click();
  await dialog().getByLabel("组名", { exact: true }).fill(group);
  await dialog().getByLabel("成员", { exact: true }).fill(user);
  await shot("create-group");
  await button("创建组", dialog()).click();
  await expect(row(group)).toBeVisible();
  await button("管理成员", row(group)).click();
  await expect(dialog().getByText(user, { exact: true })).toBeVisible();
  await shot("group-members");
  await button("移除成员", dialog()).click();
  await shot("remove-member");
  await button("移除成员", dialog()).click();
  await expect(
    dialog().getByText("此组暂无成员。", { exact: true }),
  ).toBeVisible();
  await button("关闭", dialog()).click();
  assert.deepEqual((await api("/groups/" + group)).members || [], []);
  await button("管理成员", row(group)).click();
  await button("添加成员", dialog()).click();
  await dialog().getByLabel("成员", { exact: true }).selectOption(user);
  await shot("add-member");
  await button("添加成员", dialog()).click();
  await expect(dialog().getByText(user, { exact: true })).toBeVisible();
  await button("关闭", dialog()).click();
  pass("用户创建、策略编辑与关联、启停、创建组、移除和添加成员");
  await goto("/manage/keys");
  await button("生成密钥").click();
  await dialog()
    .getByLabel("名称", { exact: true })
    .fill("v2-key-" + suffix);
  await shot("create-key");
  await button("生成密钥", dialog()).click();
  await expect(dialog().getByLabel("Secret Key")).not.toHaveValue("");
  accessKey = await dialog()
    .getByLabel("Access Key", { exact: true })
    .inputValue();
  assert.ok(accessKey);
  await button("已保存，关闭", dialog()).click();
  await expect(page.getByLabel("Secret Key")).toHaveCount(0);
  await button("撤销", row("v2-key-" + suffix)).click();
  await shot("revoke-key");
  await button("确认撤销", dialog()).click();
  assert.equal(
    (await api("/keys")).some((k) => k.accessKey === accessKey),
    false,
  );
  accessKey = "";
  pass("访问密钥创建、秘密值仅显示一次、撤销");
  await goto("/manage/buckets/" + bucket);
  await page.getByRole("tab", { name: "版本控制" }).click();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  await button("暂停版本控制").click();
  await shot("versioning");
  await button("暂停版本控制", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  assert.equal(
    (await api("/buckets/" + bucket + "/versioning")).status,
    "Suspended",
  );
  await goto("/manage/buckets/" + bucket);
  const bucketPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: "arn:aws:s3:::" + bucket + "/public/*",
      },
    ],
  };
  await page
    .getByLabel("策略 JSON", { exact: true })
    .fill(JSON.stringify(bucketPolicy));
  await button("预览 JSON").click();
  await expect(dialog().locator("pre")).toContainText("Statement");
  await button("关闭", dialog()).click();
  await expect(page.getByLabel("策略 JSON", { exact: true })).toHaveValue(
    JSON.stringify(bucketPolicy),
  );
  await button("保存桶策略").click();
  await button("保存", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  assert.ok(
    (await api("/buckets/" + bucket + "/policy")).policy.includes("public"),
  );
  await page.getByLabel("策略 JSON", { exact: true }).fill("");
  await button("保存桶策略").click();
  await button("保存", dialog()).click();
  await expect(dialog()).toHaveCount(0);
  pass("存储桶版本控制和匿名访问策略保存");
  // Both-theme page screenshots and dark surface audit; actual media pixels are excluded.
  for (const theme of ["vallum", "abyssus"]) {
    await setTheme(theme);
    for (const [route, key] of [
      ["/browser", "buckets"],
      ["/browser/" + bucket, "objects"],
      ["/manage/overview", "overview"],
      ["/manage/users", "users"],
      ["/manage/groups", "groups"],
      ["/manage/policies", "policies"],
      ["/manage/keys", "keys"],
      ["/manage/config", "config"],
      ["/manage/buckets/" + bucket, "bucket-config"],
      ["/license", "license"],
    ]) {
      await goto(route);
      if (key === "overview") {
        assert.equal(
          (
            await page
              .getByRole("heading", { name: "运行状态", exact: true })
              .boundingBox()
          ).x,
          32,
        );
        assert.equal(
          (await page.locator(".v2-management-flow .v2-data").boundingBox())
            .height,
          160,
        );
      }
      if (key === "bucket-config") {
        await expect(
          page.getByRole("heading", { name: "匿名访问策略", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "版本控制", exact: true }),
        ).toBeVisible();
        assert.equal(
          (await page.getByLabel("策略 JSON", { exact: true }).boundingBox())
            .width,
          720,
        );
        assert.equal(
          (await page.getByLabel("策略 JSON", { exact: true }).boundingBox())
            .height,
          40,
        );
      }
      if (key === "license")
        assert.equal(
          (
            await page
              .locator(".v2-license-table tbody tr")
              .first()
              .boundingBox()
          ).height,
          80,
        );
      const active = {
        buckets: "存储桶",
        objects: "存储桶",
        overview: "系统管理",
        users: "访问管理",
        groups: "访问管理",
        policies: "访问管理",
        keys: "访问管理",
        config: "系统管理",
        "bucket-config": "存储桶",
        license: "系统管理",
      }[key];
      await checkWorkspace(active);
      if (key === "buckets") {
        const card = page.locator(".v2-bucket-card").first();
        const box = await card.boundingBox();
        assert.equal(box.width, 332);
        assert.ok(box.height >= 152);
        assert.equal(
          await card.evaluate((node) => getComputedStyle(node).minHeight),
          "152px",
        );
        assert.equal(
          await card.evaluate((node) => getComputedStyle(node).borderRadius),
          "3px",
        );
        assert.equal(
          await card.evaluate((node) => getComputedStyle(node).borderTopWidth),
          "0px",
        );
      }
      if (["users", "groups", "keys"].includes(key)) {
        const refresh = await button("刷新").boundingBox();
        const create = await page.locator(".v2-access-create").boundingBox();
        assert.equal(refresh.width, 72);
        assert.equal(refresh.height, 40);
        assert.equal(create.width, 88);
        assert.equal(create.height, 40);
        assert.equal(create.x - refresh.x - refresh.width, 8);
        assert.equal(create.x + create.width, 1408);
        const subtab = page.getByRole("tab", { selected: true });
        assert.equal((await subtab.boundingBox()).width, 56);
        assert.equal((await subtab.boundingBox()).height, 40);
        const label = subtab.locator("span");
        assert.ok(
          await label.evaluate(
            (node) =>
              Math.abs(
                parseFloat(getComputedStyle(node, "::after").width) -
                  node.getBoundingClientRect().width,
              ) < 1,
          ),
        );
        if (key === "groups")
          assert.ok(Math.abs((await label.boundingBox()).width - 14) < 1);
      }
      await shot(key + "-" + theme);
      if (
        [
          "buckets",
          "users",
          "groups",
          "keys",
          "config",
          "overview",
          "license",
          "objects",
        ].includes(key)
      ) {
        if (key === "objects") await openDetails("tone.wav");
        if (key === "objects") await shot("details-" + theme);
        await page.setViewportSize(compactViewport);
        await checkWorkspace(active);
        if (["users", "groups", "keys"].includes(key)) {
          const refresh = await button("刷新").boundingBox();
          const create = await page.locator(".v2-access-create").boundingBox();
          assert.equal(create.width, 88);
          assert.equal(refresh.width, 72);
          assert.equal(create.x + create.width, 1248);
          assert.equal(create.x - refresh.x - refresh.width, 8);
        }
        if (key === "objects") {
          await expect
            .poll(async () => {
              const bounds = await page
                .locator(".v2-object-details")
                .boundingBox();
              return Math.round(bounds.x + bounds.width);
            })
            .toBe(1248);
          const inspector = await page
            .locator(".v2-object-details")
            .boundingBox();
          assert.equal(inspector.width, 320);
          assert.equal(inspector.x + inspector.width, 1248);
        }
        await shot((key === "objects" ? "details" : key) + "-compact-" + theme);
        await page.setViewportSize(desktopViewport);
      }
      if (theme === "abyssus") {
        const white = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll(
              "main,nav,section,aside,button,input,textarea",
            ),
          )
            .filter((e) => {
              const b = e.getBoundingClientRect(),
                c = getComputedStyle(e);
              return (
                b.width * b.height > 10000 &&
                [
                  "rgb(255, 255, 255)",
                  "rgb(252, 251, 248)",
                  "rgb(248, 247, 242)",
                ].includes(c.backgroundColor)
              );
            })
            .map((e) => e.className),
        );
        assert.deepEqual(white, []);
      }
    }
    await openAppearance();
    await expect(more).toHaveAttribute("aria-current", "true");
    await checkWorkspace("更多");
    await shot("appearance-" + theme);
    await page.setViewportSize(compactViewport);
    await checkWorkspace("更多");
    await shot("appearance-compact-" + theme);
    await page.keyboard.press("Escape");
    await page.setViewportSize(desktopViewport);
  }
  pass("浅色/深色全页面截图与深色白块检查");
  // Failure recovery and permissions: denied account cannot use management writes or object upload.
  await page.route(
    "**/api/v1/manage/users",
    (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试加载失败" }),
      }),
    { times: 1 },
  );
  await goto("/manage/users");
  await expect(page.getByText("无法加载内容", { exact: true })).toBeVisible();
  await shot("load-failed");
  await button("重试").click();
  await expect(row(user)).toBeVisible();
  const limited = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    lp = await limited.newPage();
  await lp.goto(base + "/login");
  await lp.locator("#accessKey").fill(user);
  await lp.locator("#secretKey").fill("test-only-v2-password");
  await lp.locator("#do-login").click();
  await lp.waitForURL("**/browser*");
  await expect(lp.locator("#acknowledge-confirm")).toBeVisible();
  await lp.locator("#acknowledge-confirm").click();
  await lp.goto(base + "/browser/" + bucket);
  await expect(
    lp.getByRole("button", { name: "tone.wav", exact: true }),
  ).toBeVisible();
  await expect(
    lp.getByRole("button", { name: "上传", exact: true }),
  ).toBeDisabled();
  await lp.goto(base + "/manage/users");
  await expect(
    lp.getByRole("button", { name: "创建用户", exact: true }),
  ).toHaveCount(0);
  await expect(lp.getByText("没有访问权限", { exact: true })).toBeVisible();
  await lp.screenshot({ path: path.join(output, "permission-denied.png") });
  const limitedNav = lp.getByRole("navigation", { name: "主导航" });
  await expect(
    limitedNav.getByRole("link", { name: "系统管理" }),
  ).toHaveAttribute("href", "/license");
  await limitedNav.getByRole("button", { name: "访问管理" }).click();
  assert.deepEqual(
    await limitedNav.locator("#v2-access-menu a").allTextContents(),
    ["访问密钥"],
  );
  await limited.close();
  pass("加载失败重试与受限账户权限");

  const bucketPrefix = "v2-bucket-grid-" + suffix;
  const addGridBuckets = async (start, end) => {
    await Promise.all(
      Array.from({ length: end - start }, async (_, offset) => {
        const name = bucketPrefix + "-" + (start + offset);
        await client.makeBucket(name);
        createdBuckets.push(name);
      }),
    );
  };
  const cards = page.locator(".v2-bucket-grid > .v2-bucket-card");
  const workspaceScroll = page.locator(".v2-workspace-content");
  const assertNoHorizontalOverflow = async () => {
    const overflow = await cards.first().evaluate((card) => {
      const overflowing = [];
      for (let node = card; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth)
          overflowing.push(node.className);
      }
      return overflowing;
    });
    assert.deepEqual(overflow, []);
  };
  await addGridBuckets(0, 4);
  await goto("/browser");
  await page.getByLabel("筛选存储桶").fill(bucketPrefix);
  await expect(cards).toHaveCount(4);
  for (const theme of ["vallum", "abyssus"]) {
    await setTheme(theme);
    for (const [width, height, rows] of [
      [1536, 768, 1],
      [1440, 900, 1],
      [1280, 720, 2],
    ]) {
      await page.setViewportSize({ width, height });
      await assertNoHorizontalOverflow();
      assert.equal(
        await cards.evaluateAll(
          (items) => new Set(items.map((card) => card.offsetTop)).size,
        ),
        rows,
      );
      assert.equal(
        await workspaceScroll.evaluate(
          (node) => node.scrollHeight - node.clientHeight,
        ),
        0,
      );
      await shot("bucket-grid-" + width + "-" + theme);
    }
  }
  await addGridBuckets(4, 13);
  await goto("/browser");
  await page.getByLabel("筛选存储桶").fill(bucketPrefix);
  await expect(cards).toHaveCount(13);
  await assertNoHorizontalOverflow();
  assert.ok(
    await workspaceScroll.evaluate(
      (node) => node.scrollHeight > node.clientHeight,
    ),
  );
  await cards.last().scrollIntoViewIfNeeded();
  assert.ok(await workspaceScroll.evaluate((node) => node.scrollTop > 0));
  await expect(cards.last()).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow();
  assert.equal(
    await cards.evaluateAll(
      (items) => new Set(items.map((card) => card.offsetTop)).size,
    ),
    13,
  );
  await page.setViewportSize(desktopViewport);
  pass("四张卡片跨桌面尺寸自动换行，无横向滚动；多行卡片随工作区纵向滚动");

  const navigationBucket = "v2-navigation-" + suffix;
  await client.makeBucket(navigationBucket);
  createdBuckets.push(navigationBucket);
  await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      client.putObject(
        navigationBucket,
        "row-" + i + ".txt",
        Buffer.from("nav"),
      ),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await goto("/browser/" + navigationBucket);
  const workspace = page.locator(".v2-workspace");
  const list = page.locator(".v2-object-list .v2-table-wrap");
  await expect(button("row-23.txt")).toBeVisible();
  await list.evaluate((node) => (node.scrollTop = 160));
  const scroll = await list.evaluate((node) => node.scrollTop);
  assert.ok(scroll > 0, "object list must be scrollable");
  const layout = async () => ({
    workspace: await workspace.boundingBox(),
    title: await page.locator(".v2-breadcrumb").boundingBox(),
    scroll: await list.evaluate((node) => node.scrollTop),
  });
  const before = await layout();
  assert.deepEqual(before.workspace, { x: 0, y: 48, width: 1280, height: 672 });
  await expect(menuLink("存储桶")).toHaveAttribute("aria-current", "page");
  await access.focus();
  await page.keyboard.press("Enter");
  await expect(access).toHaveAttribute("aria-expanded", "true");
  assert.deepEqual(await page.locator("#v2-access-menu").boundingBox(), {
    x: 0,
    y: 48,
    width: 1280,
    height: 112,
  });
  assert.deepEqual(await layout(), before);
  await shot("navigation-access-1280");
  await page.keyboard.press("Tab");
  await expect(menuLink("用户")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(access).toBeFocused();
  await expect(access).toHaveAttribute("aria-expanded", "false");
  await access.hover();
  await menuLink("用户").hover();
  await expect(access).toHaveAttribute("aria-expanded", "true");
  await more.hover();
  await expect(access).toHaveAttribute("aria-expanded", "false");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const moreBox = await page.locator("#v2-more-menu").boundingBox();
  assert.equal(moreBox.width, 192);
  assert.equal(moreBox.x + moreBox.width, 1280 - 32);
  assert.equal(moreBox.y, 48);
  assert.deepEqual(await layout(), before);
  await shot("navigation-more-1280");
  assert.deepEqual(
    await page.locator("#v2-more-menu > :is(a,button)").allTextContents(),
    ["使用文档", "外观设置", "退出登录"],
  );
  await menuLink("使用文档").hover();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await access.hover();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(access).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(3, 260);
  await expect(access).toHaveAttribute("aria-expanded", "false");
  await more.hover();
  await nav.locator(".v2-top-brand").hover();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  assert.deepEqual(await layout(), before);

  const navigate = async (name, ending, current = name) => {
    await menuLink(name).click();
    await expect(page).toHaveURL(base + ending);
    await expect(nav.locator(".v2-top-link[aria-current]")).toHaveText(current);
  };
  await expect(page.locator(".v2-files thead")).toBeVisible();
  await openDetails("row-4.txt");
  const desktopDetail = page.locator(".v2-object-details");
  await expect(desktopDetail).toBeVisible();
  const properties = desktopDetail.locator(".v2-object-properties");
  await properties.getByText("对象属性", { exact: true }).click();
  await expect(properties.getByText("ETag", { exact: true })).toBeVisible();
  const inspectorHeader = await desktopDetail.locator("header").boundingBox();
  const cellHeader = await page.locator(".v2-files thead").boundingBox();
  const pagination = await page
    .locator(".v2-object-list > .v2-table-caption")
    .boundingBox();
  await list.evaluate((node) => {
    node.scrollTop = 200;
  });
  assert.deepEqual(
    await desktopDetail.locator("header").boundingBox(),
    inspectorHeader,
  );
  assert.deepEqual(
    await page.locator(".v2-files thead").boundingBox(),
    cellHeader,
  );
  assert.deepEqual(
    await page.locator(".v2-object-list > .v2-table-caption").boundingBox(),
    pagination,
  );
  assert.equal(
    await properties.evaluate((node) => getComputedStyle(node).overflowY),
    "auto",
  );
  await button("关闭对象详情").click();

  await navigate("系统管理", "/manage/overview");
  const systemTabs = page.getByRole("tablist", { name: "系统管理" });
  const systemTab = (name) =>
    systemTabs.getByRole("tab", { name, exact: true });
  const tabsBox = await systemTabs.boundingBox();
  await button("存储桶配置").click();
  await expect(page).toHaveURL(base + "/manage/buckets/" + navigationBucket);
  await expect(menuLink("存储桶")).toHaveAttribute("aria-current", "page");
  await navigate("存储桶", "/browser");
  const card = page.locator(".v2-bucket-card").filter({
    has: page.getByRole("link", { name: navigationBucket, exact: true }),
  });
  await card.getByRole("link", { name: "查看配置" }).click();
  await expect(page).toHaveURL(base + "/manage/buckets/" + navigationBucket);
  await page.goBack();
  await card.click({ position: { x: 24, y: 76 } });
  await expect(page).toHaveURL(base + "/browser/" + navigationBucket);
  await page.goBack();
  await card
    .getByRole("link", { name: navigationBucket, exact: true })
    .press("Enter");
  await expect(page).toHaveURL(base + "/browser/" + navigationBucket);
  await page.goBack();
  await card.getByRole("link", { name: "浏览对象" }).click();
  await expect(page).toHaveURL(base + "/browser/" + navigationBucket);
  await navigate("存储桶", "/browser");
  await navigate("系统管理", "/manage/overview");
  await button("存储桶配置").click();
  await expect(page).toHaveURL(base + "/manage/buckets");
  await navigate("系统管理", "/manage/overview");
  await systemTab("系统配置").click();
  await expect(page).toHaveURL(base + "/manage/config");
  await expect(systemTab("系统配置")).toHaveAttribute("aria-selected", "true");
  assert.deepEqual(await systemTabs.boundingBox(), tabsBox);
  await systemTab("许可证").click();
  await expect(page).toHaveURL(base + "/license");
  await expect(systemTab("许可证")).toHaveAttribute("aria-selected", "true");
  assert.deepEqual(await systemTabs.boundingBox(), tabsBox);
  await expect(menuLink("系统管理")).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(systemTab("系统配置")).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(systemTab("许可证")).toHaveAttribute("aria-selected", "true");
  await systemTab("概览").click();
  await button("访问管理", page.locator(".v2-page-header")).click();
  await expect(page).toHaveURL(base + "/manage/users");
  pass("系统标签、桶配置快捷入口、整卡点击、键盘操作及独立配置入口");
  for (const [name, route] of [
    ["用户", "users"],
    ["用户组", "groups"],
    ["策略", "policies"],
    ["访问密钥", "keys"],
  ]) {
    await access.click();
    await navigate(name, "/manage/" + route, "访问管理");
    await expect(access).toHaveAttribute("aria-expanded", "false");
    await access.click();
    await expect(menuLink(name)).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
  }
  const accessTabs = page.getByRole("tablist", { name: "访问管理" });
  await accessTabs.getByRole("tab", { name: "组", exact: true }).click();
  await expect(
    accessTabs.getByRole("tab", { name: "组", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await accessTabs.getByRole("tab", { name: "用户", exact: true }).click();
  await expect(page).toHaveURL(base + "/manage/users");
  await accessTabs.getByRole("tab", { name: "策略", exact: true }).click();
  await expect(
    accessTabs.getByRole("tab", { name: "策略", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(access).toHaveAttribute("aria-current", "true");
  await openAppearance();
  await expect(page.locator(".v2-appearance-page")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".v2-appearance-page")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator(".v2-appearance-page")).toBeVisible();
  await expect(more).toHaveAttribute("aria-current", "true");
  await more.click();
  await expect(button("外观设置", nav)).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(page.locator(".v2-appearance-page")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".v2-appearance-page")).toHaveCount(0);
  await more.click();
  const docs = await menuLink("使用文档").getAttribute("href");
  await context.route(docs, (route) =>
    route.fulfill({ body: "Documentation" }),
  );
  const popup = page.waitForEvent("popup");
  await menuLink("使用文档").click();
  const docPage = await popup;
  await expect(docPage).toHaveURL(docs);
  await docPage.close();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  pass("桌面所有导航入口、权限、高亮、前进后退、键盘和滚动稳定");
  const sourcePrefix = "data-bin/b-recorder/2026/11/15/27372839/";
  const siblingPrefix = "data-bin/archive/";
  for (const key of [
    sourcePrefix + "source.wav",
    siblingPrefix + "archived.wav",
    "data-bin/incoming/new.wav",
    "data-bin/not-a-folder.txt",
    "data-bin/archive/nested/other.wav",
    "data-bin/审阅 文件/demo.txt",
  ]) {
    await client.putObject(navigationBucket, key, Buffer.from("breadcrumbs"));
  }
  const route = (key) =>
    "/browser/" + navigationBucket + "/" + encodeURIComponent(key);
  const crumb = (name) => button("选择同级目录 · " + name);
  const popover = page.locator(".v2-workspace-popover:popover-open");
  const chooseSibling = async (mobile) => {
    await goto(route(sourcePrefix));
    await expect(button("source.wav")).toBeVisible();
    const loadingNotice = await page.evaluateHandle(() => {
      const state = { shown: false };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.textContent?.includes("正在读取同级目录"))
              state.shown = true;
          }
        }
      });
      observer.observe(document.querySelector(".v2-breadcrumb"), {
        childList: true,
        subtree: true,
      });
      return { state, observer };
    });
    await crumb("b-recorder").click();
    await expect(button("archive", popover)).toBeVisible();
    assert.equal(
      await loadingNotice.evaluate(({ state, observer }) => {
        observer.disconnect();
        return state.shown;
      }),
      false,
    );
    await loadingNotice.dispose();
    await expect(button("b-recorder", popover)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(button("incoming", popover)).toBeVisible();
    await expect(button("not-a-folder.txt", popover)).toHaveCount(0);
    await expect(button("nested", popover)).toHaveCount(0);
    await expect(page).toHaveURL(base + route(sourcePrefix));
    const box = await popover.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= page.viewportSize().width);
    assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height);
    if (!mobile) {
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowDown");
      await expect(button("b-recorder", popover)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(crumb("b-recorder")).toBeFocused();
      await expect(popover).toHaveCount(0);
      await crumb("b-recorder").click();
      await page.mouse.click(2, 100);
      await expect(popover).toHaveCount(0);
      await crumb("b-recorder").click();
    }
    await shot(
      "siblings-" +
        page.viewportSize().width +
        "-" +
        (await page.locator("html").getAttribute("data-theme")),
    );
    await button("archive", popover).click();
    await expect(page).toHaveURL(base + route(siblingPrefix));
    await expect(button("archived.wav")).toBeVisible();
    await expect(crumb("2026")).toHaveCount(0);
    await expect(popover).toHaveCount(0);
    if (!mobile) {
      const ancestor = page
        .getByRole("navigation", { name: "当前位置" })
        .getByRole("link", { name: "data-bin", exact: true });
      await ancestor.click();
      await expect(page).toHaveURL(base + route("data-bin/"));
      await expect(button("archive/")).toBeVisible();
      await expect(popover).toHaveCount(0);
    }
    if (mobile) {
      await expect(
        page.locator(".v2-files .v2-file-secondary").first(),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "查看对象详情 " + siblingPrefix + "archived.wav",
        })
        .click();
      await expect(page.locator(".v2-object-details:modal")).toBeVisible();
      const sheet = await page.locator(".v2-object-details").boundingBox();
      assert.equal(sheet.y + sheet.height, page.viewportSize().height);
      await button("更多对象操作").click();
      await expect(button("分享", popover)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".v2-object-details:modal")).toBeVisible();
      await button("更多对象操作").click();
      await button("分享", popover).click();
      await expect(dialog().getByLabel("分享链接")).not.toHaveValue("");
      const share = await dialog().boundingBox();
      assert.equal(share.y + share.height, page.viewportSize().height);
      await close();
      await expect(page.locator(".v2-object-details:modal")).toBeVisible();
      await shot(
        "details-" +
          page.viewportSize().width +
          "-" +
          (await page.locator("html").getAttribute("data-theme")),
      );
      await button("关闭对象详情").click();
    }
    await expect(
      page
        .getByRole("navigation", { name: "当前位置" })
        .getByRole("link", { name: "存储桶" }),
    ).toHaveCount(0);
    if (mobile) await button("导航").click();
    await menuLink("存储桶").click();
    await expect(page).toHaveURL(base + "/browser");
    await expect(popover).toHaveCount(0);
  };
  const editPrefix = async (mobile, theme) => {
    await goto(route(sourcePrefix));
    const address = page.locator(".v2-object-address");
    const before = await address.boundingBox();
    await expect(address.locator(".v2-crumb").first()).toHaveClass(
      /v2-crumb-bucket/,
    );
    await button("编辑路径").click();
    const input = page.getByRole("combobox", { name: "对象前缀" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(sourcePrefix);
    assert.deepEqual(await address.boundingBox(), before);
    const suggestion = (name) =>
      page.getByRole("option", { name, exact: true });
    await input.fill("data-bin/not-a-");
    await expect(page.getByText("没有匹配的目录")).toBeVisible();
    await input.fill("data-bin/ar");
    await expect(suggestion(siblingPrefix)).toBeVisible();
    await expect(suggestion("data-bin/archive/nested/")).toHaveCount(0);
    await expect(page).toHaveURL(base + route(sourcePrefix));
    await shot("prefix-edit-" + page.viewportSize().width + "-" + theme);
    if (mobile) {
      await suggestion(siblingPrefix).click();
    } else {
      await input.press("ArrowDown");
      await expect(suggestion(siblingPrefix)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await input.press("Enter");
    }
    await expect(page).toHaveURL(base + route(siblingPrefix));
    await expect(button("archived.wav")).toBeVisible();
    await button("编辑路径").click();
    await input.fill("data-bin/审阅");
    await expect(suggestion("data-bin/审阅 文件/")).toBeVisible();
    await input.press("Escape");
    await expect(button("编辑路径")).toBeFocused();
    await expect(page).toHaveURL(base + route(siblingPrefix));
    await button("编辑路径").click();
    await input.fill("data-bin/审阅 文件");
    await input.press("Enter");
    await expect(page).toHaveURL(base + route("data-bin/审阅 文件/"));
    await expect(button("demo.txt")).toBeVisible();
  };
  const longName = "record-12-" + "long-file-name-".repeat(7) + ".wav";
  await Promise.all(
    Array.from({ length: 36 }, (_, index) =>
      client.putObject(
        navigationBucket,
        sourcePrefix +
          (index === 12
            ? longName
            : "record-" + String(index).padStart(2, "0") + ".wav"),
        Buffer.from("test recording"),
      ),
    ),
  );
  const motion = (trigger) =>
    trigger.evaluate(async (control) => {
      const layout = document.querySelector(".v2-object-layout");
      const table = layout.querySelector(".v2-table-wrap");
      const measure = () => ({
        width: table.getBoundingClientRect().width,
        x: layout.querySelector(".v2-object-details")?.getBoundingClientRect()
          .x,
        scroll: table.scrollTop,
      });
      const before = measure();
      control.click();
      await new Promise(requestAnimationFrame);
      layout.getBoundingClientRect();
      const animation = layout.getAnimations()[0];
      assertAnimation(animation);
      animation.pause();
      animation.currentTime = 100;
      const middle = measure();
      const timing = animation.effect.getTiming();
      animation.finish();
      return {
        before,
        middle,
        duration: timing.duration,
        easing: getComputedStyle(layout).transitionTimingFunction,
      };

      function assertAnimation(transition) {
        if (
          !transition ||
          transition.transitionProperty !== "grid-template-columns"
        )
          throw new Error("No animated grid track for object details");
      }
    });
  const inspectDetails = async (theme) => {
    await goto(route(sourcePrefix));
    const filter = page.getByRole("textbox", { name: "筛选对象" });
    await filter.fill("record-");
    const fileRow = row(longName),
      name = button(longName);
    await expect(desktopDetail).toHaveCount(0);
    await expect(button("详情", fileRow)).toHaveCount(0);
    await name.click();
    await expect(fileRow.getByRole("checkbox")).toBeChecked();
    await expect(button("试听", fileRow)).toBeVisible();
    await expect(button("详情", row("record-13.wav"))).toHaveCount(0);
    await expect(desktopDetail).toHaveCount(0);
    const collapsed = await list.boundingBox();
    await shot("object-browser-closed-1280-" + theme);
    const opening = await motion(button("详情", fileRow));
    assert.equal(opening.duration, 200);
    assert.equal(opening.easing, "ease-out");
    assert.equal(opening.before.width, collapsed.width);
    assert.ok(
      opening.middle.width < collapsed.width &&
        opening.middle.width > collapsed.width - 336,
    );
    assert.equal(opening.middle.scroll, opening.before.scroll);
    assert.ok(opening.before.scroll > 0);
    await expect
      .poll(async () => (await list.boundingBox()).width)
      .toBe(collapsed.width - 336);
    const inspector = await desktopDetail.boundingBox();
    assert.equal(inspector.width, 320);
    assert.ok(opening.middle.x > inspector.x);
    assert.equal(inspector.x - collapsed.x - collapsed.width + 336, 16);
    const nameLayout = await fileRow.evaluate((item) => {
      const style = (node) => getComputedStyle(node);
      const cells = item.querySelectorAll("td");
      const label = item.querySelector(".v2-file-label");
      const file = label.parentElement;
      return {
        rowHeight: item.getBoundingClientRect().height,
        font: [style(file).fontSize, style(file).fontWeight, style(file).color],
        dateColor: style(cells[2]).color,
        sizeColor: style(cells[3]).color,
        sizeAlignment: style(cells[3]).textAlign,
        truncated: label.scrollWidth > label.clientWidth,
        timeWidth: cells[2].getBoundingClientRect().width,
      };
    });
    assert.equal(nameLayout.rowHeight, 42);
    assert.deepEqual(nameLayout.font.slice(0, 2), ["14px", "400"]);
    assert.equal(nameLayout.dateColor, nameLayout.sizeColor);
    assert.notEqual(nameLayout.font[2], nameLayout.dateColor);
    assert.equal(nameLayout.sizeAlignment, "right");
    assert.equal(nameLayout.truncated, true);
    assert.ok(nameLayout.timeWidth >= 190);
    const flat = await desktopDetail.evaluate((panel) => ({
      border: getComputedStyle(panel).borderTopWidth,
      radius: getComputedStyle(panel).borderRadius,
      sameBackground:
        getComputedStyle(panel).backgroundColor ===
        getComputedStyle(panel.closest(".v2-console")).backgroundColor,
    }));
    assert.deepEqual(flat, {
      border: "0px",
      radius: "0px",
      sameBackground: true,
    });
    await shot("object-browser-open-1280-" + theme);
    const closing = await motion(button("关闭对象详情"));
    assert.equal(closing.duration, 200);
    assert.equal(closing.easing, "ease-out");
    assert.ok(
      closing.middle.width > closing.before.width &&
        closing.middle.width < collapsed.width,
    );
    assert.ok(closing.middle.x > inspector.x);
    assert.equal(closing.middle.scroll, opening.before.scroll);
    await expect(desktopDetail).toHaveCount(0);
    assert.equal((await list.boundingBox()).width, collapsed.width);
    assert.equal(
      await list.evaluate((node) => node.scrollTop),
      opening.before.scroll,
    );
    await expect(filter).toHaveValue("record-");
    await expect(fileRow.getByRole("checkbox")).toBeChecked();
    await expect(button("上传")).toBeEnabled();
    await button("批量操作").click();
    await expect(button("下载", popover)).toBeEnabled();
    await expect(button("删除", popover)).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await button("详情", fileRow).click();
    await expect(desktopDetail).toBeVisible();
    assert.equal(
      await page
        .locator(".v2-object-layout")
        .evaluate((node) => node.getAnimations().length),
      0,
    );
    await button("关闭对象详情").click();
    assert.equal(await desktopDetail.count(), 0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  };
  for (const theme of ["vallum", "abyssus"]) {
    await page.setViewportSize(compactViewport);
    await setTheme(theme);
    await inspectDetails(theme);
    await chooseSibling(false);
    await editPrefix(false, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseSibling(true);
    await editPrefix(true, theme);
    await button("导航").click();
    await menuLink("存储桶").click();
    await expect(page).toHaveURL(base + "/browser");
    const bucketCards = page.locator(".v2-bucket-grid");
    const card = bucketCards.locator(".v2-bucket-card").first();
    const configBox = await card
      .getByRole("link", { name: "查看配置" })
      .boundingBox();
    const browseBox = await card
      .getByRole("link", { name: "浏览对象" })
      .boundingBox();
    assert.equal(configBox.y, browseBox.y);
    assert.equal(await bucketCards.evaluate((node) => node.scrollWidth), 358);
    await shot("buckets-mobile-" + theme);
    await goto("/manage/users");
    const tabs = page.getByRole("tablist", { name: "访问管理" });
    await tabs.getByRole("tab", { name: "组", exact: true }).click();
    await expect(page).toHaveURL(base + "/manage/groups");
    await tabs.getByRole("tab", { name: "用户", exact: true }).click();
    await expect(page).toHaveURL(base + "/manage/users");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await shot("users-mobile-" + theme);
    await tabs.getByRole("tab", { name: "策略", exact: true }).click();
    const policyFilter = page.getByRole("textbox", { name: "筛选策略管理" });
    await policyFilter.fill("no-such-policy");
    await expect(page.getByText("没有匹配的条目")).toBeVisible();
    await policyFilter.fill("readonly");
    await button("管理 readonly").click();
    await button("查看 JSON", popover).click();
    await expect(dialog()).toBeVisible();
    await close();
  }
  await page.setViewportSize({ width: 320, height: 600 });
  await chooseSibling(true);
  await goto("/browser/" + navigationBucket);
  const bucketPicker = button("选择同级存储桶 · " + navigationBucket);
  await bucketPicker.press("Enter");
  await expect(button(navigationBucket, popover)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await button(bucket, popover).click();
  await expect(page).toHaveURL(base + "/browser/" + bucket);
  await expect(button("tone.wav")).toBeVisible();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    320,
  );
  await page.setViewportSize(desktopViewport);
  pass("双主题桌面和移动同级目录、回桶列表、底部详情和管理标签");
  pass(
    "双主题 1280×720 详情收起与展开、长文件名、滑入滑出、滚动和减少动态效果",
  );

  pass("双主题桌面和移动路径编辑、真实目录补全、键盘、取消及中文空格前缀");

  const signingOut = await browser.newPage({
    hasTouch: true,
    viewport: desktopViewport,
  });
  await signingOut.goto(base + "/login");
  await signingOut.locator("#accessKey").fill(env.MINIO_ROOT_USER);
  await signingOut.locator("#secretKey").fill(env.MINIO_ROOT_PASSWORD);
  await signingOut.locator("#do-login").click();
  await signingOut.locator("#acknowledge-confirm").click();
  await signingOut.getByRole("button", { name: "更多", exact: true }).tap();
  await signingOut.getByRole("link", { name: "退出登录", exact: true }).click();
  await expect(signingOut).toHaveURL(base + "/login");
  await expect(
    signingOut.getByRole("navigation", { name: "主导航" }),
  ).toHaveCount(0);
  await signingOut.close();
  pass("更多菜单退出登录并返回独立登录布局");
  assert.deepEqual(errors, []);
  pass("无浏览器运行时异常");
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(
      { status: "passed", base, checks, screenshots: shots.length, shots },
      null,
      2,
    ),
  );
  console.log(
    "PASS complete v2 acceptance: " +
      checks.length +
      " checks; " +
      shots.length +
      " screenshots",
  );
} catch (e) {
  await page
    .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  fs.writeFileSync(path.join(output, "failure.txt"), String(e));
  throw e;
} finally {
  await api("/associations", "POST", { policy, user, remove: true }).catch(
    () => {},
  );
  await api("/groups/" + group, "PUT", { member: user, remove: true }).catch(
    () => {},
  );
  await api("/users/" + user, "DELETE").catch(() => {});
  await api("/policies/" + policy, "DELETE").catch(() => {});
  if (accessKey) await api("/keys/" + accessKey, "DELETE").catch(() => {});
  for (const b of createdBuckets) {
    try {
      const all = [];
      for await (const o of client.listObjects(b, "", true, {
        IncludeVersion: true,
      }))
        all.push({ name: o.name, versionId: o.versionId });
      if (all.length) await client.removeObjects(b, all);
      await client.removeBucket(b);
    } catch (e) {
      console.error("Test resource cleanup failed:", b, e.message);
    }
  }
  await browser.close();
}
