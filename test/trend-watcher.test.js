import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrend, SCENARIOS } from '../lib/tasks/trend-watcher.js';
import { newState } from '../lib/trend.js';

// A chain whose head can move between runs; the metric value depends on the block asked for.
const chainAt = (head, valueAt = (b) => b / 1000) => ({
  callTool: async (name, args) => {
    if (name === 'get_block_number') return { blockNumber: String(head) };
    if (name === 'get_block') return { number: '0x' + args.block.toString(16), timestamp: '0x' + (1_700_000_000 + args.block).toString(16) };
    if (name === 'eth_call') {
      const d = args.transaction.data;
      if (d === '0x313ce567') return { result: '0x' + (6).toString(16).padStart(64, '0') };
      return { result: '0x' + BigInt(Math.round(valueAt(args.block) * 1e6)).toString(16).padStart(64, '0') };
    }
    throw new Error(`unexpected ${name}`);
  },
});
const rule = { direction: 'down', observations: 3 };
const now = () => 'NOW';

test('backfill samples a fixed grid, so a re-run a moment later adds nothing (no near-duplicates)', async () => {
  const first = await runTrend({ chain: chainAt(20_919_213) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 5, step: 20000 }, now);
  assert.equal(first.results.filter((r) => r.added).length, 5);
  // 37 blocks later: the head moved, the grid did not
  const second = await runTrend({ chain: chainAt(20_919_250) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 5, step: 20000, state: first.state }, now);
  assert.equal(second.results.filter((r) => r.added).length, 0, 'same blocks: all skipped');
  assert.equal(second.results.every((r) => r.duplicate), true);
  assert.equal(second.state.observations.length, 5, 'history unchanged');
  assert.deepEqual(second.state.observations.map((o) => o.block), first.state.observations.map((o) => o.block));
});

test('when the head passes ONE more grid point (20,920,000), exactly one new observation appears', async () => {
  const first = await runTrend({ chain: chainAt(20_919_213) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 5, step: 20000 }, now);
  const later = await runTrend({ chain: chainAt(20_925_005) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 5, step: 20000, state: first.state }, now);
  assert.equal(later.results.filter((r) => r.added).length, 1);
  assert.equal(later.state.observations.length, 6);
});

test('"observe" records the current block once, however many times it is called', async () => {
  const a = await runTrend({ chain: chainAt(777) }, { action: 'observe', metric: 'usdc-supply', rule }, now);
  const b = await runTrend({ chain: chainAt(777) }, { action: 'observe', metric: 'usdc-supply', rule, state: a.state }, now);
  assert.equal(a.results[0].added, true);
  assert.equal(b.results[0].added, false);
  assert.equal(b.state.observations.length, 1);
});

test('a real decline in the chain data triggers; a single dip in the chain data does not', async () => {
  const decline = await runTrend({ chain: chainAt(100_000) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 4, step: 1000 }, now);
  assert.equal(decline.state.active, false); // values rise with block number in this stub
  const falling = await runTrend({ chain: chainAt(100_000, (b) => 1000 - b / 1000) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 4, step: 1000 }, now);
  assert.equal(falling.state.active, true);
  assert.equal(falling.state.events[0].type, 'triggered');
  const dip = await runTrend({ chain: chainAt(100_000, (b) => (b === 98000 ? 10 : 100)) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 5, step: 1000 }, now);
  assert.equal(dip.state.events.length, 0, 'a single dip is not a trend');
});

test('scenarios: decline fires once, spike/dip never fire, recovery re-arms', async () => {
  const run = (name) => runTrend({ chain: null }, { action: 'scenario', scenario: name, rule }, now);
  const dec = await run('decline');
  assert.deepEqual(dec.results.map((r) => r.fired), [false, false, true, false, false]);
  assert.equal(dec.source, 'synthetic');
  for (const quiet of ['spike', 'dip']) assert.equal((await run(quiet)).results.some((r) => r.fired), false, quiet);
  const rec = await run('recovery');
  assert.deepEqual(rec.state.events.map((e) => e.type), ['triggered', 'cleared', 'triggered']);
  assert.ok(Object.keys(SCENARIOS).length >= 4);
});

test('bad inputs are rejected', async () => {
  await assert.rejects(runTrend({ chain: chainAt(1) }, { action: 'backfill', metric: 'nope', rule }, now), /metric must be one of/);
  await assert.rejects(runTrend({ chain: chainAt(1000) }, { action: 'backfill', metric: 'usdc-supply', rule, count: 99 }, now), /count must be/);
  await assert.rejects(runTrend({ chain: chainAt(1000) }, { action: 'backfill', metric: 'usdc-supply', rule, step: 5 }, now), /step must be/);
  await assert.rejects(runTrend({ chain: chainAt(1000) }, { action: 'fly', metric: 'usdc-supply', rule }, now), /action must be/);
  await assert.rejects(runTrend({ chain: null }, { action: 'scenario', scenario: 'x', rule }, now), /scenario must be one of/);
  await assert.rejects(runTrend({ chain: null }, { action: 'scenario', scenario: 'decline', rule: { observations: 2 } }, now), /at least 3/);
});
