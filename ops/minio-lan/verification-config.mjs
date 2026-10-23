#!/usr/bin/env node
// Write the verifier input to a pipe. Never use the output as a tracked file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.local');
const [s3URL, consoleURL] = process.argv.slice(2);
if (!s3URL || !consoleURL) throw new Error('Usage: verification-config.mjs <S3 HTTPS URL> <console HTTPS URL>');
const env = Object.fromEntries(fs.readFileSync(path.join(dir, 'minio.env'), 'utf8').split('\n').filter(Boolean).map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
process.stdout.write(JSON.stringify({ s3URL, consoleURL, rootUser: env.MINIO_ROOT_USER,
  rootPassword: env.MINIO_ROOT_PASSWORD, caPEM: fs.readFileSync(path.join(dir, 'certs/ca.crt'), 'utf8') }));
