import test from 'node:test';
import assert from 'node:assert/strict';
import { b64, HEADERS, NETWORK } from '../lib/x402.js';
import { runBuyerJob } from '../lib/x402-buyer.js';
import { content } from '../public/js/tasks/x402-agent-buyer.js';

const ASSET = '0xa952d7f3dc17da87a71d1e33958139bcd5565eef';
const PAY_TO = '0x262927e3f2e3AD7824aa708CdF39106084988B13';
const HASH = '0x' + 'ab'.repeat(32);
const HASH2 = '0x' + 'cd'.repeat(32);
const req = (amount, patch = {}) => ({ scheme: 'exact', network: NETWORK, amount: String(amount), asset: ASSET, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' }, ...patch });
const tasks = [
  { id: 'market-summary', name: 'Market summary', url: 'https://api.test/summary', value: '8000' },
  { id: 'price-data', name: 'Price data', url: 'https://api.test/data', value: '12000' },
];
let nonceN = 0;
const signer = ({ requirements }) => ({ x402Version: 2, accepted: requirements, payload: { signature: `0xmock-signature-${nonceN}`, authorization: { from: '0x581A4ffEd2ca1C7A1211dF2273DFf5e2AbA73fb7', nonce: '0x' + (++nonceN).toString(16).padStart(64, '0') } } });
const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function paywall({ prices = [5000, 10000], after = ({ index }) => response(200, { ok: true }, { [HEADERS.response]: b64.enc({ success: true, network: NETWORK, transaction: index ? HASH2 : HASH }) }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const i = url.endsWith('/summary') ? 0 : 1;
    if (!new Headers(init.headers).has(HEADERS.signature)) {
      const challenge = { x402Version: 2, resource: { url }, accepts: [req(prices[i])] };
      return response(402, challenge, { [HEADERS.required]: b64.enc(challenge) });
    }
    return after({ url, init, index: i, calls });
  };
  return { fetchImpl, calls };
}

test('two paid endpoints complete a job and log each confirmed settlement once', async () => {
  const fake = paywall();
  const r = await runBuyerJob({ tasks, budget: '20000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.payments.map((p) => p.item), ['Market summary', 'Price data']);
  assert.deepEqual(r.payments.map((p) => p.price), ['5000', '10000']);
  assert.deepEqual(r.payments.map((p) => p.transaction), [HASH, HASH2]);
  assert.equal(r.spent, '15000');
  assert.equal(r.reserved, '0');
  assert.equal(fake.calls.filter((c) => new Headers(c.init.headers).has(HEADERS.signature)).length, 2);
});

test('a per-call cap refuses before signing or sending payment', async () => {
  const fake = paywall();
  const r = await runBuyerJob({ tasks, budget: '50000', maxPerCall: '4000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'stopped');
  assert.equal(r.stopReason, 'per-call-cap');
  assert.equal(r.payments.length, 0);
  assert.equal(fake.calls.filter((c) => new Headers(c.init.headers).has(HEADERS.signature)).length, 0);
});

test('the running budget stops before an unaffordable second authorization', async () => {
  const fake = paywall();
  const r = await runBuyerJob({ tasks, budget: '7000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'stopped');
  assert.equal(r.stopReason, 'budget');
  assert.equal(r.spent, '5000');
  assert.equal(r.payments.length, 1);
  assert.equal(fake.calls.filter((c) => new Headers(c.init.headers).has(HEADERS.signature)).length, 1);
});

test('a low-value offer is skipped without payment and the remaining job can continue', async () => {
  const fake = paywall();
  const r = await runBuyerJob({ tasks: [{ ...tasks[0], value: '100' }, tasks[1]], budget: '20000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'complete');
  assert.equal(r.decisions[0].decision, 'not-worth-it');
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].item, 'Price data');
});

test('a different asset or EIP-712 domain is refused before signing the later endpoint', async () => {
  for (const changed of [{ asset: '0x' + '99'.repeat(20) }, { extra: { name: 'Other USD Coin', version: '2' } }]) {
    const fake = paywall();
    const ordinary = fake.fetchImpl;
    fake.fetchImpl = async (url, init = {}) => {
      const signed = new Headers(init.headers).has(HEADERS.signature);
      if (url.endsWith('/data') && !signed) {
        const challenge = { x402Version: 2, accepts: [req(10000, changed)] };
        fake.calls.push({ url, init });
        return response(402, challenge, { [HEADERS.required]: b64.enc(challenge) });
      }
      return ordinary(url, init);
    };
    const r = await runBuyerJob({ tasks, budget: '30000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
    assert.equal(r.status, 'stopped');
    assert.equal(r.stopReason, 'incompatible-terms');
    assert.equal(r.payments.length, 1);
  }
});

test('malformed requirements stop without creating a payment', async () => {
  const fake = paywall({ prices: ['1e9', 10000] });
  const r = await runBuyerJob({ tasks, budget: '30000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'stopped');
  assert.equal(r.stopReason, 'invalid-requirements');
  assert.equal(r.payments.length, 0);
});

test('a transient request retry reuses the exact signed authorization and records one payment', async () => {
  let posts = 0;
  const seen = [];
  const fake = paywall({ after: ({ init }) => {
    posts++;
    seen.push(new Headers(init.headers).get(HEADERS.signature));
    if (posts === 1) throw new TypeError('socket reset');
    return response(200, { ok: true }, { [HEADERS.response]: b64.enc({ success: true, network: NETWORK, transaction: HASH }) });
  } });
  const r = await runBuyerJob({ tasks: [tasks[0], { ...tasks[1], value: '0' }], budget: '10000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer, maxAttempts: 2 });
  assert.equal(r.status, 'complete');
  assert.equal(posts, 2);
  assert.equal(seen[0], seen[1]);
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].attempts, 2);
  assert.equal(r.spent, '5000');
});

test('exhausting bounded retries reports the actual attempt count and reserves the offer', async () => {
  let posts = 0;
  const fake = paywall({ after: () => { posts++; throw new TypeError('connection lost'); } });
  const r = await runBuyerJob({ tasks, budget: '20000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer, maxAttempts: 2 });
  assert.equal(r.status, 'unresolved');
  assert.equal(posts, 2);
  assert.equal(r.unresolved[0].attempts, 2);
  assert.equal(r.reserved, '5000');
});

test('uncertain settlement reserves the amount and stops before the next endpoint', async () => {
  const fake = paywall({ after: () => response(503, { error: 'settlement unresolved' }, { [HEADERS.response]: b64.enc({ success: false, errorReason: 'settlement_timeout', transaction: HASH, network: NETWORK }) }) });
  const r = await runBuyerJob({ tasks, budget: '30000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'unresolved');
  assert.equal(r.stopReason, 'unresolved');
  assert.equal(r.spent, '0');
  assert.equal(r.reserved, '5000');
  assert.equal(r.decisions.length, 1);
  assert.equal(r.unresolved[0].transaction, HASH);
});

test('a post-payment 402 is unresolved and never counted as a settled payment', async () => {
  const fake = paywall({ after: () => response(402, { error: 'nonce may already be used' }) });
  const r = await runBuyerJob({ tasks, budget: '10000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'unresolved');
  assert.equal(r.spent, '0');
  assert.equal(r.reserved, '5000');
  assert.equal(r.payments.length, 0);
});

test('a repeated settlement hash can never be counted as a second purchase', async () => {
  const fake = paywall({ after: () => response(200, { ok: true }, { [HEADERS.response]: b64.enc({ success: true, network: NETWORK, transaction: HASH }) }) });
  const r = await runBuyerJob({ tasks, budget: '30000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'unresolved');
  assert.equal(r.payments.length, 1);
  assert.equal(r.spent, '5000');
  assert.equal(r.reserved, '10000');
});

test('a settled payment with a failed resource handler is counted once and stops the job', async () => {
  const fake = paywall({ after: () => response(500, { error: 'handler failed' }, { [HEADERS.response]: b64.enc({ success: true, network: NETWORK, transaction: HASH }) }) });
  const r = await runBuyerJob({ tasks, budget: '30000', maxPerCall: '10000', privateKey: 'mock', fetchImpl: fake.fetchImpl, signPayment: signer });
  assert.equal(r.status, 'stopped');
  assert.equal(r.stopReason, 'resource-failed-after-payment');
  assert.equal(r.spent, '5000');
  assert.equal(r.payments.length, 1);
  assert.equal(r.decisions.at(-1).decision, 'resource-failed-after-payment');
});

test('invalid budget, cap, task URLs, and duplicate task IDs are rejected', async () => {
  for (const options of [
    { tasks, budget: '-1', maxPerCall: '10' },
    { tasks, budget: '10', maxPerCall: '0' },
    { tasks: [{ ...tasks[0], url: 'javascript:alert(1)' }], budget: '10', maxPerCall: '10' },
    { tasks: [tasks[0], { ...tasks[1], id: tasks[0].id }], budget: '10', maxPerCall: '10' },
  ]) await assert.rejects(runBuyerJob({ ...options, privateKey: 'mock', fetchImpl: async () => assert.fail('invalid plan must not call the network'), signPayment: signer }));
});

test('task page covers the five Arena requirements and labels its fixtures as offline simulations', () => {
  assert.equal(content.evidence.length, 5);
  assert.match(content.evidence[0], /two distinct routes/);
  assert.match(content.evidence[3], /byte-identical/);
  assert.match(content.run.sample, /OFFLINE BUYER DEMO/);
  assert.match(content.run.sample, /not explorer transactions/);
  assert.ok(content.files.includes('agents/x402-agent-buyer/pharos-buy.js'));
});
