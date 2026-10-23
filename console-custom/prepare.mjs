#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const custom = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(custom);
const go = process.env.MINIO_GO || path.join(repo, '.local/toolchains/go/bin/go');
const version = 'v1.7.7-0.20250905210349-2017f33b26e1';
const module = JSON.parse(execFileSync(go, ['list', '-m', '-json', 'github.com/minio/console'], { cwd: repo, encoding: 'utf8' }));
if (module.Version !== version || module.Replace) throw new Error('Console upstream changed; rebase and verify the custom preview patch first');
const workspace = path.join(repo, '.local/console-workspace');
if (!fs.existsSync(workspace)) {
  fs.cpSync(module.Dir, workspace, { recursive: true });
  const writable = directory => {
    fs.chmodSync(directory, fs.statSync(directory).mode | 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) writable(filename);
      else if (entry.isFile()) fs.chmodSync(filename, fs.statSync(filename).mode | 0o600);
    }
  };
  writable(workspace);
}
const objects = 'web-app/src/screens/Console/Buckets/ListBuckets/Objects';
// Reset every upstream patch target; local preparation is repeatable.
const designPatch = fs.readFileSync(path.join(custom, 'patches/figma-workspace.patch'), 'utf8');
const patchTargets = [...designPatch.matchAll(/^--- a\/(.+)$/gm)].map(match => match[1]);
for (const relative of new Set(['api/configure_console.go', 'web-app/src/screens/Console/Console.tsx', `${objects}/Preview/PreviewFileContent.tsx`, `${objects}/utils.ts`, ...patchTargets])) {
  fs.copyFileSync(path.join(module.Dir, relative), path.join(workspace, relative));
  fs.chmodSync(path.join(workspace, relative), 0o600);
}
execFileSync('patch', ['-p1', '--batch', '--forward'], {
  cwd: workspace, input: fs.readFileSync(path.join(custom, 'patches/audio-preview.patch')), stdio: ['pipe', 'inherit', 'inherit'],
});
execFileSync('patch', ['-p1', '--batch', '--forward'], { cwd: workspace, input: designPatch, stdio: ['pipe', 'inherit', 'inherit'] });
const configurePath = path.join(workspace, 'api/configure_console.go');
const configure = fs.readFileSync(configurePath, 'utf8');
const originalHandler = 'return setupGlobalMiddleware(api.Serve(setupMiddlewares))';
if (!configure.includes(originalHandler)) throw new Error('Console handler changed; rebase the management route');
fs.writeFileSync(configurePath, configure.replace(originalHandler, 'return setupGlobalMiddleware(newManagementHandler(api.Serve(setupMiddlewares)))'));
fs.copyFileSync(path.join(custom, 'server/manage.go'), path.join(workspace, 'api/manage.go'));
fs.copyFileSync(path.join(custom, 'appearance-init.js'), path.join(workspace, 'web-app/public/appearance-init.js'));
fs.cpSync(path.join(custom, 'ui'), path.join(workspace, 'web-app/src/custom'), { recursive: true });
fs.cpSync(path.join(custom, 'login'), path.join(workspace, 'web-app/src/screens/LoginPage'), { recursive: true });
const consolePath = path.join(workspace, 'web-app/src/screens/Console/Console.tsx');
let consoleSource = fs.readFileSync(consolePath, 'utf8');
const licenseMarker = 'const License = React.lazy(() => import("./License/License"));';
if (!consoleSource.includes(licenseMarker)) throw new Error('Console route structure changed; rebase management UI');
consoleSource = consoleSource.replace(licenseMarker, `${licenseMarker}\nconst ManagementWorkspace = React.lazy(() => import("../../custom/ManagementWorkspace"));`);
const routeMarker = '    {\n      component: License,';
if (!consoleSource.includes(routeMarker)) throw new Error('Console route list changed; rebase management UI');
consoleSource = consoleSource.replace(routeMarker, `    { component: ManagementWorkspace, path: "/manage", forceDisplay: true },\n${routeMarker}`);
fs.writeFileSync(consolePath, consoleSource);
for (const entry of fs.readdirSync(path.join(custom, 'src'))) {
  fs.copyFileSync(path.join(custom, 'src', entry), path.join(workspace, objects, 'Preview', entry));
}
const packagePath = path.join(workspace, 'web-app/package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.dependencies['wavesurfer.js'] = '7.10.1';
// Same Git object as the original unavailable minio/mds URL, not a new fork revision.
pkg.dependencies.mds = 'https://codeload.github.com/bexsoft/mds/tar.gz/400914d72cb3ffa27d600e0ae1f17ece2182ec22';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
fs.copyFileSync(path.join(custom, 'yarn.lock'), path.join(workspace, 'web-app/yarn.lock'));
fs.writeFileSync(path.join(workspace, 'web-app/.yarnrc.yml'), 'nodeLinker: node-modules\nchecksumBehavior: throw\n');
const mod = fs.readFileSync(path.join(repo, 'go.mod'), 'utf8');
fs.writeFileSync(path.join(repo, '.local/console-build.mod'), `${mod}\nreplace github.com/minio/console => ${JSON.stringify(workspace)}\n`);
fs.copyFileSync(path.join(repo, 'go.sum'), path.join(repo, '.local/console-build.sum'));
console.log('Prepared version-bound Console sources in the ignored local workspace');
