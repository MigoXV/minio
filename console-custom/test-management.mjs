#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only against an isolated, empty MinIO instance and synthetic credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repo, '.local/console-workspace/web-app/package.json'));
const {Client} = require('minio');
const [s3URL, consoleURL, envFile] = process.argv.slice(2);
if (!s3URL || !consoleURL || !envFile) throw new Error('Usage: test-management.mjs <S3 URL> <Console URL> <synthetic env file>');
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(Boolean).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
const base = new URL(consoleURL);
const s3 = new URL(s3URL);
const s3client = new Client({endPoint: s3.hostname, port: Number(s3.port), useSSL: false, accessKey: env.MINIO_ROOT_USER, secretKey: env.MINIO_ROOT_PASSWORD});
let cookie = '';
async function request(resource, method = 'GET', body, origin = base.origin) {
  const response = await fetch(new URL(resource, base), {method, headers: {
    ...(cookie ? {Cookie: cookie} : {}),
    ...(method === 'GET' ? {} : {'Content-Type': 'application/json', Origin: origin}),
  }, body: body === undefined ? undefined : JSON.stringify(body)});
  const raw = await response.text();
  return {status: response.status, body: raw ? JSON.parse(raw) : null, cookie: response.headers.get('set-cookie')};
}
const suffix = Date.now().toString(36);
const user = `ui-test-${suffix}`;
const group = `ui-group-${suffix}`;
const policy = `ui-policy-${suffix}`;
const bucket = `ui-test-${suffix}`;
let bucketCreated = false;
try {
  assert.equal((await request('/api/v1/manage/users')).status, 401);
  const login = await request('/api/v1/login', 'POST', {accessKey: env.MINIO_ROOT_USER, secretKey: env.MINIO_ROOT_PASSWORD});
  assert.equal(login.status, 204);
  cookie = login.cookie?.split(';')[0] || '';
  assert.ok(cookie);
  assert.equal((await request('/api/v1/manage/users', 'POST', {name: user, password: 'synthetic-pass-123'}, 'http://evil.invalid')).status, 403);
  assert.equal((await request('/api/v1/manage/overview')).status, 200);
  assert.equal((await request('/api/v1/manage/config/api')).status, 200);
  assert.equal((await request('/api/v1/manage/users', 'POST', {name: user, password: 'synthetic-pass-123'})).status, 201);
  const adminCookie = cookie;
  const limitedLogin = await request('/api/v1/login', 'POST', {accessKey: user, secretKey: 'synthetic-pass-123'});
  assert.equal(limitedLogin.status, 204);
  cookie = limitedLogin.cookie?.split(';')[0] || '';
  assert.ok(cookie);
  assert.equal((await request('/api/v1/manage/users')).status, 403, 'unauthorized user must not list users');
  cookie = adminCookie;
  const users = await request('/api/v1/manage/users');
  assert.equal(users.status, 200);
  assert.ok(users.body.some(item => item.name === user));
  assert.equal(users.body.some(item => 'secretKey' in item), false);
  assert.equal((await request(`/api/v1/manage/users/${user}`, 'PUT', {status: 'disabled'})).status, 200);
  assert.equal((await request(`/api/v1/manage/users/${user}`, 'PUT', {status: 'enabled'})).status, 200);
  assert.equal((await request('/api/v1/manage/groups', 'POST', {name: group, members: [user]})).status, 201);
  assert.equal((await request(`/api/v1/manage/groups/${group}`)).status, 200);
  assert.equal((await request(`/api/v1/manage/groups/${group}`, 'PUT', {status: 'disabled'})).status, 200);
  assert.equal((await request(`/api/v1/manage/groups/${group}`, 'PUT', {status: 'enabled'})).status, 200);
  const document = {Version: '2012-10-17', Statement: [{Effect: 'Allow', Action: ['s3:ListBucket'], Resource: [`arn:aws:s3:::${bucket}`]}]};
  assert.equal((await request(`/api/v1/manage/policies/${policy}`, 'PUT', document)).status, 200);
  assert.equal((await request(`/api/v1/manage/policies/${policy}`)).status, 200);
  assert.equal((await request('/api/v1/manage/associations', 'POST', {policy, user})).status, 200);
  assert.equal((await request('/api/v1/manage/associations', 'POST', {policy, user, remove: true})).status, 200);
  const key = await request('/api/v1/manage/keys', 'POST', {name: `uitest${suffix}`});
  assert.equal(key.status, 201);
  assert.ok(key.body.accessKey && key.body.secretKey);
  const listedKeys = await request('/api/v1/manage/keys');
  assert.equal(listedKeys.status, 200);
  assert.ok(listedKeys.body.some(item => item.accessKey === key.body.accessKey));
  assert.equal(listedKeys.body.some(item => 'secretKey' in item), false);
  assert.equal((await request(`/api/v1/manage/keys/${key.body.accessKey}`, 'DELETE')).status, 200);
  await s3client.makeBucket(bucket);
  bucketCreated = true;
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/versioning`)).status, 200);
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/versioning`, 'PUT', {status: 'Enabled'})).status, 200);
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/versioning`)).body.status, 'Enabled');
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/policy`)).status, 200);
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/policy`, 'PUT', {policy: JSON.stringify({Version: '2012-10-17', Statement: [{Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/preview/*`}]})})).status, 200);
  assert.ok((await request(`/api/v1/manage/buckets/${bucket}/policy`)).body.policy.includes('preview'));
  assert.equal((await request(`/api/v1/manage/buckets/${bucket}/policy`, 'PUT', {policy: ''})).status, 200);
  console.log('PASS isolated management: session, CSRF, least privilege, IAM, keys, bucket policy/versioning, config help');
} finally {
  if (cookie) {
    await request(`/api/v1/manage/groups/${group}`, 'PUT', {member: user, remove: true}).catch(() => {});
    await request(`/api/v1/manage/users/${user}`, 'DELETE').catch(() => {});
    await request(`/api/v1/manage/policies/${policy}`, 'DELETE').catch(() => {});
  }
  if (bucketCreated) await s3client.removeBucket(bucket).catch(() => {});
}
