import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildDigest, periods, toMarkdown, toText } from '../lib/digest.js';
import { deliverDigest } from '../lib/digest-delivery.js';
import { makeChannel } from '../lib/alerts.js';
import { VAULT_LIST, FEEDS } from '../lib/defi.js';
import { MORPHO } from '../lib/protocols.js';
import { keccak256, selectorOf } from '../lib/keccak.js';
import weekly from '../lib/tasks/weekly-digest-agent.js';
import { content } from '../public/js/tasks/weekly-digest-agent.js';

const T0 = 1_700_000_000; const HEAD = 400_000; // one block a second, so one day is 86,400 blocks
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const topic = (s) => '0x' + keccak256(Buffer.from(s));
const SUPPLY = topic('Supply(bytes32,address,address,uint256,uint256)'); const LIQ = topic('Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)');

// a fake chain behind an HTTP server that answers batches; `world` says what the state is at each block
function chain(world) {
  const reads = { eth_call: 0 };
  const one = (r) => {
    const ok = (result) => ({ jsonrpc: '2.0', id: r.id, result });
    const { method, params } = r;
    if (method === 'eth_blockNumber') return ok('0x' + (HEAD + 2).toString(16));
    if (method === 'eth_getBlockByNumber') { const n = parseInt(params[0], 16); return ok({ number: params[0], timestamp: '0x' + (T0 + n).toString(16), transactions: Array(world.txs?.(n) ?? 0).fill('0x'), gasUsed: '0x1', gasLimit: '0x64' }); }
    if (method === 'eth_getLogs') { const [f] = params; const a = parseInt(f.fromBlock, 16); const b = parseInt(f.toBlock, 16); return ok((world.logs ?? []).filter((l) => l.n >= a && l.n <= b).map((l) => ({ topics: [l.topic, '0x' + w(1), '0x' + w(2), '0x' + w(3)], data: '0x' + l.data.map(w).join(''), blockNumber: '0x' + l.n.toString(16), transactionHash: '0x' + l.n.toString(16).padStart(64, '0') }))); }
    if (method === 'eth_call') {
      reads.eth_call++;
      const n = params[1] === 'latest' ? HEAD : parseInt(params[1], 16); const { to, data } = params[0];
      const t = to.toLowerCase();
      if (t === FEEDS['PROS/USD'].address) { const p = world.price(n); return ok('0x' + w(0) + w(p.answer) + w(0) + w(p.updatedAt ?? T0 + n) + w(0)); }
      if (data.startsWith(selectorOf('totalSupply()'))) return ok('0x' + w(world.usdc(n)));
      if (t === MORPHO.address.toLowerCase()) { const m = world.market(n); return ok('0x' + [m.supply, 1, m.borrow, 1, 0, 0].map(w).join('')); }
      const v = VAULT_LIST.find((x) => x.address.toLowerCase() === t);
      if (v && data.startsWith(selectorOf('totalAssets()'))) return ok('0x' + w(world.tvl(v, n)));
      if (v) return ok('0x' + w(world.px(v, n)));
    }
    return { jsonrpc: '2.0', id: r.id, error: { message: `unsupported ${method}` } };
  };
  const server = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j))); }); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, reads, close: () => server.close() })));
}
const usd = (x) => BigInt(Math.round(x * 1e6));
const calm = { price: () => ({ answer: 6n * 10n ** 17n }), usdc: () => usd(1_000_000), market: () => ({ supply: usd(100_000), borrow: usd(50_000) }), tvl: () => usd(500_000), px: () => 1_000_000n };

test('periods: the current and the previous period are consecutive and as long as asked', async () => {
  const c = await chain(calm);
  try {
    const P = await periods({ days: 1, url: c.url });
    assert.ok(Math.abs(P.current.toBlock - P.current.fromBlock - 86_400) <= 2, 'a day of one-second blocks');
    assert.equal(P.previous.toBlock + 1, P.current.fromBlock);
    assert.ok(Math.abs((P.previous.toTime - P.previous.fromTime) - 86_400) <= 2);
    await assert.rejects(periods({ days: 0, url: c.url }), /days must be/);
    await assert.rejects(periods({ days: 15, url: c.url }), /days must be/);
  } finally { c.close(); }
});

test('metrics: every figure comes with the previous period and the change', async () => {
  const world = { ...calm, usdc: (n) => (n < HEAD - 40_000 ? usd(1_000_000) : usd(1_200_000)), market: (n) => ({ supply: n < HEAD - 40_000 ? usd(100_000) : usd(150_000), borrow: usd(90_000) }), tvl: () => usd(500_000), px: (v, n) => 1_000_000n + BigInt(Math.max(0, n - (HEAD - 2 * 86_400)) * 10) };
  const c = await chain(world);
  try {
    const d = await buildDigest({ days: 1, depth: 'state', url: c.url, now: () => new Date('2026-10-27T08:00:00Z') });
    const m = Object.fromEntries(d.metrics.map((x) => [x.id, x]));
    assert.equal(m.usdc.now, 1_200_000); assert.equal(m.usdc.before, 1_000_000); assert.ok(Math.abs(m.usdc.change - 0.2) < 1e-9);
    assert.equal(m['market-supply'].now, 150_000); assert.ok(Math.abs(m['market-supply'].change - 0.5) < 1e-9);
    assert.ok(Math.abs(m.utilization.now - 0.6) < 1e-9);
    assert.equal(m['vault-tvl'].now, 2_000_000, 'four vaults of 500,000');
    assert.ok(m['best-vault'].now > 0, 'the share price rose, so the vault returned something');
    assert.equal(m.price.text, '$0.6000');
    assert.equal(d.metrics.every((x) => 'beforeText' in x), true);
    assert.equal(d.generatedAt, '2026-10-27T08:00:00.000Z');
    assert.match(d.markdown, /\| Metric \| This period \| Previous period \| Change \|/);
    assert.match(toText(d), /Top 3 this period/);
  } finally { c.close(); }
});

test('always three notable items: a liquidation first, then the biggest moves, and quiet facts when nothing stands out', async () => {
  const quiet = await chain(calm);
  try {
    const d = await buildDigest({ days: 1, depth: 'state', url: quiet.url });
    assert.equal(d.notable.length, 3);
    assert.ok(d.notable.every((n) => n.quiet), 'a flat week is described as steady, not invented');
    assert.equal(new Set(d.notable.map((n) => n.kind)).size, 3);
  } finally { quiet.close(); }
  const busy = await chain({ ...calm, logs: [{ n: HEAD - 1000, topic: SUPPLY, data: [usd(40_000), 1] }, { n: HEAD - 500, topic: LIQ, data: [usd(7_000), 1, 2, 0, 0] }], price: (n) => ({ answer: n > HEAD - 40_000 ? 9n * 10n ** 17n : 6n * 10n ** 17n }) });
  try {
    const d = await buildDigest({ days: 1, depth: 'full', url: busy.url });
    assert.equal(d.notable.length, 3);
    assert.equal(d.notable[0].kind, 'liquidation');
    assert.match(d.notable[0].text, /liquidated: \$7,000 of debt repaid/);
    assert.ok(d.notable[0].link.includes('/tx/0x'));
    assert.ok(d.notable.some((n) => n.kind === 'price move'), 'a +50% price move is notable');
    assert.equal(d.metrics.find((x) => x.id === 'ev-liq').now, 1);
    assert.equal(d.metrics.find((x) => x.id === 'ev-supply').now, 40_000);
  } finally { busy.close(); }
});

test('stale answers from a lagging node: a price whose time goes back is read again and does not become a 40% "move"', async () => {
  let stale = 0;
  const c = await chain({ ...calm, price: (n) => (n > HEAD - 60_000 && n < HEAD - 50_000 && stale++ < 100 ? { answer: 4n * 10n ** 17n, updatedAt: T0 } : { answer: 6n * 10n ** 17n }) });
  try {
    const d = await buildDigest({ days: 1, depth: 'state', url: c.url });
    assert.ok(!d.notable.some((n) => n.kind === 'price move'), d.notable.map((n) => n.text).join(' | '));
  } finally { c.close(); }
});

test('the ends of a period are read three times and two reads must agree', async () => {
  let calls = 0;
  const c = await chain({ ...calm, usdc: (n) => { calls++; return n === HEAD - 1 + 0 ? usd(1) : usd(1_000_000); } });
  try {
    const d = await buildDigest({ days: 1, depth: 'state', url: c.url });
    assert.ok(Number.isFinite(d.metrics.find((x) => x.id === 'usdc').now));
    assert.ok(calls >= 3 * 4, `the boundary blocks were read more than once (${calls} supply reads)`);
  } finally { c.close(); }
});

test('delivery: once per digest and channel, retried for the channel that was down', async () => {
  const mk = (id, fail = 0) => { const sent = []; let f = fail; return { id, sent, send: async (a) => { if (f-- > 0) return { ok: false, error: 'down' }; sent.push(a); return { ok: true, status: 200 }; } }; };
  const digest = { periods: { current: { toBlock: 1234 } }, headline: 'H', notable: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], text: 'body' };
  const a = mk('a'); const b = mk('b', 1); const state = {};
  const r1 = await deliverDigest({ digest, channels: [a, b], state, link: 'https://x' });
  assert.deepEqual([r1.delivered.map((x) => x.channel), r1.failed.map((x) => x.channel)], [['a'], ['b']]);
  const r2 = await deliverDigest({ digest, channels: [a, b], state, link: 'https://x' });
  assert.deepEqual([r2.delivered.map((x) => x.channel), r2.skipped.map((x) => x.channel)], [['b'], ['a']]);
  assert.equal(a.sent.length, 1);
  assert.match(a.sent[0].text, /Full report: https:\/\/x/);
  assert.ok(a.sent[0].text.length <= 1900);
  const r3 = await deliverDigest({ digest: { ...digest, periods: { current: { toBlock: 1235 } } }, channels: [a], state, link: 'https://x' });
  assert.equal(r3.delivered.length, 1, 'the next period is a new digest');
  await assert.rejects(deliverDigest({ digest, channels: [], state }), /channel/);
});

test('the scheduled run: refused without the secret, and with the wrong one; harmless without a channel', async () => {
  delete process.env.CRON_SECRET;
  await assert.rejects(weekly({ q: { cron: '1' }, headers: { authorization: 'Bearer anything' } }), /CRON_SECRET/);
  process.env.CRON_SECRET = 'right-secret';
  try {
    await assert.rejects(weekly({ q: { cron: '1' }, headers: { authorization: 'Bearer wrong-secret' } }), /CRON_SECRET/);
    await assert.rejects(weekly({ q: { cron: '1' }, headers: {} }), /CRON_SECRET/);
  } finally { delete process.env.CRON_SECRET; }
  await assert.rejects(weekly({ q: { digest: '1', days: '0' } }), /1 to 7/);
  await assert.rejects(weekly({ q: { digest: '1', days: '8' } }), /1 to 7 on the web/);
  await assert.rejects(weekly({ q: { digest: '1', days: '2.5' } }), /whole number/);
  await assert.rejects(weekly({ q: {} }), /use \?recorded/);
});

test('the schedule is configured: a weekly cron on the digest, and the CLI accepts --every', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(v.crons, [{ path: '/api/run?slug=weekly-digest-agent&cron=1', schedule: '0 8 * * 1' }]);
  assert.match(readFileSync(new URL('../agents/weekly-digest-agent/pharos-digest.js', import.meta.url), 'utf8'), /--every/);
});

test('the recorded digest: comparisons, three notable events with links, delivery once, a published page', () => {
  const r = JSON.parse(readFileSync(new URL('../reports/digest-run.json', import.meta.url), 'utf8'));
  assert.ok(r.digest.metrics.length >= 10 && r.digest.metrics.every((m) => m.text && m.beforeText));
  assert.equal(r.digest.notable.length, 3);
  assert.ok(r.digest.notable.some((n) => n.link), 'at least one real event');
  assert.equal(r.summary.deliveredFirst, 3); assert.equal(r.summary.deliveredSecond, 0);
  assert.deepEqual(r.delivery.received.map((x) => x.channel).sort(), ['discord', 'ntfy', 'webhook']);
  assert.ok(readFileSync(new URL('../public/digests/latest.html', import.meta.url), 'utf8').includes('digest'));
  assert.equal(r.schedule.cron, '0 8 * * 1');
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
