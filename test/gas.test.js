import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GWEI, decide, effectivePrice, feesFor, fmtGwei, gasHistory, sampleGas, submitWithin } from '../lib/gas.js';
import { content } from '../public/js/tasks/gas-fee-optimizer.js';

const sample = (baseGwei, { tip = 0n, gasPriceGwei = 10, block = 1 } = {}) => ({ at: 0, block, blockTime: 0, baseFee: BigInt(Math.round(baseGwei * 1e9)), gasPrice: BigInt(gasPriceGwei) * GWEI, tip, fullness: 0 });
// a fake clock and a scripted price series: sampler() answers series[i] and advances time by `tickMs`
function scripted(series, { tickMs = 1000 } = {}) {
  let t = 1_000_000; let i = 0; const log = [];
  return {
    now: () => t, sleep: async (ms) => { t += ms; },
    sampler: async () => { const v = series[Math.min(i++, series.length - 1)]; if (v instanceof Error) throw v; return v; },
    submit: async (fees, s) => { log.push({ fees, s, at: t }); return { hash: '0x' + '1'.repeat(64), gasUsed: 21000, effectiveGasPrice: s.baseFee + s.tip }; },
    log, start: () => t, tickMs,
  };
}

test('decide: favourable when the price is at or below the ceiling, or the history quartile', () => {
  assert.equal(decide({ sample: sample(5), maxPrice: 5n * GWEI }).favorable, true);
  assert.equal(decide({ sample: sample(5.000000001), maxPrice: 5n * GWEI }).favorable, false);
  const history = { stats: { p25: 8n * GWEI } };
  assert.equal(decide({ sample: sample(9, { tip: GWEI }), history }).favorable, false, 'the tip counts: 9 + 1 = 10 > 8 + 1');
  assert.equal(decide({ sample: sample(8), history }).favorable, true);
  assert.throws(() => decide({ sample: sample(1) }), /maxPrice or a gas history/);
});

test('fees: the tip is the suggestion and maxFee has headroom, more at the deadline', () => {
  const s = sample(10, { tip: 2n * GWEI });
  assert.deepEqual(feesFor(s), { maxFeePerGas: 22n * GWEI, maxPriorityFeePerGas: 2n * GWEI });
  assert.equal(feesFor(s, { urgent: true }).maxFeePerGas, 32n * GWEI);
  assert.equal(effectivePrice(s), 12n * GWEI);
});

test('a drop in price releases the hold: submitted as soon as it is favourable', async () => {
  const w = scripted([sample(20), sample(18), sample(9), sample(5)]);
  const r = await submitWithin({ sampler: w.sampler, submit: w.submit, deadlineMs: w.start() + 600_000, maxPrice: 10n * GWEI, pollMs: 5000, now: w.now, sleep: w.sleep });
  assert.equal(r.reason, 'favorable');
  assert.equal(r.samples, 3);
  assert.equal(w.log.length, 1);
  assert.equal(r.atSubmit.baseFee, 9n * GWEI);
  assert.equal(r.atRequest.baseFee, 20n * GWEI);
  assert.equal(r.heldMs, 10_000);
});

test('the deadline is never missed: with a price that never drops it submits at the deadline', async () => {
  const w = scripted([sample(20)]);
  const r = await submitWithin({ sampler: w.sampler, submit: w.submit, deadlineMs: w.start() + 30_000, maxPrice: 1n * GWEI, pollMs: 5000, leadMs: 4000, now: w.now, sleep: w.sleep });
  assert.equal(r.reason, 'deadline');
  assert.equal(r.submittedBeforeDeadline, true);
  assert.ok(r.heldMs >= 26_000 && r.heldMs <= 30_000, `held ${r.heldMs}`);
  assert.equal(w.log[0].fees.maxFeePerGas, 60n * GWEI, 'urgent headroom at the deadline');
});

test('RPC failures while holding: the last good reading is used at the deadline', async () => {
  const w = scripted([sample(20), new Error('rpc down'), new Error('rpc down'), new Error('rpc down'), new Error('rpc down'), new Error('rpc down'), new Error('rpc down')]);
  const r = await submitWithin({ sampler: w.sampler, submit: w.submit, deadlineMs: w.start() + 20_000, maxPrice: 1n * GWEI, pollMs: 5000, leadMs: 2000, now: w.now, sleep: w.sleep });
  assert.equal(r.reason, 'deadline');
  assert.equal(r.atSubmit.baseFee, 20n * GWEI);
  assert.ok(r.holds.some((h) => h.error === 'rpc down'));
});

test('no reading at all until the deadline: it reads once more, and fails loudly if that fails too', async () => {
  const w = scripted([new Error('down')]);
  await assert.rejects(submitWithin({ sampler: w.sampler, submit: w.submit, deadlineMs: w.start() + 3000, maxPrice: GWEI, pollMs: 1000, now: w.now, sleep: w.sleep }), /down/);
  assert.equal(w.log.length, 0, 'nothing was submitted');
});

test('the submission is retried, then reported as failed with the hold log', async () => {
  const w = scripted([sample(1)]);
  let calls = 0;
  const submit = async () => { calls++; throw new Error('nonce too low'); };
  await assert.rejects(submitWithin({ sampler: w.sampler, submit, deadlineMs: w.start() + 10_000, maxPrice: 5n * GWEI, now: w.now, sleep: w.sleep }), (e) => /failed 3 times/.test(e.message) && Array.isArray(e.holds));
  assert.equal(calls, 3);
  let n = 0;
  const flaky = async (...a) => { if (n++ < 2) throw new Error('timeout'); return w.submit(...a); };
  const r = await submitWithin({ sampler: w.sampler, submit: flaky, deadlineMs: w.start() + 10_000, maxPrice: 5n * GWEI, now: w.now, sleep: w.sleep });
  assert.equal(r.reason, 'favorable');
});

test('the report compares what was paid with the price at request time', async () => {
  const w = scripted([sample(10, { gasPriceGwei: 50 })]);
  const r = await submitWithin({ sampler: w.sampler, submit: w.submit, deadlineMs: w.start() + 10_000, maxPrice: 20n * GWEI, now: w.now, sleep: w.sleep });
  assert.equal(r.paid.costWei, 21000n * 10n * GWEI);
  assert.equal(r.naiveCostWei, 21000n * 50n * GWEI);
  assert.equal(r.savedWei, 21000n * 40n * GWEI);
});

test('inputs are validated', async () => {
  const w = scripted([sample(1)]);
  const base = { sampler: w.sampler, submit: w.submit, maxPrice: GWEI, now: w.now, sleep: w.sleep };
  await assert.rejects(submitWithin({ ...base, deadlineMs: w.start() - 1 }), /past/);
  await assert.rejects(submitWithin({ ...base, deadlineMs: NaN }), /timestamp/);
  await assert.rejects(submitWithin({ ...base, deadlineMs: w.start() + 1000, pollMs: 0 }), /pollMs/);
  await assert.rejects(submitWithin({ ...base, sampler: null, deadlineMs: w.start() + 1000 }), /functions/);
});

test('sampleGas and gasHistory read the chain', async () => {
  const block = (n, base) => ({ number: '0x' + n.toString(16), timestamp: '0x' + (1000 + n).toString(16), baseFeePerGas: '0x' + (base * 10 ** 9).toString(16), gasUsed: '0x64', gasLimit: '0x3e8' });
  const rpc = async (m, p) => {
    if (m === 'eth_blockNumber') return '0x2710';
    if (m === 'eth_gasPrice') return '0x' + (10n * GWEI).toString(16);
    if (m === 'eth_maxPriorityFeePerGas') return '0x0';
    if (m === 'eth_getBlockByNumber') { const n = p[0] === 'latest' ? 10_000 : Number(p[0]); return block(n, n < 9_500 ? 2 : 3); }
    throw new Error(m);
  };
  const s = await sampleGas(rpc);
  assert.equal(s.baseFee, 3n * GWEI);
  assert.equal(s.gasPrice, 10n * GWEI);
  assert.equal(s.fullness, 0.1);
  const h = await gasHistory(rpc, { span: 1000, points: 11 });
  assert.equal(h.rows.length, 11);
  assert.equal(h.stats.flat, false);
  assert.equal(h.stats.min, 2n * GWEI);
  assert.equal(h.stats.max, 3n * GWEI);
  await assert.rejects(gasHistory(rpc, { span: 5 }), /span/);
  assert.equal(fmtGwei(1_500_000_000n), '1.5 gwei');
  assert.equal(fmtGwei(10n * GWEI), '10 gwei');
});

test('the recorded run agrees with its claims', () => {
  const r = JSON.parse(readFileSync(new URL('../reports/gas-run.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(r.scenarios.map((s) => [s.id, s]));
  assert.equal(r.summary.allBeforeDeadline, true);
  assert.equal(by['hold-to-deadline'].reason, 'deadline');
  assert.ok(by['hold-to-deadline'].samples >= 5);
  assert.equal(by['favorable-now'].reason, 'favorable');
  assert.ok(BigInt(by.naive.costWei) > BigInt(by['favorable-now'].paid.costWei) * 5n, 'the naive wallet paid several times more');
  for (const s of r.scenarios) assert.equal(s.tx.status, 'success');
  for (const s of r.scenarios.filter((x) => x.id !== 'naive')) assert.equal(String(BigInt(s.paid.effectiveGasPrice) * BigInt(s.paid.gasUsed)), String(s.paid.costWei));
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
