import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSFER_TOPIC, formatAlert, makeChannel, newState, runCycle, scanRange, validateConditions } from '../lib/alerts.js';
import { content } from '../public/js/tasks/on-chain-alert-bot.js';
import { EXAMPLE } from '../lib/tasks/on-chain-alert-bot.js';

const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const topicOf = (a) => '0x' + a.slice(2).padStart(64, '0');
const A = '0x' + '11'.repeat(20);
const B = '0x' + '22'.repeat(20);
const hash = (n) => '0x' + n.toString(16).padStart(64, '0');
const log = (block, n, value) => ({ address: USDC, topics: [TRANSFER_TOPIC, topicOf(A), topicOf(B)], data: '0x' + value.toString(16).padStart(64, '0'), blockNumber: '0x' + block.toString(16), transactionHash: hash(n), logIndex: '0x' + n.toString(16) });
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

function chainWith({ logs = [], feed = () => ({ answer: 6n * 10n ** 17n, updatedAt: 1000 }), blocks = {} } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === 'eth_blockNumber') return '0x' + (10_000).toString(16);
    if (method === 'eth_getLogs') { const [f] = params; const from = Number(f.fromBlock); const to = Number(f.toBlock); assert.ok(to - from + 1 <= 1000, 'log windows are at most 1,000 blocks'); return logs.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && l.address === f.address); }
    if (method === 'eth_call') { const f = feed(Number(params[1])); return '0x' + word(0) + word(f.answer) + word(0) + word(f.updatedAt) + word(0); }
    if (method === 'eth_getBlockByNumber') return blocks[Number(params[0])] ?? { transactions: [] };
    throw new Error(method);
  };
  rpc.calls = calls;
  return rpc;
}
const channel = (id, { fail = 0 } = {}) => { const sent = []; let failures = fail; return { id, sent, send: async (a) => { if (failures > 0) { failures--; return { ok: false, error: 'down' }; } sent.push(a); return { ok: true }; } }; };
const big = validateConditions([{ id: 'big', type: 'transfer', token: 'USDC', min: '10000' }]);

test('conditions are validated', () => {
  for (const bad of [null, [], [{ id: 'a', type: 'nope' }], [{ id: 'a', type: 'transfer', token: 'USDC', min: '0' }], [{ id: 'a', type: 'transfer', token: 'USDC', min: '1.0000001' }],
    [{ id: 'a', type: 'price', feed: 'X/USD', op: 'above', threshold: '1' }], [{ id: 'a', type: 'price', feed: 'PROS/USD', op: 'near', threshold: '1' }], [{ id: 'a', type: 'event', contract: '0x1', signature: 'X()' }],
    [{ id: 'a', type: 'call', contract: A, method: 'nonsense' }], [{ id: 'a', type: 'transfer', token: 'USDC', min: '1' }, { id: 'a', type: 'transfer', token: 'USDC', min: '1' }], [{ id: '../x', type: 'transfer', token: 'USDC', min: '1' }]]) assert.throws(() => validateConditions(bad));
  assert.equal(validateConditions(EXAMPLE).length, 4);
});

test('only transfers at or above the threshold are found; ERC-721 style transfers are ignored', async () => {
  const nft = { ...log(5, 9, 1n), topics: [TRANSFER_TOPIC, topicOf(A), topicOf(B), topicOf('0x1')] };
  const rpc = chainWith({ logs: [log(5, 1, 9_999_999_999n), log(6, 2, 10_000_000_000n), log(7, 3, 55_000_000_000n), nft] });
  const events = await scanRange({ rpc, conditions: big, from: 1, to: 2500 });
  assert.deepEqual(events.map((e) => e.key), [`${hash(2)}:2`, `${hash(3)}:3`]);
});

test('scanning a long range uses windows of at most 1,000 blocks', async () => {
  const rpc = chainWith();
  await scanRange({ rpc, conditions: big, from: 1, to: 4500 });
  assert.equal(rpc.calls.filter((m) => m === 'eth_getLogs').length, 5);
  await assert.rejects(scanRange({ rpc, conditions: big, from: 1, to: 6000 }), /at most/);
});

test('the message says what happened, the value and carries an explorer link', async () => {
  const [ev] = await scanRange({ rpc: chainWith({ logs: [log(6, 2, 12_500_000_000n)] }), conditions: big, from: 1, to: 100 });
  const a = formatAlert(ev, big, { labels: { [A]: 'Treasury' } });
  assert.match(a.text, /12,500 USDC moved from Treasury/);
  assert.match(a.text, new RegExp(`https://www.pharosscan.xyz/tx/${hash(2)}`));
  assert.match(a.value, /threshold 10000 USDC/);
});

test('a price alert fires on the crossing, not on every sample, and again after it crosses back and forth', async () => {
  const price = validateConditions([{ id: 'p', type: 'price', feed: 'PROS/USD', op: 'above', threshold: '0.60' }]);
  const series = (n) => (n < 300 ? { answer: 5n * 10n ** 17n, updatedAt: 100 } : n < 600 ? { answer: 7n * 10n ** 17n, updatedAt: 200 } : n < 800 ? { answer: 5n * 10n ** 17n, updatedAt: 300 } : { answer: 8n * 10n ** 17n, updatedAt: 400 });
  const events = await scanRange({ rpc: chainWith({ feed: series }), conditions: price, from: 0, to: 1000, priceStep: 100 });
  assert.deepEqual(events.map((e) => e.key), ['price:p:200', 'price:p:400']);
});

test('a stale reading from a node with old state does not create an alert', async () => {
  const price = validateConditions([{ id: 'p', type: 'price', feed: 'PROS/USD', op: 'above', threshold: '0.60' }]);
  let bad = 0;
  const feed = (n) => (n === 200 && bad++ < 9 ? { answer: 5n * 10n ** 17n, updatedAt: 50 } : { answer: 7n * 10n ** 17n, updatedAt: 100 });
  const events = await scanRange({ rpc: chainWith({ feed }), conditions: price, from: 0, to: 400 });
  assert.equal(events.length, 1);
});

test('call conditions match target and method, and are capped', async () => {
  const cond = validateConditions([{ id: 'c', type: 'call', contract: A, method: 'transfer(address,uint256)' }]);
  const tx = (h, to, input) => ({ hash: h, to, from: B, input, value: '0x0' });
  const blocks = { 10: { transactions: [tx(hash(1), A, '0xa9059cbb00'), tx(hash(2), A, '0x12345678'), tx(hash(3), B, '0xa9059cbb00')] } };
  const events = await scanRange({ rpc: chainWith({ blocks }), conditions: cond, from: 9, to: 11 });
  assert.deepEqual(events.map((e) => e.txHash), [hash(1)]);
  await assert.rejects(scanRange({ rpc: chainWith(), conditions: cond, from: 0, to: 400 }), /at most 300/);
});

test('the same event is never sent to the same channel twice, across rescans and restarts', async () => {
  const rpc = chainWith({ logs: [log(9_500, 1, 20_000_000_000n), log(9_900, 2, 30_000_000_000n)] });
  const ch = channel('a');
  const state = newState();
  const r1 = await runCycle({ rpc, conditions: big, channels: [ch], state, lookback: 1000 });
  assert.equal(r1.delivered.length, 2);
  const restarted = JSON.parse(JSON.stringify(state));
  const r2 = await runCycle({ rpc, conditions: big, channels: [ch], state: { ...restarted, cursor: null }, lookback: 1000 });
  assert.equal(r2.delivered.length, 0);
  assert.equal(r2.duplicates, 2);
  assert.equal(ch.sent.length, 2);
  const r3 = await runCycle({ rpc, conditions: big, channels: [ch], state, lookback: 1000 });
  assert.equal(r3.found, 0, 'the cursor moved past the scanned blocks');
});

test('a channel that is down loses nothing and does not make the others repeat', async () => {
  const rpc = chainWith({ logs: [log(9_500, 1, 20_000_000_000n)] });
  const up = channel('up'); const flaky = channel('flaky', { fail: 1 });
  const state = newState();
  const r1 = await runCycle({ rpc, conditions: big, channels: [up, flaky], state, lookback: 1000 });
  assert.equal(r1.failed.length, 1);
  assert.equal(state.cursor, null, 'the window stays open');
  const r2 = await runCycle({ rpc, conditions: big, channels: [up, flaky], state, lookback: 1000 });
  assert.equal(r2.failed.length, 0);
  assert.equal(up.sent.length, 1, 'the healthy channel got it once');
  assert.equal(flaky.sent.length, 1, 'the recovered channel got what it missed');
  assert.equal(state.cursor, 10_000);
});

test('channels: request shapes, secrets never leak, bad configs refused', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, headers: new Headers() }; };
  const alert = { title: 'T', text: 'hello', link: 'https://x', what: 'w', value: 'v', block: 1, key: 'k', conditionId: 'c' };
  await makeChannel({ type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/secret' }, { fetchImpl }).send(alert);
  assert.deepEqual(JSON.parse(calls[0].init.body), { content: 'hello', allowed_mentions: { parse: [] } });
  const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await makeChannel({ type: 'telegram', token, chatId: '-100123' }, { fetchImpl }).send(alert);
  assert.equal(calls[1].url, `https://api.telegram.org/bot${token}/sendMessage`);
  assert.equal(JSON.parse(calls[1].init.body).chat_id, '-100123');
  const boom = makeChannel({ type: 'telegram', token, chatId: '1' }, { fetchImpl: async (u) => { throw new Error(`connect failed ${u}`); } });
  const r = await boom.send(alert);
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes(token), 'the bot token is scrubbed from errors');
  for (const bad of [{ type: 'discord', webhookUrl: 'http://example.com/x' }, { type: 'discord', webhookUrl: 'https://user:pw@example.com/x' }, { type: 'telegram', token: 'x', chatId: '1' }, { type: 'sms' }]) assert.throws(() => makeChannel(bad));
  assert.ok(makeChannel({ type: 'webhook', url: 'http://127.0.0.1:9/x' }), 'plain http is allowed for localhost only');
});

test('delivery retries a 5xx and gives up on a 4xx', async () => {
  let n = 0;
  const ch = makeChannel({ type: 'webhook', url: 'https://example.com/hook' }, { fetchImpl: async () => ({ status: ++n < 2 ? 503 : 200, headers: new Headers({ 'retry-after': '0' }) }) });
  assert.equal((await ch.send({ title: 't', text: 't', link: 'l' })).ok, true);
  n = -10; let calls = 0;
  const bad = makeChannel({ type: 'webhook', url: 'https://example.com/hook' }, { fetchImpl: async () => { calls++; return { status: 404, headers: new Headers() }; } });
  assert.equal((await bad.send({ title: 't', text: 't', link: 'l' })).ok, false);
  assert.equal(calls, 1);
});

test('the recorded mainnet run agrees with its own claims', () => {
  const run = JSON.parse(readFileSync(new URL('../reports/alerts-run.json', import.meta.url), 'utf8'));
  assert.equal(run.summary.duplicatesSentOnRescan, 0);
  assert.equal(run.summary.outageLostNothing, true);
  assert.ok(run.summary.eventsInFirstWindow >= 5 && run.summary.callEvents >= 1);
  const by = Object.fromEntries(run.scenarios.map((s) => [s.id, s]));
  assert.equal(by['first-cycle'].delivered, by['first-cycle'].eventsFound * 3, 'every event reached all three channels once');
  assert.equal(by['channel-outage'].cursorMoved, false);
  assert.equal(by['channel-recovered'].sentTo.discord, by['channel-outage'].failed);
  assert.equal(by['channel-recovered'].sentTo.ntfy + by['channel-recovered'].sentTo.webhook, 0);
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
