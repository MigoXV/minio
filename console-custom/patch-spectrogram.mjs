#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrow, hash-bound fixes to the distributed v7.10.1 ESM plugin. The npm cache
// remains untouched. Fix container selection and cancellation without rebuilding
// or copying the rest of the third-party library into this repository.
// Keep the FFT linear and let the application map its bins when drawing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filename = path.join(repo, '.local/console-workspace/web-app/node_modules/wavesurfer.js/dist/plugins/spectrogram.esm.js');
const marker = '/* local-preview-container-and-cancel-v1 */';
let source = fs.readFileSync(filename, 'utf8');
const v2 = '/* local-preview-viewport-overlap-v2 */';
const v3 = '/* local-preview-frequency-rows-v3 */';
if (source.startsWith(v3)) { console.log('Spectrogram compatibility fixes verified'); process.exit(0); }
if (!source.startsWith(v2)) {
  if (!source.startsWith(marker)) {
    if (crypto.createHash('sha256').update(source).digest('hex') !== '8d7c132801fe6c74199ee66b8f1e0c86946f9a356cbb7ba1156fa99b656722c3') {
      throw new Error('Spectrogram distribution changed; review the local cancellation patch before building');
    }
    const replace = (before, after) => {
      if (source.split(before).length !== 2) throw new Error('Spectrogram patch anchor differs from the reviewed version');
      source = source.replace(before, after);
    };
    replace('this.container=this.wavesurfer.getWrapper(),this.container.appendChild(this.wrapper)',
      'this.container=this.options.container||this.wavesurfer.getWrapper(),this.container.appendChild(this.wrapper)');
    replace('destroy(){this.unAll(),',
      'destroy(){if(this.isDestroyed)return;for(const pending of this.workerPromises.values())pending.resolve([]);this.workerPromises.clear();this.buffer=null;this.unAll(),');
    replace('yield this.getFrequenciesData();this.drawSpectrogram(this.cachedFrequencies)',
      'yield this.getFrequenciesData();if(!this.wavesurfer||!this.wrapper)return;this.drawSpectrogram(this.cachedFrequencies)');
    replace('const e=yield this.getFrequencies(t);return this.cachedFrequencies=e,this.cachedBuffer=t,e',
      'const e=yield this.getFrequencies(t);if(!this.wavesurfer)return null;return this.cachedFrequencies=e,this.cachedBuffer=t,e');
    replace('this.workerPromises.set(l,{resolve:e,reject:t}),setTimeout((()=>{this.workerPromises.has(l)&&(this.workerPromises.delete(l),t(new Error("Worker timeout")))}),3e4)',
      'const timer=setTimeout((()=>{this.workerPromises.has(l)&&(this.workerPromises.delete(l),t(new Error("Worker timeout")))}),3e4);this.workerPromises.set(l,{resolve:value=>{clearTimeout(timer);e(value)},reject:error=>{clearTimeout(timer);t(error)}})');
    source = `${marker}\n${source}`;
  }
  // The published implementation silently caps the requested overlap at 50%.
  // Keep the main-thread fallback and embedded Worker consistent with the UI's 75%.
  if (crypto.createHash('sha256').update(source).digest('hex') !== '34d37745645a8e7ae03f845115779f564ab2ec8dca76bb1eb8a953907cf82118') throw new Error('Unexpected v1 spectrogram patch content');
  const match = source.match(/var k=X\("([^"]+)"/);
  if (!match) throw new Error('Embedded spectrogram Worker anchor missing');
  let worker = Buffer.from(match[1], 'base64').toString('utf8');
  const anchor = 'const v=.5*p;z=Math.min(z,v)';
  if (worker.split(anchor).length !== 2) throw new Error('Worker overlap anchor changed');
  worker = worker.replace(anchor, 'const v=.75*p;z=Math.min(z,v)');
  source = source.replace(match[1], Buffer.from(worker).toString('base64'));
  const fallback = 'const g=.5*p;v=Math.min(v,g)';
  if (source.split(fallback).length !== 2) throw new Error('Fallback overlap anchor changed');
  source = source.replace(fallback, 'const g=.75*p;v=Math.min(v,g)');
  source = `${v2}\n${source}`;
}
if (crypto.createHash('sha256').update(source).digest('hex') !== '77d5c8fb4aabfaf000b926cc1fd72d3f88fa46dcfc5962a7b9e7cc6c8900b6b4') throw new Error('Unexpected v2 spectrogram patch content');
const segment = 'm=e.slice(u,p);if(0===m.length)return;const f=m.length';
if (source.split(segment).length !== 2) throw new Error('Spectrogram drawing anchor changed');
source = source.replace(segment,
  'm=e.slice(u,p);if(0===m.length)return;if(this.options.drawFrequencyRows){this.options.drawFrequencyRows(t,m,s,i,r,l,h,this.colorMap);return}const f=m.length');
fs.writeFileSync(filename, `${v3}\n${source}`);
console.log('Spectrogram container, cancellation, overlap and frequency rendering fixes verified');
