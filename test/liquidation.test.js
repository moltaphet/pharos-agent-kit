import test from 'node:test';
import assert from 'node:assert/strict';
import { MORPHO } from '../lib/protocols.js';
import { selectorOf } from '../lib/keccak.js';
import { UserError } from '../lib/snapshot.js';
import {
  DEFAULT_THRESHOLDS, ORACLE_PRICE_SCALE, TOPICS, WAD, assess, buildAlert, channelsFromEnv, checkPosition, computeHealth, consoleChannel, consoleText, discordChannel, levelOf,
  liquidationIncentiveFactor, parseThresholds, readPosition, remedies, runWatchdog, scanBorrowers, shouldAlert, telegramChannel,
} from '../lib/liquidation.js';

import { BORROWER, ID, world } from './support/morpho-world.js';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const SEL = Object.fromEntries(['position(bytes32,address)'].map((x) => [x, selectorOf(x)]));

const rawOf = (w) => ({ lltv: w.lltv, collateral: w.collateral, borrowShares: w.borrowShares, price: w.price, market: { totalBorrowAssets: w.totalBorrowAssets, totalBorrowShares: w.totalBorrowShares, lastUpdate: BigInt(w.lastUpdate) }, borrowRate: w.rate });

// ---- the maths ------------------------------------------------------------------------------------------------------------------------------------
test('health: Morpho’s own test (maxBorrow >= borrowed), with the debt carried forward by the accrued interest', () => {
  const { w } = world();
  const raw = rawOf(w);
  const h = computeHealth(raw, w.timestamp);
  assert.equal(h.elapsedSeconds, 10_000);
  assert.ok(h.borrowed > h.borrowedAtLastUpdate, 'ten thousand seconds of interest have been added');
  assert.equal(h.maxBorrow, (((raw.collateral * raw.price) / ORACLE_PRICE_SCALE) * raw.lltv) / WAD);
  assert.equal(h.healthy, h.maxBorrow >= h.borrowed);
  assert.ok(Math.abs(h.hf - Number(h.maxBorrow) / Number(h.borrowed)) < 1e-9);
  // the same position without the time that passed has a better health factor
  assert.ok(computeHealth(raw, Number(raw.market.lastUpdate)).hf > h.hf);
  // interest: the market's debt grows by about rate × seconds
  const growth = Number(h.interestAccrued) / Number(raw.market.totalBorrowAssets);
  assert.ok(Math.abs(growth - (Number(raw.borrowRate) / 1e18) * 10_000) / growth < 1e-3, 'simple interest to within the compounding terms');
});

test('no debt means no health factor and nothing to liquidate; no time passed means no interest', () => {
  const { w } = world({ borrowShares: 0n });
  const h = computeHealth(rawOf(w), w.timestamp);
  assert.equal(h.hf, null);
  assert.equal(h.borrowed, 0n);
  assert.equal(h.healthy, true);
  assert.equal(levelOf(h.hf), 'no-debt');
  const same = computeHealth(rawOf(world().w), world().w.lastUpdate);
  assert.equal(same.interestAccrued, 0n);
});

test('levels: the boundaries are inclusive on the warning side, and below 1 is liquidatable', () => {
  const th = { warn: 1.3, critical: 1.1 };
  assert.deepEqual([2, 1.3001, 1.3, 1.2, 1.1001, 1.1, 1.0001, 1, 0.9999, 0.5].map((x) => levelOf(x, th)), ['ok', 'ok', 'warning', 'warning', 'warning', 'critical', 'critical', 'critical', 'liquidatable', 'liquidatable']);
});

test('assess uses Morpho integer health at the liquidation boundary, not a rounded float', () => {
  const read = {
    params: { lltv: WAD },
    position: { collateral: 0n, borrowShares: 10n ** 18n },
    price: ORACLE_PRICE_SCALE,
    market: { totalBorrowAssets: 10n ** 18n, totalBorrowShares: 10n ** 18n, lastUpdate: 100n },
    borrowRate: 0n,
    block: { timestamp: 100 },
  };
  const first = assess(read);
  read.position.collateral = first.health.borrowed - 1n;
  const a = assess(read);
  assert.ok(a.health.hfWad < WAD && a.health.hfWad > WAD - 100n);
  assert.equal(a.health.hf, 1, 'the UI number rounds to 1');
  assert.equal(a.health.healthy, false);
  assert.equal(a.level, 'liquidatable');
});

test('thresholds are validated: critical above 1, warn above critical, numbers only', () => {
  assert.deepEqual(parseThresholds(), DEFAULT_THRESHOLDS);
  assert.deepEqual(parseThresholds({ warn: '1.5', critical: '1.2' }), { warn: 1.5, critical: 1.2 });
  assert.throws(() => parseThresholds({ critical: 1 }), /critical must be above 1/);
  assert.throws(() => parseThresholds({ critical: 0.9 }), /critical must be above 1/);
  assert.throws(() => parseThresholds({ warn: 1.1, critical: 1.1 }), /warn must be above critical/);
  assert.throws(() => parseThresholds({ warn: 'lots' }), /must be numbers/);
  assert.throws(() => parseThresholds({ warn: 11 }), /at most 10/);
  for (const bad of [{ warn: NaN }, { critical: Infinity }]) assert.throws(() => parseThresholds(bad), UserError);
});

test('the suggested repayment is exactly enough: it reaches the target, and one unit less does not', () => {
  const { w } = world();
  const raw = rawOf(w);
  const h = computeHealth(raw, w.timestamp);
  for (const target of [1.1, 1.3, 1.5]) {
    const r = remedies(raw, h, target);
    const after = (repay) => Number(h.maxBorrow) / Number(h.borrowed - repay);
    assert.ok(after(r.repayToTarget) >= target - 1e-9, `repaying ${r.repayToTarget} reaches ${target}`);
    assert.ok(after(r.repayToTarget - 100n) < target, `100 base units less does not reach ${target}`);
  }
});

test('the suggested collateral is exactly enough, and the liquidation price is the point where the position stops being healthy', () => {
  const { w } = world();
  const raw = rawOf(w);
  const h = computeHealth(raw, w.timestamp);
  const r = remedies(raw, h, 1.3);
  const hfWith = (extra) => computeHealth({ ...raw, collateral: raw.collateral + extra }, w.timestamp).hf;
  assert.ok(hfWith(r.addCollateral) >= 1.3 - 1e-9);
  assert.ok(hfWith(r.addCollateral - 10n ** 15n) < 1.3);
  // at the liquidation price the position is just healthy; one tick under it is not
  assert.equal(computeHealth({ ...raw, price: r.liquidationPrice }, w.timestamp).healthy, true);
  assert.equal(computeHealth({ ...raw, price: r.liquidationPrice - 10n ** 12n }, w.timestamp).healthy, false);
  assert.ok(r.priceDropPct > 0 && r.priceDropPct < 5, 'a position at 1.02 can lose about two percent');
});

test('"how long until interest alone liquidates it" follows from the borrow rate', () => {
  const { w } = world();
  const raw = rawOf(w);
  const h = computeHealth(raw, w.timestamp);
  const r = remedies(raw, h, 1.3);
  const later = computeHealth(raw, w.timestamp + Math.round(r.daysToLiquidationByInterest * 86400));
  assert.ok(Math.abs(later.hf - 1) < 0.002, `after those days the health factor is ${later.hf}`);
  assert.equal(remedies(raw, computeHealth({ ...raw, borrowShares: 0n }, w.timestamp), 1.3), null);
});

test('the liquidation bonus is Morpho’s: 1 / (1 − 0.3 × (1 − LLTV)), capped at 1.15', () => {
  assert.ok(Math.abs(Number(liquidationIncentiveFactor(915n * 10n ** 15n)) / 1e18 - 1 / (1 - 0.3 * (1 - 0.915))) < 1e-12);
  assert.ok(Math.abs(Number(liquidationIncentiveFactor(915n * 10n ** 15n)) / 1e18 - 1.026167) < 1e-6);
  assert.equal(liquidationIncentiveFactor(10n ** 17n), 115n * 10n ** 16n, 'a low LLTV hits the cap');
});

// ---- reading the chain ---------------------------------------------------------------------------------------------------------------------------
test('readPosition reads the market and the position at one block, two behind the head, confirmed on the public RPC', async () => {
  const W = world();
  const read = await readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER });
  assert.equal(read.block.number, W.w.head - 2);
  assert.equal(read.block.timestamp, W.w.timestamp);
  assert.equal(read.loan.symbol, 'USDC');
  assert.equal(read.collateral.decimals, 18);
  assert.equal(read.position.collateral, W.w.collateral);
  assert.equal(read.price, W.w.price);
  assert.deepEqual({ batches: read.integrity.batches, confirmed: read.integrity.confirmed, inconclusive: read.integrity.inconclusive }, { batches: 2, confirmed: 2, inconclusive: 0 });
  assert.ok(read.sources.length >= 9 && read.sources.every((s) => s.block === W.w.head - 2 && /^0x/.test(s.contract)));
  const eth = W.calls.filter((c) => c.who === 'chain').map((c) => c.name);
  assert.deepEqual([...new Set(eth)].sort(), ['eth_call', 'get_block', 'get_block_number'], 'only reads');
});

test('bad input is refused before anything is read: a market id that is not 32 bytes, an address that is not one, a block that is not readable', async () => {
  const W = world();
  await assert.rejects(readPosition({ chain: W.chain, rpc: W.rpc, marketId: '0x12', borrower: BORROWER }), /32 bytes/);
  await assert.rejects(readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: '0x12' }), /borrower must be a 0x address/);
  await assert.rejects(readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, block: W.w.head }), /block must be a whole number from 1 to/);
  await assert.rejects(readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, block: 0 }), UserError);
  assert.equal(W.calls.filter((c) => c.name === 'eth_call').length, 0);
});

test('a market Morpho does not have, and an oracle that gives no price, are said so and never turned into a number', async () => {
  const none = world({ noMarket: true });
  await assert.rejects(readPosition({ chain: none.chain, rpc: none.rpc, marketId: ID, borrower: BORROWER }), /no market with this id/);
  const dead = world({ brokenOracle: true });
  await assert.rejects(readPosition({ chain: dead.chain, rpc: dead.rpc, marketId: ID, borrower: BORROWER }), /oracle did not give a price/);
});

test('a Chain MCP backend that answers with the wrong state is caught by the public RPC and the right figure wins', async () => {
  let lied = false;
  const W = world({ wrong: (target, data) => { if (lied || target.toLowerCase() !== MORPHO.address.toLowerCase() || !data.startsWith(SEL['position(bytes32,address)'])) return undefined; lied = true; return '0x' + word(0) + word(0) + word(1n); } });
  const read = await readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER });
  assert.equal(read.position.collateral, W.w.collateral, 'the wrong first answer was discarded');
  assert.equal(read.integrity.resolved, 1);
});

// ---- alerts --------------------------------------------------------------------------------------------------------------------------------------
test('an alert says the level, the numbers, and a concrete action with an amount, in the console with a timestamp', async () => {
  const W = world();
  const lines = [];
  const out = await checkPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, channels: [consoleChannel((s) => lines.push(s))], now: () => '2026-10-24T21:00:00.000Z' });
  assert.equal(out.assessment.level, 'critical');
  assert.equal(out.alertSent, true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[2026-10-24T21:00:00\.000Z\] CRITICAL: health factor 1\.0\d+ \(warn at 1\.3, critical at 1\.1\)/);
  assert.match(lines[0], /→ repay [\d,.]+ USDC or add [\d,.]+ syzUSD of collateral to get back to a health factor of 1\.30\./);
  assert.match(lines[0], /syzUSD would have to fall \d+\.\d\d% /);
  assert.deepEqual(out.delivered, [{ channel: 'console', ok: true }]);
});

test('a healthy position raises nothing; no debt says so; a liquidatable position says act now', async () => {
  const ok = world({ collateral: 40_000n * 10n ** 18n });
  const a = await checkPosition({ chain: ok.chain, rpc: ok.rpc, marketId: ID, borrower: BORROWER, channels: [consoleChannel(() => assert.fail('no alert for a healthy position'))] });
  assert.equal(a.assessment.level, 'ok');
  assert.equal(a.alertSent, false);
  const none = world({ borrowShares: 0n });
  const b = await checkPosition({ chain: none.chain, rpc: none.rpc, marketId: ID, borrower: BORROWER, channels: [] });
  assert.equal(b.assessment.level, 'no-debt');
  assert.match(b.alert.headline, /NO DEBT/);
  const dead = world({ collateral: 21_000n * 10n ** 18n });
  const c = await checkPosition({ chain: dead.chain, rpc: dead.rpc, marketId: ID, borrower: BORROWER, channels: [] });
  assert.equal(c.assessment.level, 'liquidatable');
  assert.match(c.alert.action, /^Act now: repay /);
  assert.ok(c.alert.lines.some((l) => /seize its collateral at a bonus of 2\.62%/.test(l)));
});

test('thresholds are the caller’s: the same position is OK, a warning or critical depending on them', async () => {
  const W = world({ collateral: 30_000n * 10n ** 18n });
  const hf = (await checkPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, channels: [] })).assessment.health.hf;
  assert.ok(hf > 1.3 && hf < 1.6, `health factor ${hf}`);
  const level = async (th) => (await checkPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, thresholds: th, channels: [] })).assessment.level;
  assert.equal(await level({ warn: 1.3, critical: 1.1 }), 'ok');
  assert.equal(await level({ warn: 1.6, critical: 1.2 }), 'warning');
  assert.equal(await level({ warn: 1.8, critical: hf + 0.01 }), 'critical');
});

test('an alert is sent when the level gets worse or recovers, not on every look', () => {
  assert.equal(shouldAlert(null, 'ok'), false);
  assert.equal(shouldAlert(null, 'warning'), true);
  assert.equal(shouldAlert('ok', 'warning'), true);
  assert.equal(shouldAlert('warning', 'warning'), false);
  assert.equal(shouldAlert('warning', 'critical'), true);
  assert.equal(shouldAlert('critical', 'warning'), false, 'improving but still in trouble is not a new alarm');
  assert.equal(shouldAlert('critical', 'ok'), true, 'back to safe is worth saying once');
  assert.equal(shouldAlert('critical', 'liquidatable'), true);
});

test('channels: Discord and Telegram carry the same text; bad webhooks and tokens are refused; only the console is on without configuration', async () => {
  const W = world();
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
  const out = await checkPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, channels: [consoleChannel(() => {}), discordChannel('https://discord.com/api/webhooks/1/abc', fakeFetch), telegramChannel('123456:ABCDEFGHIJKLMNOPQRSTUV', '-100123', fakeFetch)] });
  assert.deepEqual(out.delivered.map((d) => [d.channel, d.ok]), [['console', true], ['discord', true], ['telegram', true]]);
  assert.equal(sent[0].url, 'https://discord.com/api/webhooks/1/abc');
  assert.ok(sent[0].body.content.includes('CRITICAL: health factor'));
  assert.equal(sent[1].url, 'https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUV/sendMessage');
  assert.equal(sent[1].body.chat_id, '-100123');
  assert.ok(sent[1].body.text.includes('→ repay'));
  assert.throws(() => discordChannel('https://evil.example/hook'), /must start with https:\/\/discord\.com/);
  assert.throws(() => telegramChannel('nope', '1'), /bot token/);
  assert.throws(() => telegramChannel('123456:ABCDEFGHIJKLMNOPQRSTUV', 'abc'), /chat id/);
  assert.deepEqual(channelsFromEnv({}).map((c) => c.name), ['console']);
  assert.deepEqual(channelsFromEnv({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc', TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUV', TELEGRAM_CHAT_ID: '5' }).map((c) => c.name), ['console', 'discord', 'telegram']);
});

test('a channel that fails does not stop the others or lose the alert', async () => {
  const W = world();
  const boom = { name: 'boom', send: async () => { throw new Error('network down'); } };
  const lines = [];
  const out = await checkPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, channels: [boom, consoleChannel((s) => lines.push(s))] });
  assert.deepEqual(out.delivered, [{ channel: 'boom', ok: false, error: 'network down' }, { channel: 'console', ok: true }]);
  assert.equal(lines.length, 1);
});

test('runWatchdog gives plain JSON: no BigInt, amounts as strings with their readable text, the steps in order', async () => {
  const W = world();
  const r = await runWatchdog({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER, channels: [] });
  JSON.stringify(r);
  assert.equal(typeof r.position.borrowed, 'string');
  assert.match(r.position.borrowedText, /^[\d,.]+ USDC$/);
  assert.match(r.market.pair, /syzUSD\/USDC/);
  assert.match(r.remedies.repayToTargetText, /USDC$/);
  assert.deepEqual(r.steps.map((s) => s.n), r.steps.map((_, i) => i + 1));
  assert.ok(r.chainCalls >= 2 && r.rpcCalls >= 2);
  assert.equal(r.level, 'critical');
});

test('the console text names the position and ends with the action', () => {
  const read = { borrower: BORROWER, marketId: ID, collateral: { symbol: 'syzUSD' }, loan: { symbol: 'USDC' } };
  const text = consoleText({ at: 'T', headline: 'H', lines: ['a', 'b'], action: 'do it' }, read);
  assert.equal(text, `[T] H\n    position 0x743d7b…972a73 in market ${ID.slice(0, 10)}… (syzUSD/USDC)\n    a\n    b\n    → do it`);
});

// ---- finding borrowers ----------------------------------------------------------------------------------------------------------------------------
test('scanBorrowers asks for windows of at most 1,000 blocks (the node refuses more), newest first, and lists each borrower once', async () => {
  const calls = [];
  const log = (market, who, block) => ({ topics: [TOPICS.Borrow, market, '0x' + addrWord(who), '0x' + addrWord(who)], blockNumber: '0x' + block.toString(16) });
  const rpc = async (method, [f]) => {
    calls.push([Number(BigInt(f.fromBlock)), Number(BigInt(f.toBlock))]);
    const to = Number(BigInt(f.toBlock));
    return to === 100_000 ? [log(ID, '0x' + 'aa'.repeat(20), 99_500), log(ID, '0x' + 'aa'.repeat(20), 99_900)] : to === 99_000 ? [log(ID, '0x' + 'bb'.repeat(20), 98_500)] : [];
  };
  const out = await scanBorrowers({ rpc, head: 100_000, windows: 5, concurrency: 2 });
  assert.equal(calls.length, 5);
  for (const [from, to] of calls) assert.ok(to - from + 1 <= 1000, `window ${from}–${to}`);
  assert.deepEqual(calls.map(([f, t]) => `${f}-${t}`).sort(), ['96001-97000', '97001-98000', '98001-99000', '99001-100000'].concat(['95001-96000']).sort());
  assert.equal(out.borrowers.length, 2);
  assert.equal(out.borrowers[0].borrower, '0x' + 'aa'.repeat(20));
  assert.deepEqual(out.scanned, { from: 95_001, to: 100_000, windows: 5 });
});

test('the event topic is the real Borrow event of Morpho Blue', () => {
  assert.equal(TOPICS.Borrow, '0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43');
});

test('assess and buildAlert never invent a target for a healthy position and name the margin kept', async () => {
  const W = world({ collateral: 40_000n * 10n ** 18n });
  const read = await readPosition({ chain: W.chain, rpc: W.rpc, marketId: ID, borrower: BORROWER });
  const a = assess(read);
  assert.equal(a.level, 'ok');
  assert.match(buildAlert(read, a).action, /^No action needed/);
});
