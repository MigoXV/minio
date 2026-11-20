#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Keep the previous release's hashed chunks for tabs opened before the restart.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base=new URL(process.argv[2]||'http://127.0.0.1:19001/');
const response=await fetch(new URL('asset-manifest.json',base),{signal:AbortSignal.timeout(5000)});
if(!response.ok)throw new Error('Cannot read previous Console asset manifest');
const manifest=await response.json();
const build=path.join(repo,'.local/console-workspace/web-app/build');
let count=0;
for(const value of new Set(Object.values(manifest.files||{}))){
 if(typeof value!=='string')continue;
 const relative=value.replace(/^\.\//,'');
 // Only static asset paths; never copy index.html or executable/application config.
 if(!/^static\/(js|css|media)\/[\w.-]+$/.test(relative))continue;
 const target=path.join(build,relative);
 if(fs.existsSync(target))continue;
 const asset=await fetch(new URL(relative,base),{signal:AbortSignal.timeout(15000)});
 if(!asset.ok)throw new Error(`Previous asset unavailable: ${relative}`);
 const bytes=Buffer.from(await asset.arrayBuffer());
 if(!bytes.length)throw new Error('Empty previous asset');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);count++;
}
console.log(`Preserved ${count} previous Console assets for open tabs`);
