import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, scanPair } from '../lib/tasks/arbitrage-scanner.js';

const noChain = { callTool: async () => { throw new Error('fixtures must not touch the chain'); } };
const scan = (pair, cfg, src) => scanPair({ chain: noChain }, pair, cfg, src);

test('profitable synthetic scenario: gap above the fees, so it acts (simulated)', async () => {
  const r = await scan('WPROS/DLP', { size: 50 }, 'profitable');
  assert.equal(r.decision, 'execute-simulated');
  assert.ok(Math.abs(r.grossSpreadPct - 3) < 0.01, `spread ${r.grossSpreadPct}`);
  assert.equal(r.route.buyOn, 'FaroSwap V2');
  assert.match(r.route.sellOn, /FaroSwap V3/);
  assert.ok(r.net > 0.8 && r.net < 1, `net ${r.net}`);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.fill.simulated, true);
  assert.ok(Math.abs(r.fill.profit - r.net) < 1e-12);
  assert.equal(r.sourceLabel, FIXTURES.profitable.label);
});

test('the working adds up: gross − fees − price impact = net before gas', async () => {
  const r = await scan('WPROS/DLP', { size: 50 }, 'profitable');
  assert.ok(Math.abs(r.gross - r.costs.fees - r.costs.priceImpact - r.netBeforeGas) < 1e-9);
  assert.ok(Math.abs(r.net - (r.netBeforeGas - r.costs.gas)) < 1e-12);
  assert.ok(r.costs.gas > 0.002 && r.costs.gas < 0.004); // 270k gas at 10 gwei = 0.0027 PROS
});

test('marginal scenario: the gap is smaller than the fees, so it skips and says why', async () => {
  const r = await scan('WPROS/DLP', { size: 50 }, 'marginal');
  assert.equal(r.decision, 'skip');
  assert.equal(r.fill, null);
  assert.match(r.reasons.join(' '), /below the minimum 0.001 WPROS/);
  assert.ok(r.net < 0);
});

test('the profit threshold is configurable', async () => {
  const strict = await scan('WPROS/DLP', { size: 50, minNet: 5 }, 'profitable');
  assert.equal(strict.decision, 'skip');
  assert.match(strict.reasons[0], /below the minimum 5 WPROS/);
  const lenient = await scan('WPROS/DLP', { size: 50, minNet: 0.5 }, 'profitable');
  assert.equal(lenient.decision, 'execute-simulated');
});

test('gas that cannot be priced in the quote token blocks acting instead of guessing', async () => {
  const r = await scan('UNI-V2/PDOG', { size: 50 }, 'profitable');
  assert.equal(r.decision, 'skip');
  assert.equal(r.costs.gas, null);
  assert.match(r.reasons.join(' '), /gas is paid in PROS/);
});

test('depth is reported next to the spread, and the size curve is ordered', async () => {
  const r = await scan('WPROS/DLP', { size: 50 }, 'profitable');
  assert.ok(r.depth.v2Quote > 1000);
  assert.ok(r.depth.v3RangeSellBase > 0);
  assert.deepEqual(r.curve.map((c) => c.size), [...r.curve.map((c) => c.size)].sort((a, b) => a - b));
  assert.equal(r.thinPool, false);
});

test('bad inputs are rejected with precise messages', async () => {
  await assert.rejects(scan('NOPE/PAIR', {}, 'profitable'), /pair must be one of/);
  await assert.rejects(scan('WPROS/DLP', {}, 'bogus'), /source must be live or one of/);
  await assert.rejects(scan('WPROS/DLP', { size: 0 }, 'profitable'), /size must be greater than 0/);
  await assert.rejects(scan('WPROS/DLP', { size: NaN }, 'profitable'), /size must be a number/);
});
