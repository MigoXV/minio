import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proof, Router, plan } from './router.mjs';

test('SCRAM agrees with the firmware implementation for a synthetic challenge', () => {
  const first = '01'.repeat(32);
  const result = proof('example-password', first, { servernonce: first + '02'.repeat(32), salt: 'ab'.repeat(16), iterations: 1000 });
  assert.equal(result.clientproof, 'ab428405b616c584638c5a9c1a83085dcac65b87fea2dd50364e5b4ce45db5f5');
  assert.equal(result.serverproof, '81edbfce33a3703e46427ca81f683fb7761080fb5347f83955c24c7ce48c172b');
  assert.throws(() => proof('example-password', first, { servernonce: 'wrong', salt: 'ab', iterations: 1000 }));
});

test('an authentication rejection stops without retries', async () => {
  const router = new Router({ baseUrl: 'http://192.0.2.1', password: 'example-password' });
  const calls = [];
  router.request = async route => { calls.push(route); return { err: 1 }; };
  await assert.rejects(() => router.login(), /no retry/);
  assert.deepEqual(calls, ['/html/index.html', '/api/system/user_login_nonce']);
});

const network = { address: '192.0.2.4', mac: '02:00:00:00:00:04' };
const config = { reserveAddress: true, mappings: [{ name: 'example', externalPort: 8443, internalPort: 8443 }] };
function snapshot() {
  return { hosts: [{ IPAddress: network.address, MACAddress: network.mac, HostName: 'example-host' }],
    mappings: [], apps: [], items: {}, reservations: [], upnpMappings: [] };
}

test('a matching existing mapping is reused and drift is rejected', () => {
  const state = snapshot();
  assert.equal(plan(config, network, state).mappings[0].operation, 'create');
  state.apps.push({ ID: 'app-1', Name: 'example_pm' });
  state.mappings.push({ ID: 'mapping-1', ApplicationID: 'app-1', Name: 'example', Enable: true,
    InternalHost: network.mac, HostIPAddress: network.address });
  state.items['app-1'] = [{ Protocol: 'TCP', ExternalPort: '8443', ExternalPortEnd: '8443', InternalPort: '8443', InternalPortEnd: '8443' }];
  assert.equal(plan(config, network, state).mappings[0].operation, 'keep');
  state.items['app-1'][0].InternalPort = '22';
  assert.throws(() => plan(config, network, state), /differs/);
});

test('pre-existing port ranges and address reservations are protected', () => {
  const state = snapshot();
  state.mappings.push({ Name: 'another-rule', Enable: true, ApplicationID: 'app-other' });
  state.items['app-other'] = [{ Protocol: 'TCP/UDP', ExternalPort: '8400', ExternalPortEnd: '8500' }];
  assert.throws(() => plan(config, network, state), /already used/);
  state.mappings = [];
  state.reservations.push({ Chaddr: '02:00:00:00:00:05', Yiaddr: network.address });
  assert.throws(() => plan(config, network, state), /another device/);
});

test('forwarding cannot target an IP/MAC absent from the current host table', () => {
  const state = snapshot();
  state.hosts = [];
  assert.throws(() => plan(config, network, state), /IP\/MAC/);
});
