import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEADERS, INVALID, NETWORK, ROUTES, authorizationDigest, b64, createFacilitator, createPayment, createResourceServer, domainSeparator, facilitatorHandler, httpFacilitator, loadPrivateKey, parseConfig, payAndFetch, priceToAmount, requirementsFor } from '../lib/x402.js';
import { addressFromPrivateKey, recoverAddress } from '../lib/secp256k1.js';
import { selectorOf, keccak256 } from '../lib/keccak.js';
import { unsignedLegacyTx } from '../lib/rlp.js';
import { UserError } from '../lib/snapshot.js';

const PAYER_KEY = '0x' + '11'.repeat(32);
const FAC_KEY = '0x' + '22'.repeat(32);
const OTHER_KEY = '0x' + '33'.repeat(32);
const PAYER = addressFromPrivateKey(PAYER_KEY);
const FACILITATOR = addressFromPrivateKey(FAC_KEY);
const TOKEN = '0xa952d7f3dc17da87a71d1e33958139bcd5565eef';
const PAY_TO = '0x262927e3f2e3ad7824aa708cdf39106084988b13';
const CONFIG = { asset: TOKEN, payTo: PAY_TO, name: 'USDC', version: '2', decimals: 6 };
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const SEL = { balanceOf: selectorOf('balanceOf(address)'), state: selectorOf('authorizationState(address,bytes32)'), twa: selectorOf('transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)') };
const NOW = 1_790_000_000;

// An EIP-3009 token on a fake Atlantic, behaving as contracts/TestUSDC.sol does; transactions are decoded from the raw bytes the facilitator sends.
function atlantic({ balance = 1_000_000n, now = NOW, refuse = null } = {}) {
  const st = { balances: { [PAYER]: balance, [PAY_TO]: 0n }, used: new Set(), sent: [], nonceOf: 4 };
  const realDomain = { name: 'USDC', version: '2', chainId: 688689, verifyingContract: TOKEN };
  function transfer(data, who) {
    const a = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'].reduce((o, k, i) => ({ ...o, [k]: '0x' + data.slice(10 + i * 64, 10 + (i + 1) * 64) }), {});
    const f = '0x' + a.from.slice(26); const t = '0x' + a.to.slice(26);
    const auth = { from: f, to: t, value: BigInt(a.value).toString(), validAfter: BigInt(a.validAfter).toString(), validBefore: BigInt(a.validBefore).toString(), nonce: a.nonce };
    const v = parseInt(data.slice(10 + 6 * 64, 10 + 7 * 64), 16);
    const r = BigInt('0x' + data.slice(10 + 7 * 64, 10 + 8 * 64));
    const s = BigInt('0x' + data.slice(10 + 8 * 64, 10 + 9 * 64));
    if (refuse) throw Object.assign(new Error(refuse), { rpc: { message: refuse } });
    if (!(now > Number(auth.validAfter))) throw new Error('authorization is not yet valid');
    if (!(now < Number(auth.validBefore))) throw new Error('authorization is expired');
    if (st.used.has(`${f}:${auth.nonce}`)) throw new Error('authorization is used');
    if (recoverAddress(authorizationDigest(realDomain, auth), { r, s, recoveryId: v - 27 }) !== f) throw new Error('invalid signature');
    if ((st.balances[f] ?? 0n) < BigInt(auth.value)) throw new Error('transfer amount exceeds balance');
    if (who === 'send') { st.used.add(`${f}:${auth.nonce}`); st.balances[f] -= BigInt(auth.value); st.balances[t] = (st.balances[t] ?? 0n) + BigInt(auth.value); }
    return '0x';
  }
  const rpc = async (method, params) => {
    if (method === 'eth_call') {
      const tx = params[0];
      if (tx.data.startsWith(SEL.balanceOf)) return '0x' + word(st.balances['0x' + tx.data.slice(34)] ?? 0n);
      if (tx.data.startsWith(SEL.state)) return '0x' + word(st.used.has(`0x${tx.data.slice(34, 74)}:0x${tx.data.slice(74)}`) ? 1 : 0);
      if (tx.data.startsWith(SEL.twa)) return transfer(tx.data, 'call');
      throw new Error('unexpected eth_call');
    }
    if (method === 'eth_getTransactionCount') return '0x' + st.nonceOf.toString(16);
    if (method === 'eth_gasPrice') return '0x' + (10n ** 9n).toString(16);
    if (method === 'eth_estimateGas') return '0x' + (60_000).toString(16);
    if (method === 'eth_sendRawTransaction') {
      const raw = Buffer.from(params[0].slice(2), 'hex');
      st.sent.push(raw);
      const decoded = decodeLegacy(raw);
      if (decoded.to !== TOKEN) throw new Error('sent to the wrong contract');
      transfer(decoded.data, 'send');
      st.sender = decoded.sender;
      st.lastTx = decoded;
      const hash = '0x' + keccak256(raw);
      st.receipts = { ...(st.receipts ?? {}), [hash]: { status: '0x1', blockNumber: '0x10', gasUsed: '0xea60' } };
      return hash;
    }
    if (method === 'eth_getTransactionReceipt') return st.receipts?.[params[0]] ?? null;
    throw new Error(`unexpected ${method}`);
  };
  return { st, rpc };
}
// enough RLP to read the nine fields of a legacy transaction back out
function decodeLegacy(buf) {
  let i = 0;
  const readItem = () => {
    const b = buf[i];
    if (b < 0x80) { i += 1; return buf.subarray(i - 1, i); }
    if (b < 0xb8) { const len = b - 0x80; i += 1 + len; return buf.subarray(i - len, i); }
    if (b < 0xc0) { const ll = b - 0xb7; const len = Number(BigInt('0x' + buf.subarray(i + 1, i + 1 + ll).toString('hex'))); i += 1 + ll + len; return buf.subarray(i - len, i); }
    throw new Error('list inside a list');
  };
  const head = buf[0];
  i = head < 0xf8 ? 1 : 1 + (head - 0xf7);
  const f = Array.from({ length: 9 }, readItem);
  const big = (b) => BigInt('0x' + (b.toString('hex') || '0'));
  const [nonce, gasPrice, gasLimit, to, value, data, v, r, s] = f;
  const fields = { nonce: big(nonce), gasPrice: big(gasPrice), gasLimit: big(gasLimit), to: '0x' + to.toString('hex'), value: big(value), data: '0x' + data.toString('hex'), chainId: (big(v) - 35n) / 2n };
  const hash = unsignedLegacyTx(fields).signingHash;
  const sender = recoverAddress(hash, { r: big(r), s: big(s), recoveryId: Number((big(v) - 35n) % 2n) });
  return { ...fields, sender, chainIdOk: fields.chainId === 688689n };
}
const route = (path) => ROUTES.find((r) => r.path === path);
const req = (path) => requirementsFor(parseConfig(CONFIG), route(path));
const pay = (path, o = {}) => createPayment({ requirements: req(path), privateKey: PAYER_KEY, now: NOW, ...o });
const facilitatorOn = (chain, key = FAC_KEY) => createFacilitator({ rpc: chain.rpc, key, now: () => NOW, pollMs: 1, receiptTimeoutMs: 200 });

// ---- prices, requirements, EIP-712 ----------------------------------------------------------------------------------------------------
test('prices are exact decimals in the token’s base units; the requirements say exactly what is wanted', () => {
  assert.equal(priceToAmount('0.01', 6), '10000');
  assert.equal(priceToAmount('$0.005', 6), '5000');
  assert.equal(priceToAmount('1', 6), '1000000');
  assert.throws(() => priceToAmount('0.0000001', 6), /more decimals than the token/);
  assert.throws(() => priceToAmount('free', 6), /decimal like 0\.01/);
  assert.deepEqual(req('/data'), { scheme: 'exact', network: 'eip155:688689', amount: '10000', asset: TOKEN, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } });
  assert.equal(req('/api/info').amount, '5000');
});

test('two paid routes at different prices and one free route', () => {
  assert.deepEqual(ROUTES.map((r) => [r.path, r.price]), [['/health', null], ['/api/info', '0.005'], ['/data', '0.01']]);
  assert.equal(new Set(ROUTES.filter((r) => r.price).map((r) => r.price)).size, 2);
});

test('the config is checked: addresses, checksums', () => {
  assert.throws(() => parseConfig({ ...CONFIG, asset: '0x12' }), /config\.asset/);
  assert.throws(() => parseConfig({ ...CONFIG, payTo: '0x12' }), /config\.payTo/);
  assert.throws(() => parseConfig({ ...CONFIG, payTo: '0x262927e3f2e3AD7824aa708CdF39106084988B13'.replace('AD', 'ad') }), /checksum/);
  assert.equal(parseConfig(CONFIG).network, NETWORK);
});

test('EIP-712: the domain separator equals the one the deployed token reports on Atlantic', () => {
  const deployed = '0xa952d7f3dc17da87a71d1e33958139bcd5565eef';
  assert.equal(domainSeparator({ name: 'USDC', version: '2', chainId: 688689, verifyingContract: deployed }), '0xaa2f3025f91e99bc1c2465d1f62fb18d619919e9f47de3746081df8896751c47');
});

// ---- the client ---------------------------------------------------------------------------------------------------------------------------
test('a payment is an EIP-3009 authorization for exactly the price, signed by the payer, valid for the requirement’s window', () => {
  const p = pay('/data');
  const a = p.payload.authorization;
  assert.equal(p.x402Version, 2);
  assert.deepEqual([a.from, a.to, a.value], [PAYER, PAY_TO, '10000']);
  assert.equal(Number(a.validBefore) - NOW, 300);
  assert.ok(Number(a.validAfter) < NOW);
  assert.match(a.nonce, /^0x[0-9a-f]{64}$/);
  const sig = p.payload.signature;
  const digest = authorizationDigest({ name: 'USDC', version: '2', chainId: 688689, verifyingContract: TOKEN }, a);
  assert.equal(recoverAddress(digest, { r: BigInt('0x' + sig.slice(2, 66)), s: BigInt('0x' + sig.slice(66, 130)), recoveryId: parseInt(sig.slice(130), 16) - 27 }), PAYER);
  assert.notEqual(pay('/data').payload.authorization.nonce, pay('/data').payload.authorization.nonce, 'a fresh nonce each time');
});

// ---- the facilitator -----------------------------------------------------------------------------------------------------------------------
test('/supported names the scheme, the network and the key that settles', () => {
  const f = facilitatorOn(atlantic());
  assert.deepEqual(f.supported().kinds, [{ x402Version: 2, scheme: 'exact', network: 'eip155:688689' }]);
  assert.deepEqual(f.supported().signers, { 'eip155:*': [FACILITATOR] });
  assert.equal(f.supported().settles, true);
  assert.equal(createFacilitator({ rpc: atlantic().rpc }).supported().settles, false);
});

test('/verify accepts a good payment and gives every refusal a reason', async () => {
  const f = facilitatorOn(atlantic());
  assert.deepEqual(await f.verify(pay('/data'), req('/data')), { isValid: true, payer: PAYER });
  const why = async (payment, requirements = req('/data')) => (await f.verify(payment, requirements)).invalidReason;
  const forged = (o) => { const p = pay('/data'); p.payload.authorization = { ...p.payload.authorization, ...o }; return p; };
  assert.equal(await why(forged({ value: '5000' })), INVALID.value, 'underpaid');
  assert.equal(await why(forged({ value: '20000' })), INVALID.value, 'overpaid is not exact either');
  assert.equal(await why(forged({ to: '0x000000000000000000000000000000000000dead' })), INVALID.recipient);
  assert.equal(await why(pay('/data', { now: NOW - 1000 })), INVALID.validBefore, 'expired');
  assert.equal(await why(forged({ validAfter: String(NOW + 100) })), INVALID.validAfter);
  assert.equal(await why(forged({ from: addressFromPrivateKey(OTHER_KEY) })), INVALID.signature, 'someone else’s name on it');
  assert.equal(await why(createPayment({ requirements: { ...req('/data'), extra: { name: 'USDC', version: '3' } }, privateKey: PAYER_KEY, now: NOW })), INVALID.signature, 'signed for another domain');
  assert.equal(await why(pay('/api/info')), INVALID.mismatch, 'a payment for the cheaper route');
  assert.equal(await why({ ...pay('/data'), x402Version: 1 }), INVALID.version);
  assert.equal(await why({ ...pay('/data'), accepted: { ...req('/data'), scheme: 'upto' } }), INVALID.scheme);
  assert.equal(await why({ ...pay('/data'), accepted: { ...req('/data'), network: 'eip155:1' } }, { ...req('/data'), network: 'eip155:1' }), INVALID.network);
  assert.equal(await why({ x402Version: 2 }), INVALID.malformed);
  const tampered = pay('/data');
  tampered.payload.signature = tampered.payload.signature.slice(0, -2) + (tampered.payload.signature.endsWith('1b') ? '1c' : '1b');
  assert.equal(await why(tampered), INVALID.signature);
  const poor = createPayment({ requirements: req('/data'), privateKey: OTHER_KEY, now: NOW });
  assert.equal(await why(poor), INVALID.balance);
});

test('a payment the token contract would refuse is not valid, whatever the facilitator thinks of its form', async () => {
  const f = facilitatorOn(atlantic({ refuse: 'the token is paused' }));
  const v = await f.verify(pay('/data'), req('/data'));
  assert.equal(v.invalidReason, INVALID.simulation);
  assert.match(v.invalidMessage, /the token is paused/);
});

test('/settle sends one transaction to the token, signed by the facilitator’s own key on chain 688689, and moves exactly the price', async () => {
  const A = atlantic();
  const f = facilitatorOn(A);
  const s = await f.settle(pay('/data'), req('/data'));
  assert.equal(s.success, true);
  assert.equal(s.payer, PAYER);
  assert.match(s.transaction, /^0x[0-9a-f]{64}$/);
  assert.equal(A.st.sent.length, 1);
  assert.equal(A.st.sender, FACILITATOR, 'the facilitator sends it, so it pays the gas; the payer only signed');
  assert.notEqual(A.st.sender, PAYER);
  assert.equal(A.st.lastTx.chainIdOk, true);
  assert.equal(A.st.lastTx.nonce, 4n);
  assert.equal(A.st.lastTx.value, 0n);
  assert.equal(A.st.lastTx.gasLimit, 78_000n, 'estimate plus 30%');
  assert.deepEqual([A.st.balances[PAYER], A.st.balances[PAY_TO]], [990_000n, 10_000n]);
});

test('a settled payment cannot be settled again: the token’s own nonce says so', async () => {
  const A = atlantic();
  const f = facilitatorOn(A);
  const p = pay('/data');
  assert.equal((await f.settle(p, req('/data'))).success, true);
  const again = await f.settle(p, req('/data'));
  assert.equal(again.success, false);
  assert.equal(again.errorReason, INVALID.nonce);
  assert.equal(A.st.sent.length, 1, 'nothing was sent the second time');
});

test('a facilitator with no key can verify but never settle, and says so', async () => {
  const f = createFacilitator({ rpc: atlantic().rpc, now: () => NOW });
  assert.equal((await f.verify(pay('/data'), req('/data'))).isValid, true);
  const s = await f.settle(pay('/data'), req('/data'));
  assert.deepEqual([s.success, s.errorReason], [false, 'facilitator_cannot_settle']);
});

test('a settlement that never gets a receipt is reported as a timeout, with the hash, not as a failure to pay', async () => {
  const A = atlantic();
  const rpc = async (m, p) => (m === 'eth_getTransactionReceipt' ? null : A.rpc(m, p));
  const s = await createFacilitator({ rpc, key: FAC_KEY, now: () => NOW, pollMs: 1, receiptTimeoutMs: 20 }).settle(pay('/data'), req('/data'));
  assert.equal(s.success, false);
  assert.equal(s.errorReason, 'settlement_timeout');
  assert.match(s.transaction, /^0x[0-9a-f]{64}$/);
  assert.match(s.errorMessage, /do not retry until you have looked at it/);
});

test('the facilitator’s HTTP routes: GET /supported, POST /verify, POST /settle, and a clear answer to anything else', async () => {
  const f = facilitatorOn(atlantic());
  assert.equal((await facilitatorHandler(f, { method: 'GET', path: '/supported' })).body.kinds[0].scheme, 'exact');
  const v = await facilitatorHandler(f, { method: 'POST', path: '/verify', body: { paymentPayload: pay('/data'), paymentRequirements: req('/data') } });
  assert.deepEqual([v.status, v.body.isValid], [200, true]);
  assert.equal((await facilitatorHandler(f, { method: 'POST', path: '/verify', body: {} })).status, 400);
  assert.equal((await facilitatorHandler(f, { method: 'GET', path: '/verify' })).status, 404);
});

// ---- the resource server and the client, end to end -------------------------------------------------------------------------------------
function stack({ key = FAC_KEY, balance } = {}) {
  const A = atlantic({ balance });
  const facilitator = createFacilitator({ rpc: A.rpc, key, now: () => NOW, pollMs: 1, receiptTimeoutMs: 200 });
  const server = createResourceServer({ config: CONFIG, facilitator, handlers: { '/health': () => ({ status: 'ok' }), '/data': () => ({ message: 'Hello, paid user!' }), '/api/info': () => ({ name: 'demo' }) } });
  // a fetch that talks to the in-process server, like the real thing over HTTP
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const out = await server.handle({ method: init.method ?? 'GET', path: u.pathname, headers, baseUrl: u.origin });
    return { status: out.status, headers: new Map(Object.entries(out.headers).map(([k, v]) => [k, v])) , json: async () => out.body };
  };
  const headersGet = (res) => ({ ...res, headers: { get: (k) => res.headers.get(k) ?? res.headers.get(k.toLowerCase()) ?? null } });
  return { A, facilitator, server, fetchImpl: async (u, i) => headersGet(await fetchImpl(u, i)) };
}

test('free route: 200 with no payment; unknown route: 404 listing the routes', async () => {
  const { server } = stack();
  assert.deepEqual((await server.handle({ path: '/health' })).body, { status: 'ok' });
  const nf = await server.handle({ path: '/nothing' });
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body.routes, ['GET /health (free)', 'GET /api/info ($0.005)', 'GET /data ($0.01)']);
});

test('a paid route without a payment is a 402 whose PAYMENT-REQUIRED header and body carry the requirements', async () => {
  const { server } = stack();
  const r = await server.handle({ path: '/data', baseUrl: 'https://x.example' });
  assert.equal(r.status, 402);
  const header = b64.dec(r.headers[HEADERS.required]);
  assert.deepEqual(header, r.body);
  assert.equal(header.x402Version, 2);
  assert.deepEqual(header.accepts, [req('/data')]);
  assert.equal(header.resource.url, 'https://x.example/data');
  assert.match(header.error, /PAYMENT-SIGNATURE header is required/);
});

test('the full flow: 402, a signed payment, then 200 with the PAYMENT-RESPONSE header and the settlement transaction', async () => {
  const { A, fetchImpl } = stack();
  const r = await payAndFetch({ url: 'https://x.example/data', privateKey: PAYER_KEY, fetchImpl, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.paid, true);
  assert.deepEqual(r.body, { message: 'Hello, paid user!' });
  assert.equal(r.settlement.success, true);
  assert.equal(r.settlement.network, 'eip155:688689');
  assert.equal(r.settlement.payer, PAYER);
  assert.match(r.settlement.transaction, /^0x[0-9a-f]{64}$/);
  assert.equal(r.challenge.accepts[0].amount, '10000');
  assert.deepEqual([A.st.balances[PAYER], A.st.balances[PAY_TO]], [990_000n, 10_000n]);
  const info = await payAndFetch({ url: 'https://x.example/api/info', privateKey: PAYER_KEY, fetchImpl, now: NOW });
  assert.equal(info.status, 200);
  assert.equal(A.st.balances[PAY_TO], 15_000n, 'the second route costs half as much');
});

test('every way of cheating is another 402 and moves nothing', async () => {
  const { A, server } = stack();
  const call = async (payment) => (await server.handle({ path: '/data', headers: { 'payment-signature': typeof payment === 'string' ? payment : b64.enc(payment) } })).status;
  const forged = (o) => { const p = pay('/data'); p.payload.authorization = { ...p.payload.authorization, ...o }; return p; };
  const results = [
    await call(forged({ value: '5000' })), await call(forged({ to: '0x000000000000000000000000000000000000dead' })), await call(pay('/data', { now: NOW - 1000 })),
    await call(createPayment({ requirements: req('/data'), privateKey: OTHER_KEY, now: NOW })), await call(pay('/api/info')), await call('not-base64-json!!'), await call(b64.enc({ nope: true })),
  ];
  assert.deepEqual(results, [402, 402, 402, 402, 402, 402, 402]);
  assert.deepEqual([A.st.balances[PAYER], A.st.balances[PAY_TO]], [1_000_000n, 0n]);
  assert.equal(A.st.sent.length, 0);
  // the same payment sent twice is paid once
  const p = pay('/data');
  assert.equal(await call(p), 200);
  assert.equal(await call(p), 402);
  assert.equal(A.st.balances[PAY_TO], 10_000n);
});

test('a valid payment on a deployment with no facilitator key is a 503 that says nothing was charged', async () => {
  const { A, server } = stack({ key: null });
  const r = await server.handle({ path: '/data', headers: { 'payment-signature': b64.enc(pay('/data')) } });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /your payment is valid, but this deployment’s facilitator holds no key.*nothing was charged and nothing is served/);
  assert.equal(r.body.verified, true);
  assert.equal(A.st.balances[PAY_TO], 0n);
});

test('the client will not pay more than it was allowed to, and will not pay for a scheme it cannot make', async () => {
  const { fetchImpl } = stack();
  await assert.rejects(payAndFetch({ url: 'https://x.example/data', privateKey: PAYER_KEY, maxAmount: '5000', fetchImpl, now: NOW }), /asks for 10000 base units, more than the 5000/);
  const free = await payAndFetch({ url: 'https://x.example/health', privateKey: PAYER_KEY, fetchImpl, now: NOW });
  assert.deepEqual([free.status, free.paid], [200, false]);
  const odd = async () => ({ status: 402, headers: { get: () => null }, json: async () => ({ accepts: [{ scheme: 'upto', network: 'eip155:1' }] }) });
  await assert.rejects(payAndFetch({ url: 'https://x.example/data', privateKey: PAYER_KEY, fetchImpl: odd }), /needs the exact scheme on eip155:688689/);
});

test('httpFacilitator speaks the routes of the Pharos guide: POST /verify and /settle with { paymentPayload, paymentRequirements }, GET /supported', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init?.method ?? 'GET', init?.body ? JSON.parse(init.body) : null]); return { status: 200, json: async () => ({ isValid: true }) }; };
  const h = httpFacilitator('http://localhost:4022/', fetchImpl);
  await h.verify({ a: 1 }, { b: 2 });
  await h.settle({ a: 1 }, { b: 2 });
  await h.supported();
  assert.deepEqual(seen.map((s) => [s[0], s[1]]), [['http://localhost:4022/verify', 'POST'], ['http://localhost:4022/settle', 'POST'], ['http://localhost:4022/supported', 'GET']]);
  assert.deepEqual(seen[0][2], { x402Version: 2, paymentPayload: { a: 1 }, paymentRequirements: { b: 2 } });
  await assert.rejects(httpFacilitator('http://x', async () => ({ status: 502, json: async () => { throw new Error('not json'); } })).verify({}, {}), /answered HTTP 502 without JSON/);
});

// ---- keys ---------------------------------------------------------------------------------------------------------------------------------
test('keys come from the environment or a file, are checked for shape, and are never echoed in an error', () => {
  const key = '0x' + 'ab'.repeat(32);
  assert.equal(loadPrivateKey({ env: { K: key }, name: 'K' }), key);
  assert.equal(loadPrivateKey({ env: { K: 'ab'.repeat(32) }, name: 'K' }), key, 'with or without the 0x');
  const dir = mkdtempSync(join(tmpdir(), 'x402-'));
  writeFileSync(join(dir, 'k.txt'), key + '\n');
  writeFileSync(join(dir, 'k.json'), JSON.stringify({ address: '0x1', privateKey: key }));
  assert.equal(loadPrivateKey({ env: { K_FILE: join(dir, 'k.txt') }, name: 'K' }), key);
  assert.equal(loadPrivateKey({ env: { K_FILE: join(dir, 'k.json') }, name: 'K' }), key);
  assert.equal(loadPrivateKey({ env: {}, name: 'K', file: join(dir, 'k.json') }), key);
  assert.throws(() => loadPrivateKey({ env: {}, name: 'K' }), (e) => e instanceof UserError && /K is not set.*never taken from code or from a prompt/.test(e.message));
  assert.throws(() => loadPrivateKey({ env: { K: 'not a key' }, name: 'K' }), (e) => /does not look like a private key/.test(e.message) && !e.message.includes('not a key'));
  assert.throws(() => loadPrivateKey({ env: { K_FILE: join(dir, 'missing') }, name: 'K' }), /could not read the key file/);
});
