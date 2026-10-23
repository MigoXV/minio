#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end test against an explicitly selected isolated or deployed instance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repo, '.local/console-workspace/web-app/package.json'));
const { Client } = require('minio');
const { chromium, expect } = require('@playwright/test');
const output = path.join(repo, '.local/audio-tests');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const env = Object.fromEntries(fs.readFileSync(process.env.MINIO_TEST_ENV || path.join(repo, 'ops/minio-lan/.local/minio.env'), 'utf8')
  .split('\n').filter(line => line && !line.startsWith('#')).map(line => { const p = line.indexOf('='); return [line.slice(0, p), line.slice(p + 1)]; }));
const base = process.env.MINIO_TEST_CONSOLE || 'http://127.0.0.1:19011';
const s3 = new URL(process.env.MINIO_TEST_S3 || 'http://127.0.0.1:19010');
const ca = s3.protocol === 'https:' ? fs.readFileSync(process.env.MINIO_TEST_CA || path.join(os.homedir(), '.local/share/minio-prod/config/certs/ca.crt')) : undefined;
const client = new Client({ endPoint: s3.hostname, port: Number(s3.port), useSSL: s3.protocol === 'https:',
  accessKey: env.MINIO_ROOT_USER, secretKey: env.MINIO_ROOT_PASSWORD,
  ...(s3.protocol === 'https:' ? { transportAgent: new https.Agent({ ca }) } : {}) });
const bucket = `audio-preview-test-${Date.now()}`;
const names = [];
let browser;
const errors = [];

function wav(seconds = 3) {
  const rate = 16000, samples = rate * seconds;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(16000 * (0.2 + 0.8 * Math.sin(Math.PI * 6 * i / samples) ** 2) * Math.sin(2 * Math.PI * 1000 * i / rate)), 44 + i * 2);
  return b;
}
async function put(name, data, type) {
  await client.putObject(bucket, name, data, { 'Content-Type': type });
  names.push(name);
}

try {
  await client.makeBucket(bucket, 'us-east-1');
  await client.setBucketVersioning(bucket, { Status: 'Enabled' });
  const wave = wav();
  fs.writeFileSync(path.join(output, 'tone.wav'), wave);
  const filename = 'tone space + 汉字.WAV';
  await put(filename, wave, 'application/octet-stream');
  await put('corrupt.wav', Buffer.from('not an audio stream'), 'audio/wav');
  await put('long.wav', wav(601), 'audio/wav');
  // A valid header with a large payload exercises the metadata size guard.
  const oversized = Buffer.alloc(64 * 1024 * 1024 + 1024);
  wave.copy(oversized, 0, 0, 44);
  oversized.writeUInt32LE(oversized.length - 8, 4); oversized.writeUInt32LE(oversized.length - 44, 40);
  await put('oversized.wav', oversized, 'audio/wav');
  await put('image.png', fs.readFileSync(path.join(repo, '.local/console-workspace/web-app/tests/uploads/internode.png')), 'image/png');
  await put('document.pdf', fs.readFileSync(path.join(repo, '.local/console-workspace/web-app/tests/uploads/file1.pdf')), 'application/pdf');
  const formats = [
    ['mp3', 'audio/mpeg'], ['flac', 'audio/flac'], ['ogg', 'audio/ogg'],
    ['opus', 'audio/ogg'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'],
  ];
  const testFormats = [];
  for (const [ext, mime] of formats) {
    const target = path.join(output, `tone.${ext}`);
    if (process.env.TEST_FFMPEG) execFileSync(process.env.TEST_FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(output, 'tone.wav'), target]);
    if (fs.existsSync(target)) { await put(`tone.${ext}`, fs.readFileSync(target), mime); testFormats.push([ext, mime]); }
  }
  const video = path.join(output, 'video.mp4');
  if (process.env.TEST_FFMPEG) execFileSync(process.env.TEST_FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=1', '-pix_fmt', 'yuv420p', video]);
  const hasVideo = fs.existsSync(video);
  if (hasVideo) await put('video.mp4', fs.readFileSync(video), 'video/mp4');
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const installed = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const executablePath = process.env.MINIO_TEST_BROWSER || installed.map(name => path.join(cache, name, 'chrome-linux64/chrome')).find(p => fs.existsSync(p));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const audioReads = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/objects/download') && request.resourceType() === 'fetch' && !request.headers().range) audioReads.push(url.searchParams.get('prefix'));
  });
  page.on('console',message=>{if(/appearance-init|inline script/i.test(message.text())&&/Content Security Policy|Refused to execute/i.test(message.text()))errors.push(message.text());});
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
    window.__audioBlobURLs = new Set();
    URL.createObjectURL = blob => {
      const url = createURL(blob);
      if (blob.type.startsWith('audio/') || blob.type === 'application/octet-stream') window.__audioBlobURLs.add(url);
      return url;
    };
    URL.revokeObjectURL = url => { window.__audioBlobURLs.delete(url); revokeURL(url); };
    const NativeWorker = window.Worker;
    window.__audioWorkerStats = { created: 0, active: 0, messages: 0 };
    window.Worker = class extends NativeWorker {
      alive = true;
      constructor(...args) { super(...args); window.__audioWorkerStats.created++; window.__audioWorkerStats.active++; this.addEventListener('message',e=>{if(e.data.type==='frequenciesResult')window.__fftFrames=e.data.result?.[0]?.length;}); }
      postMessage(...args) {
        window.__audioWorkerStats.messages++;
        if (window.__holdAudioFFT && args[0]?.type === 'calculateFrequencies') return;
        return super.postMessage(...args);
      }
      terminate() { if (this.alive) { window.__audioWorkerStats.active--; this.alive = false; } super.terminate(); }
    };
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#accessKey').fill(env.MINIO_ROOT_USER);
  await page.locator('#secretKey').fill(env.MINIO_ROOT_PASSWORD);
  await page.locator('#do-login').click();
  await page.waitForURL('**/browser*');
  await page.waitForLoadState('networkidle');
  if (await page.locator('#acknowledge-confirm').isVisible()) await page.locator('#acknowledge-confirm').click();
  async function open(name) {
    await page.goto(`${base}/browser/${bucket}`, { waitUntil: 'networkidle' });
    await page.getByText(name, { exact: true }).click();
    if(name===filename && !page.__detailCaptured) {
      page.__detailCaptured=true;
      await expect(page.locator('#details-panel')).toHaveCSS('opacity','1');
      await page.screenshot({animations:"disabled",path:path.join(output,'details-vallum.png')});
      const versionsButton=page.getByRole('button',{name:'Display Object Versions',exact:true});
      if(await versionsButton.isEnabled()) {
        await versionsButton.click();
        const search=page.getByPlaceholder(/Start typing to filter versions/);
        await expect(search).toBeVisible();
        await search.fill('no-version-matches-this-query');
        await search.fill('');
        await page.reload({waitUntil:'networkidle'});
        await expect(page.getByRole('button',{name:'Preview',exact:true})).toBeVisible();
        console.log('PASS object version view retains its filtering control');
      }

      const downloadPromise=page.waitForEvent('download');
      await page.getByRole('button',{name:'Download',exact:true}).click();
      const download=await downloadPromise;
      assert.deepEqual(fs.readFileSync(await download.path()),wave,'browser download must preserve bytes');
      // Reload to release the download action's Blob; preview lifetime checks track only the new document.
      await page.reload({waitUntil:'networkidle'});
      await expect(page.getByRole('button',{name:'Preview',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'外观主题',exact:true}).click();
      await page.getByRole('button',{name:'深色 · 苍渊',exact:true}).click();
      await page.screenshot({animations:"disabled",path:path.join(output,'details-abyssus.png')});
      await page.getByRole('button',{name:'外观主题',exact:true}).click();
      await page.getByRole('button',{name:'浅色 · 白垣',exact:true}).click();
    }
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
  }
  await page.goto(`${base}/browser/${bucket}`, { waitUntil: 'networkidle' });
  await page.locator('#upload-main').click();
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByText('上传文件',{exact:true}).click();
  const chooser=await chooserPromise;
  await chooser.setFiles({name:'browser-upload.txt',mimeType:'text/plain',buffer:Buffer.from('browser upload regression')});
  names.push('browser-upload.txt');
  await expect(page.getByText('browser-upload.txt',{exact:true})).toBeVisible({timeout:20000});
  const uploaded=await client.getObject(bucket,'browser-upload.txt');
  const chunks=[];for await(const chunk of uploaded)chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(),'browser upload regression');
  await page.getByLabel('筛选存储桶', { exact: true }).fill(bucket);
  await expect(page.locator('.av-bucket')).toHaveCount(1);
  await page.getByLabel('筛选存储桶', { exact: true }).fill('');
  await page.locator('#search-resource').fill('tone space');
  await expect(page.getByText(filename, {exact:true})).toBeVisible();
  await expect(page.getByText('corrupt.wav', {exact:true})).toHaveCount(0);
  await page.locator('#search-resource').fill('');
  if(await page.locator('#object-manager-toggle').isVisible())await page.locator('#object-manager-toggle').click();
  await page.screenshot({animations:"disabled",path:path.join(output,'workspace-vallum.png')});
  await page.getByRole('button',{name:'外观主题',exact:true}).click();
  await page.getByRole('button',{name:'深色 · 苍渊',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','abyssus');
  await page.screenshot({animations:"disabled",path:path.join(output,'workspace-abyssus.png')});
  await page.getByRole('button',{name:'外观主题',exact:true}).click();
  await page.getByRole('button',{name:'浅色 · 白垣',exact:true}).click();
  const toneRow=page.locator('.rowLine').filter({hasText:filename});
  await toneRow.getByRole('button',{name:'preview',exact:true}).click();
  await expect(page.getByTestId('audio-preview')).toBeVisible();
  await page.keyboard.press('Escape');

  await open(filename);
  await expect(page.getByRole('button', { name: '展开频谱图', exact: true })).toBeVisible({ timeout: 20000 });
  assert.equal(await page.locator('audio').evaluate(e => e.paused), true, 'preview must not autoplay');
  assert.equal(await page.evaluate(() => window.__audioWorkerStats.created), 0, 'collapsed preview must not create an FFT worker');
  assert.equal(audioReads.filter(name => name === filename).length, 1, 'analysis must fetch the audio only once');
  assert.ok(await page.evaluate(() => window.__audioBlobURLs.size) > 0, 'the bounded audio Blob should supply playback');
  const waveCanvas = page.getByTestId('audio-waveform');
  await expect(waveCanvas.locator('canvas').first()).toBeVisible();
  const box = await waveCanvas.boundingBox();
  await waveCanvas.click({ position: { x: box.width * 0.5, y: 60 } });
  assert.ok(await page.locator('audio').evaluate(e => e.currentTime) > 0.5, 'waveform click must seek');
  await page.getByLabel('播放速度', { exact: true }).selectOption('1.5');
  assert.equal(await page.locator('audio').evaluate(e => e.playbackRate), 1.5);
  await page.locator('audio').evaluate(async e => { e.volume = 0.25; await e.play(); });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('audio').evaluate(e => e.paused), false);
  await page.locator('audio').evaluate(e => e.pause());
  const audioPreview=page.getByTestId('audio-preview');
  async function theme(label) {
    await audioPreview.getByRole('button',{name:'外观主题',exact:true}).click();
    await audioPreview.getByRole('button',{name:label,exact:true}).click();
  }
  const preserved = await page.locator('audio').evaluate(e=>({time:e.currentTime,volume:e.volume,rate:e.playbackRate,src:e.currentSrc}));
  await theme('深色 · 苍渊');
  await expect(page.locator('html')).toHaveAttribute('data-theme','abyssus');
  assert.deepEqual(await page.locator('audio').evaluate(e=>({time:e.currentTime,volume:e.volume,rate:e.playbackRate,src:e.currentSrc})),preserved);
  assert.equal(await page.evaluate(()=>window.__audioWorkerStats.created),0);
  await page.screenshot({animations:"disabled",path:path.join(output,'preview-abyssus.png')});
  await theme('浅色 · 白垣');
  await page.screenshot({animations:"disabled",path:path.join(output,'preview-vallum.png')});
  await theme('跟随系统');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','abyssus');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','vallum');
  const js = [];
  page.on('request', r => { if (/\.chunk\.js(?:\?|$)/.test(r.url())) js.push(r.url()); });
  await page.getByRole('button', { name: '展开频谱图', exact: true }).click();
  await expect(page.getByText(/频率：0–/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('audio-spectrogram-canvas').locator('canvas').last()).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = [...document.querySelectorAll('[data-testid="audio-spectrogram-canvas"] canvas')].find(c => c.width > 200);
    if (!canvas) return false;
    const context = canvas.getContext('2d');
    const brightness = frequency => {
      const y = Math.round(canvas.height * (1 - frequency / 24000));
      const pixels = context.getImageData(Math.floor(canvas.width / 2), y - 2, 1, 5).data;
      let result = 0;
      for (let i = 0; i < pixels.length; i += 4) result = Math.max(result, pixels[i] + pixels[i + 1] + pixels[i + 2]);
      return result;
    };
    return brightness(1000) > brightness(6000) + 80;
  });
  assert.ok(js.length > 0, 'spectrogram code must load on first expansion');
  assert.equal(audioReads.filter(name => name === filename).length, 1, 'spectrogram must reuse decoded audio without downloading again');
  const stats = await page.evaluate(() => ({ ...window.__audioWorkerStats }));
  assert.equal(await page.evaluate(()=>window.__fftFrames),Math.ceil((48000*3-1024)/256),'75% overlap must be honored by the actual Worker');
  assert.ok(stats.created > 0 && stats.active > 0 && stats.messages > 0, 'FFT must run in a Worker');
  await page.screenshot({animations:"disabled", path: path.join(output, 'waveform-spectrum.png'), fullPage: true });
  await page.getByRole('button', { name: '收起频谱图', exact: true }).click();
  await page.getByRole('button', { name: '展开频谱图', exact: true }).click();
  await expect(page.getByText(/频率：0–/)).toBeVisible();
  assert.deepEqual(await page.evaluate(() => ({ ...window.__audioWorkerStats })), stats, 'cached spectrum must not create a Worker or submit new FFT work');
  // Both charts share the same selection and visible time range.
  const chart=audioPreview.locator('.av-wave-section .av-chart');
  const rect=await chart.boundingBox();
  await page.mouse.move(rect.x+rect.width*.25,rect.y+50);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.65,rect.y+50,{steps:12});
  await page.mouse.up();
  await expect(page.getByTestId('selection-start')).not.toHaveText('—');
  await expect(page.getByRole('button',{name:'循环选区',exact:true})).toBeEnabled();
  const selectionText=await page.getByTestId('selection-start').innerText();
  await page.getByRole('button',{name:'缩放至选区',exact:true}).click();
  await page.waitForTimeout(300);
  const axes=await audioPreview.locator('.av-time-axis').allTextContents();
  assert.equal(axes[0],axes[1],'waveform and spectrum time axes must match');
  assert.ok(!axes[0].startsWith('00:00.000'),'selection zoom must change viewport');
  await theme('深色 · 苍渊');
  await expect(page.getByTestId('selection-start')).toHaveText(selectionText);
  const scroll=await waveCanvas.locator('[part="scroll"]').evaluate(e=>e.scrollLeft);
  const spectrumTransform=await page.getByTestId('audio-spectrogram-canvas').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);
  assert.ok(scroll>0,'waveform must actually scroll into the selection');
  assert.ok(Math.abs(scroll+spectrumTransform)<2,'spectrum drawing must scroll with waveform, not only its labels');
  const overlayZ=await audioPreview.locator('.av-chart-overlay').first().evaluate(e=>Number(getComputedStyle(e).zIndex));
  assert.ok(overlayZ>4,'selection must be above the spectrum canvases');

  await page.screenshot({animations:"disabled",path:path.join(output,'analysis-selection-abyssus.png')});
  await theme('浅色 · 白垣');
  await page.screenshot({animations:"disabled",path:path.join(output,'analysis-selection-vallum.png')});
  await page.getByRole('button',{name:'循环选区',exact:true}).click();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForTimeout(1800);
  const position=await page.locator('audio').evaluate(e=>e.currentTime);
  assert.ok(position>=.7&&position<=2.05,`loop playback escaped selection: ${position}`);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'显示全段',exact:true}).click();
  await page.getByRole('button',{name:'清除选区',exact:true}).click();
  await expect(page.getByRole('button',{name:'循环选区',exact:true})).toBeDisabled();
  await page.getByLabel('FFT',{exact:true}).selectOption('2048');
  await expect(page.getByText(/频率：0–/)).toContainText('FFT 2048',{timeout:20000});
  await page.getByLabel('重叠',{exact:true}).selectOption('0.5');
  await expect(page.getByText(/频率：0–/)).toBeVisible({timeout:20000});
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({animations:"disabled",path:path.join(output,'analysis-1280x720.png')});
  const closeRect=await page.getByRole('button',{name:'关闭窗口',exact:true}).boundingBox();
  assert.ok(closeRect.y>=0&&closeRect.y+closeRect.height<=720,'close must stay on screen');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({animations:"disabled",path:path.join(output,'analysis-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile layout must not overflow horizontally');
  await page.setViewportSize({width:1440,height:900});
  console.log('PASS browser upload/download data path and direct preview integration');
  console.log('PASS appearance persistence, system listener, selection, synchronized zoom, loop, FFT parameters and small-screen layout');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('audio-preview')).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__audioWorkerStats.active), 0, 'closing the modal must terminate its Worker');
  assert.equal(await page.evaluate(() => window.__audioBlobURLs.size), 0, 'closing the modal must revoke its audio Blob URLs');
  console.log('PASS WAV: no autoplay, waveform, seek, playback, volume, speed, lazy FFT Worker, cached reopening and modal cleanup');

  // Hold an in-flight worker response to deterministically test cancellation.
  await open(filename);
  await expect(page.getByRole('button', { name: '展开频谱图', exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => { window.__holdAudioFFT = true; });
  await page.getByRole('button', { name: '展开频谱图', exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.messages > 0);
  await page.getByRole('button', { name: '收起频谱图', exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  await page.evaluate(() => { window.__holdAudioFFT = false; });
  await page.getByRole('button', { name: '展开频谱图', exact: true }).click();
  await expect(page.getByText(/频率：0–/)).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  await open(filename);
  await expect(page.getByRole('button', { name: '展开频谱图', exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => { window.__holdAudioFFT = true; });
  await page.getByRole('button', { name: '展开频谱图', exact: true }).click();
  await page.waitForFunction(() => window.__audioWorkerStats.messages > 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__audioWorkerStats.active === 0);
  console.log('PASS 1 kHz spectral band and cancellation during FFT on collapse/close, followed by successful retry');

  if (testFormats.length) {
    for (const [ext] of testFormats) {
      await open(`tone.${ext}`);
      await page.waitForFunction(() => !!document.querySelector('audio') && (document.querySelector('audio').readyState >= 1 || !!document.querySelector('audio').error));
      const supported = await page.locator('audio').evaluate(e => !e.error);
      if (supported) {
        await expect(page.getByRole('button', { name: '展开频谱图', exact: true })).toBeVisible({ timeout: 20000 });
        await page.locator('audio').evaluate(async e => { e.volume = 0; await e.play(); e.pause(); });
        console.log(`PASS ${ext}: browser playback and waveform`);
      } else {
        await expect(page.getByRole('alert')).toContainText('浏览器无法播放');
        console.log(`PASS ${ext}: browser codec unavailable; download fallback shown`);
      }
    }
  }
  await open('long.wav');
  await expect(page.getByText(/音频超过 10 分钟/)).toBeVisible();
  assert.equal(await page.evaluate(() => window.__audioWorkerStats.created), 0);
  await open('oversized.wav');
  await expect(page.getByText(/文件超过 64 MiB/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: '展开频谱图', exact: true })).toHaveCount(0);
  await open('corrupt.wav');
  await expect(page.getByRole('alert')).toContainText('浏览器无法播放');
  console.log('PASS long, oversized and corrupt audio: graceful playback/download fallback without FFT');
  await page.route('**/objects/download?**', route => route.fulfill({ status: 403, body: 'Forbidden' }));
  await open(filename);
  await expect(page.getByRole('alert')).toContainText('浏览器无法播放');
  await page.unroute('**/objects/download?**');
  console.log('PASS denied audio read: permission error fallback');

  await open('image.png');
  await expect(page.locator('img[alt="preview"]')).toBeVisible();
  await open('document.pdf');
  await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 20000 });
  if (hasVideo) {
    await open('video.mp4');
    await expect(page.locator('video')).toBeVisible();
  }
  console.log('PASS image, PDF and video preview regression');
  assert.deepEqual(errors, [], 'unexpected browser exceptions');
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({animations:"disabled", path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${await page.locator('body').innerText()}\nBrowser errors: ${JSON.stringify(errors)}`);
    }
  }
  throw error;
} finally {
  await browser?.close();
  // Remove every version, including delete markers, belonging to this test bucket.
  const versions = [];
  for await (const object of client.listObjects(bucket, '', true, { IncludeVersion: true })) versions.push({ name: object.name, versionId: object.versionId });
  if (versions.length) await client.removeObjects(bucket, versions);
  await client.removeBucket(bucket);
  console.log('PASS temporary test objects, versions and bucket removed');
}
