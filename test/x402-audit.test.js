import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHostedHandler } from '../api/x402.js';
import { HEADERS, NETWORK, ROUTES, b64, createPayment, requirementsFor, parseConfig } from '../lib/x402.js';
import { selectorOf } from '../lib/keccak.js';

const config = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const requirements = requirementsFor(parseConfig(config), ROUTES.find(route => route.path === '/data'));
const privateKey = '0x' + '11'.repeat(32);
const invoke = async (handler, { path = 'data', scope = 'resource', method = 'GET', headers = {}, body } = {}) => {
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, url: `/api/x402?scope=${scope}&path=${encodeURIComponent(path)}`, headers: { host: 'example.test', ...headers }, body }, response);
  return response;
};
const payment = () => createPayment({ requirements, privateKey });

test('hosted functions ignore settlement keys and stay verify-only without a dedicated facilitator URL', async () => {
  const previousKey = process.env.FACILITATOR_PRIVATE_KEY;
  process.env.FACILITATOR_PRIVATE_KEY = '0x' + '22'.repeat(32);
  try {
    const calls = [];
    const rpcImpl = async (method, params) => {
      calls.push(method);
      assert.equal(method, 'eth_call', 'hosted keyless mode must never submit a transaction');
      return params[0].data.startsWith(selectorOf('balanceOf(address)')) ? '0x100000' : '0x0';
    };
    const handler = createHostedHandler({ facilitatorUrl: null, rpcImpl });
    const supported = await invoke(handler, { path: 'supported', scope: 'facilitator' });
    assert.equal(supported.statusCode, 200);
    assert.equal(supported.body.settles, false);
    assert.deepEqual(supported.body.signers['eip155:*'], []);
    const out = await invoke(handler, { headers: { 'payment-signature': b64.enc(payment()) } });
    assert.equal(out.statusCode, 503);
    assert.match(out.body.error, /nothing was charged/);
    assert.ok(calls.length > 0);
    assert.equal(out.headers[HEADERS.required], undefined);
  } finally {
    if (previousKey === undefined) delete process.env.FACILITATOR_PRIVATE_KEY;
    else process.env.FACILITATOR_PRIVATE_KEY = previousKey;
  }
});

test('hosted resource routes use the dedicated facilitator and proxy asynchronous supported metadata', async () => {
  const calls = [];
  const settlement = { success: true, payer: config.payer, transaction: '0x' + 'ab'.repeat(32), network: NETWORK };
  const metadata = { settles: true, kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }] };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const payload = url.endsWith('/supported') ? metadata : url.endsWith('/verify') ? { isValid: true } : settlement;
    return { status: 200, json: async () => payload };
  };
  const handler = createHostedHandler({ facilitatorUrl: 'https://single-writer.example/', fetchImpl, rpcImpl: () => { throw new Error('local RPC should not be used'); } });
  const supported = await invoke(handler, { path: 'supported', scope: 'facilitator' });
  assert.deepEqual(supported.body, metadata);
  const out = await invoke(handler, { headers: { 'payment-signature': b64.enc(payment()) } });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(b64.dec(out.headers[HEADERS.response]), settlement);
  assert.deepEqual(calls.map(c => c.url), ['https://single-writer.example/supported', 'https://single-writer.example/verify', 'https://single-writer.example/settle']);
  assert.ok(calls.every(c => c.init.redirect === 'error'));
});

test('hosted facilitator protocol endpoints proxy verify and settle without loading local keys', async () => {
  const seen = [];
  const handler = createHostedHandler({ facilitatorUrl: 'https://single-writer.example', fetchImpl: async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ success: false, errorReason: 'test_not_submitted' }) }; } });
  for (const path of ['verify', 'settle']) {
    const out = await invoke(handler, { path, scope: 'facilitator', method: 'POST', body: { paymentPayload: payment(), paymentRequirements: requirements } });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.errorReason, 'test_not_submitted');
  }
  assert.deepEqual(seen.map(c => c.url), ['https://single-writer.example/verify', 'https://single-writer.example/settle']);
  assert.ok(seen.every(c => c.body.paymentRequirements.asset === config.asset));
});

test('client CLI rejects a missing --max value before loading a key or making a request', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('../agents/x402-paywalled-api/client.js', import.meta.url)), 'http://127.0.0.1:1/data', '--max'], { encoding: 'utf8', env: { ...process.env, EVM_PRIVATE_KEY: '', EVM_PRIVATE_KEY_FILE: '/missing-x402-audit-key' } });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /max.*(?:argument|value).*missing|missing.*max/i);
  assert.doesNotMatch(out.stderr, /could not read the key file/);
});
