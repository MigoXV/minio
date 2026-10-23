#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Deploy an already tested binary; build and staging never touch the live executable.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const candidate = process.argv[2] && path.resolve(process.argv[2]);
if (!candidate || !fs.statSync(candidate).isFile())
  throw new Error(
    "Usage: node console-custom/deploy.mjs <verified candidate binary>",
  );
const live = path.join(repo, ".local/minio");
if (candidate === live) throw new Error("Candidate must be a separate file");
execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 10000 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(repo, ".local", `minio-before-${stamp}`);
const record = path.join(repo, ".local/figma-deployment.json");
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const service = "minio-lan.service";
const gatewayPID = execFileSync(
  "systemctl",
  ["--user", "show", "minio-lan-gateway.service", "-p", "MainPID", "--value"],
  { encoding: "utf8" },
).trim();
const probe = async () => {
  try {
    const r = await Promise.all(
      [
        "http://127.0.0.1:19000/minio/health/ready",
        "http://127.0.0.1:19001/",
      ].map((url) => fetch(url, { signal: AbortSignal.timeout(800) })),
    );
    const healthy = r.every((x) => x.status === 200);
    await Promise.all(r.map(x => x.body?.cancel()));
    return healthy;
  } catch {
    return false;
  }
};
if (!(await probe()))
  throw new Error(
    "Current instance is not healthy; refusing automatic replacement",
  );
fs.copyFileSync(live, backup);
fs.chmodSync(backup, 0o700);
const snapshot = {
  timestamp: stamp,
  backup,
  previousSHA256: hash(live),
  candidateSHA256: hash(candidate),
  gatewayPID,
  status: "prepared",
  samples: [],
};
const write = () =>
  fs.writeFileSync(record, JSON.stringify(snapshot, null, 2) + "\n", {
    mode: 0o600,
  });
write();
const install = (p) => {
  const pending = live + ".pending";
  fs.copyFileSync(p, pending);
  fs.chmodSync(pending, 0o700);
  fs.renameSync(pending, live);
};
let sampling = true;
const monitor = (async () => {
  while (sampling) {
    const at = Date.now();
    const healthy = await probe();
    snapshot.samples.push({ at, healthy });
    await new Promise((r) => setTimeout(r, 50));
  }
})();
try {
  install(candidate);
  const start = Date.now();
  await run("systemctl", ["--user", "restart", service], { timeout: 60000 });
  let healthy = false;
  while (Date.now() - start < 60000) {
    if (await probe()) {
      healthy = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!healthy)
    throw new Error("Candidate did not become healthy within 60 seconds");
  const pid = execFileSync(
    "systemctl",
    ["--user", "show", "minio-lan-gateway.service", "-p", "MainPID", "--value"],
    { encoding: "utf8" },
  ).trim();
  if (pid !== gatewayPID) throw new Error("Gateway PID changed unexpectedly");
  snapshot.status = "healthy";
  snapshot.restartToReadyMs = Date.now() - start;
  await new Promise((r) => setTimeout(r, 500));
} catch (error) {
  snapshot.error = String(error);
  install(backup);
  await run("systemctl", ["--user", "restart", service], { timeout: 60000 });
  snapshot.status = "rolled-back";
  process.exitCode = 1;
} finally {
  sampling = false;
  await monitor;
  const bad = snapshot.samples.filter((x) => !x.healthy);
  if (bad.length) {
    const first = snapshot.samples.indexOf(bad[0]);
    const last = snapshot.samples.indexOf(bad[bad.length - 1]);
    snapshot.unavailableUpperBoundMs =
      (snapshot.samples[last + 1]?.at ?? Date.now()) -
      (snapshot.samples[first - 1]?.at ?? bad[0].at);
  } else snapshot.unavailableUpperBoundMs = 0;
  write();
  console.log(
    JSON.stringify({
      status: snapshot.status,
      restartToReadyMs: snapshot.restartToReadyMs,
      unavailableUpperBoundMs: snapshot.unavailableUpperBoundMs,
      backup,
      record,
    }),
  );
}
