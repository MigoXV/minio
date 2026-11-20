#!/usr/bin/env node
// Device-specific Huawei SCRAM and application/port-mapping API client. Node >= 22.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function discover() {
  const routes = JSON.parse(execFileSync('ip', ['-j', 'route', 'show', 'default'], { encoding: 'utf8' }));
  const active = routes.filter(r => r.gateway && os.networkInterfaces()[r.dev]);
  active.sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0));
  const route = active.find(r => fs.existsSync(`/sys/class/net/${r.dev}/wireless`)) ?? active[0];
  if (!route) throw new Error('No active default gateway');
  const iface = os.networkInterfaces()[route.dev].find(a => a.family === 'IPv4');
  if (!iface) throw new Error('The default interface has no IPv4 address');
  return { gateway: route.gateway, interface: route.dev, address: iface.address, mac: iface.mac.toUpperCase() };
}

// This firmware reverses the conventional HMAC key/message order in HmacSHA2.
export function proof(password, firstNonce, nonce) {
  if (!Number.isInteger(nonce.iterations) || nonce.iterations < 1 || nonce.iterations > 1000000 ||
      typeof nonce.servernonce !== 'string' || !nonce.servernonce.startsWith(firstNonce) ||
      !/^(?:[a-f\d]{2})+$/i.test(nonce.salt)) throw new Error('Invalid SCRAM challenge');
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const salted = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(nonce.salt, 'hex'), nonce.iterations, 32, 'sha256');
  const clientKey = hmac('Client Key', salted);
  const serverKey = hmac('Server Key', salted);
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const auth = `${firstNonce},${nonce.servernonce},${nonce.servernonce}`;
  const signature = hmac(auth, storedKey);
  return {
    clientproof: Buffer.from(clientKey.map((b, i) => b ^ signature[i])).toString('hex'),
    serverproof: hmac(auth, serverKey).toString('hex'),
    verifyRSA: hex => hmac(serverKey, Buffer.from(hex, 'hex')).toString('hex'),
  };
}

export class Router {
  constructor(config) {
    this.config = config;
    this.base = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password ||
        this.base.pathname !== '/' || this.base.search || this.base.hash) throw new Error('baseUrl must be a router origin');
    this.cookies = new Map();
    this.csrf = {};
  }

  async request(route, data) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid API path');
    const r = await fetch(new URL(route, this.base), {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: {
        Accept: 'application/json', Referer: `${this.base.origin}/html/index.html`,
        'Content-Type': 'application/json; charset=UTF-8',
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      ...(data === undefined ? {} : { body: JSON.stringify({ ...data, csrf: this.csrf }) }),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], sep = pair.indexOf('=');
      if (sep > 0) this.cookies.set(pair.slice(0, sep), pair.slice(sep + 1));
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`Router ${route.split('?')[0]} returned HTTP ${r.status}`);
    if (route === '/html/index.html') {
      for (const key of ['csrf_param', 'csrf_token']) {
        const value = text.match(new RegExp(`<meta name="${key}" content="([^"]+)"`))?.[1];
        if (!value) throw new Error('Router CSRF metadata missing');
        this.csrf[key] = value;
      }
      return;
    }
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('Router returned invalid JSON'); }
    if (result.csrf_param && result.csrf_token) this.csrf = { csrf_param: result.csrf_param, csrf_token: result.csrf_token };
    return result;
  }

  async login() {
    await this.request('/html/index.html');
    const firstNonce = crypto.randomBytes(32).toString('hex');
    const nonce = await this.request('/api/system/user_login_nonce', {
      data: { username: this.config.username ?? 'admin', firstnonce: firstNonce },
    });
    if (nonce.err !== 0) throw new Error(`SCRAM challenge rejected (err=${nonce.err ?? nonce.errcode}); no retry`);
    const p = proof(this.config.password, firstNonce, nonce);
    const result = await this.request('/api/system/user_login_proof', {
      data: { clientproof: p.clientproof, finalnonce: nonce.servernonce },
    });
    if (result.err !== 0) throw new Error(`Router login rejected (err=${result.err ?? result.errcode}); no retry`);
    if (result.serversignature !== p.serverproof || !result.rsan || result.rsapubkeysignature !== p.verifyRSA(result.rsan)) {
      throw new Error('Router server proof verification failed');
    }
    this.device = await this.request('/api/system/deviceinfo');
    if (this.device.custinfo?.CustDeviceName !== 'YGJN-BE30-10') throw new Error('Unsupported router model; stop and inspect its UI');
    if (this.config.deviceId && this.device.uuid !== this.config.deviceId) throw new Error('Router identity differs from local deviceId');
  }

  async get(name, query = '') {
    const routes = { wan: 'ntwk/wan', mappings: 'ntwk/portmapping', apps: 'app/application',
      items: 'app/applicationitems', hosts: 'system/HostInfo', reservations: 'ntwk/lan_ipaddressreserve',
      upnp: 'ntwk/lan_upnp', upnpMappings: 'ntwk/lan_upnp_portmapping' };
    if (!routes[name]) throw new Error('Unsupported read operation');
    return this.request(`/api/${routes[name]}${query}`);
  }

  async mutate(name, action, data) {
    const routes = { mappings: 'ntwk/portmapping', apps: 'app/application', items: 'app/applicationitems',
      reservations: 'ntwk/lan_ipaddressreserve' };
    if (!routes[name] || !['create', 'delete'].includes(action)) throw new Error('Unsupported router mutation');
    const result = await this.request(`/api/${routes[name]}`, { data, action });
    if (result.errcode !== 0) throw new Error(`Router rejected ${name}/${action} (errcode=${result.errcode ?? result.err})`);
    return result;
  }

  async snapshot() {
    // Sequential requests preserve rotating CSRF/session state on this firmware.
    const out = {};
    for (const name of ['wan', 'mappings', 'apps', 'hosts', 'reservations', 'upnp', 'upnpMappings']) out[name] = await this.get(name);
    out.items = {};
    for (const app of out.apps) out.items[app.ID] = await this.get('items', `?ID=${encodeURIComponent(app.ID)}`);
    return out;
  }
}

function validateMappings(config) {
  if (!Array.isArray(config.mappings) || !config.mappings.length) throw new Error('No mappings specified');
  const names = new Set(), ports = new Set();
  for (const r of config.mappings) {
    if (!/^[a-zA-Z0-9_-]{1,28}$/.test(r.name) || names.has(r.name)) throw new Error('Mapping names must be unique and 1-28 simple characters');
    for (const port of [r.externalPort, r.internalPort]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TCP port');
    }
    if (ports.has(r.externalPort)) throw new Error('External TCP ports must be unique');
    names.add(r.name); ports.add(r.externalPort);
  }
}

export function plan(config, network, snapshot) {
  validateMappings(config);
  const host = snapshot.hosts.find(h => h.MACAddress.toUpperCase() === network.mac && h.IPAddress === network.address);
  if (!host) throw new Error('Local IP/MAC pair does not match the router host table');
  const desired = config.mappings.map(r => {
    const existing = snapshot.mappings.find(m => m.Name === r.name);
    const app = snapshot.apps.find(a => a.Name === `${r.name}_pm`);
    if (existing) {
      const items = snapshot.items[existing.ApplicationID] ?? [];
      const item = items[0];
      if (!existing.Enable || existing.InternalHost.toUpperCase() !== network.mac || existing.HostIPAddress !== network.address ||
          items.length !== 1 || item?.Protocol !== 'TCP' || Number(item.ExternalPort) !== r.externalPort ||
          Number(item.ExternalPortEnd) !== r.externalPort || Number(item.InternalPort) !== r.internalPort ||
          Number(item.InternalPortEnd) !== r.internalPort || existing.ApplicationID !== app?.ID) {
        throw new Error(`Existing mapping ${r.name} differs; inspect it instead of overwriting`);
      }
    } else if (app) {
      throw new Error(`Application ${r.name}_pm exists without the expected mapping; inspect before retrying`);
    }
    for (const mapping of snapshot.mappings.filter(m => m.Enable && m.Name !== r.name)) {
      for (const item of snapshot.items[mapping.ApplicationID] ?? []) {
        if (item.Protocol.includes('TCP') && r.externalPort >= Number(item.ExternalPort) && r.externalPort <= Number(item.ExternalPortEnd)) {
          throw new Error(`TCP port ${r.externalPort} is already used by ${mapping.Name}`);
        }
      }
    }
    for (const u of snapshot.upnpMappings) {
      if (u.enable && u.protocol === 'TCP' && Number(u.externalport) === r.externalPort) throw new Error('TCP port is already mapped by UPnP');
    }
    return { ...r, operation: existing ? 'keep' : 'create', hostName: host.ActualName || host.HostName || '', hostIP: network.address, mac: network.mac };
  });
  const reservation = snapshot.reservations.find(r => r.Chaddr.toUpperCase() === network.mac);
  if (reservation && (!reservation.Enable || reservation.Yiaddr !== network.address)) throw new Error('Existing address reservation differs');
  if (snapshot.reservations.some(r => r.Yiaddr === network.address && r.Chaddr.toUpperCase() !== network.mac)) throw new Error('IP is reserved by another device');
  return { mappings: desired, reservation: config.reserveAddress ? (reservation ? 'keep' : 'create') : 'skip' };
}

function writePrivate(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`); } finally { fs.closeSync(fd); }
}

async function removeCreated(router, created) {
  for (const record of [...created].reverse()) {
    if (record.kind === 'reservation') await router.mutate('reservations', 'delete', record.data);
    if (record.kind === 'mapping') await router.mutate('mappings', 'delete', record.data);
    if (record.kind === 'app') {
      const items = await router.get('items', `?ID=${encodeURIComponent(record.data.ID)}`);
      for (const item of items) await router.mutate('items', 'delete', item);
      await router.mutate('apps', 'delete', record.data);
    }
  }
}

async function apply(router, config, network, before, changes, recordPath) {
  if (!config.deviceId) throw new Error('Mutation requires the locally recorded deviceId');
  const created = [];
  // The journal contains only resources from this execution; existing rules are never deleted.
  const journal = () => fs.writeFileSync(recordPath, `${JSON.stringify({ created }, null, 2)}\n`, { mode: 0o600 });
  writePrivate(recordPath, { created });
  try {
    for (const r of changes.mappings.filter(r => r.operation === 'create')) {
      const nextIndex = (await router.get('apps')).length + 1;
      await router.mutate('apps', 'create', { ID: '', Name: `${r.name}_pm`, ObjAcc: 65535,
        EnablePortmapping: true, EnablePorttrigger: false, EnableQos: false, EnableFilter: false,
        ItemList: [{ ID: '', Protocol: 'TCP', ExternalPort: String(r.externalPort), ExternalPortEnd: String(r.externalPort),
          InternalPort: String(r.internalPort), InternalPortEnd: String(r.internalPort), index: nextIndex }],
      });
      const app = (await router.get('apps')).find(a => a.Name === `${r.name}_pm`);
      if (!app) throw new Error('Application creation could not be verified; inspect the pre-change snapshot');
      created.push({ kind: 'app', data: app }); journal();
      await router.mutate('mappings', 'create', { ID: '', ApplicationID: app.ID, Name: r.name, Enable: true,
        HostName: r.hostName, HostIPAddress: r.hostIP, InternalHost: r.mac });
      const mapping = (await router.get('mappings')).find(m => m.Name === r.name);
      if (!mapping) throw new Error('Mapping creation could not be verified');
      created.push({ kind: 'mapping', data: mapping }); journal();
    }
    if (changes.reservation === 'create') {
      await router.mutate('reservations', 'create', { ID: '', Enable: true, Chaddr: network.mac, Yiaddr: network.address });
      const reservation = (await router.get('reservations')).find(r => r.Chaddr.toUpperCase() === network.mac);
      if (!reservation) throw new Error('Address reservation creation could not be verified');
      created.push({ kind: 'reservation', data: reservation }); journal();
    }
    const after = await router.snapshot();
    const verified = plan(config, network, after);
    if (verified.mappings.some(r => r.operation !== 'keep') || verified.reservation === 'create') throw new Error('Post-change verification failed');
    for (const existing of before.mappings) {
      if (JSON.stringify(after.mappings.find(m => m.ID === existing.ID)) !== JSON.stringify(existing)) throw new Error('An existing mapping unexpectedly changed');
    }
    return { changes: verified, journal: recordPath };
  } catch (error) {
    try { await removeCreated(router, created); } catch { throw new Error(`${error.message}; rollback incomplete, inspect journal ${recordPath}`); }
    throw new Error(`${error.message}; resources recorded by this execution were rolled back`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'discover') { console.log(JSON.stringify(discover(), null, 2)); return; }
  if (!['status', 'plan', 'apply'].includes(command) || args[0] !== '--config' || !args[1] || args.length !== 2) {
    throw new Error('Usage: router.mjs discover | status|plan|apply --config <private-config.json>');
  }
  const filename = path.resolve(args[1]);
  if ((fs.statSync(filename).mode & 0o077) !== 0) throw new Error('Configuration must have mode 0600');
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const network = discover();
  if (new URL(config.baseUrl).hostname !== network.gateway) throw new Error('Configured router is not the current default gateway');
  const router = new Router(config);
  await router.login();
  const before = await router.snapshot();
  if (command === 'status') {
    const wan = before.wan.find(w => w.IsDefault && w.Enable);
    console.log(JSON.stringify({ model: router.device.custinfo.CustZHFriendlyName, deviceId: router.device.uuid,
      network, wan: { address: wan?.IPv4Addr, gateway: wan?.IPv4Gateway, connection: wan?.ConnectionStatus,
        natTypeRaw: wan?.NATType, ipv6: wan?.IPv6ConnectionStatus }, mappings: before.mappings, reservations: before.reservations }, null, 2));
    return;
  }
  const changes = plan(config, network, before);
  if (command === 'plan') { console.log(JSON.stringify(changes, null, 2)); return; }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  writePrivate(path.join(path.dirname(filename), `router-before-${stamp}.json`), before);
  const result = await apply(router, config, network, before, changes,
    path.join(path.dirname(filename), `router-created-${stamp}.json`));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
