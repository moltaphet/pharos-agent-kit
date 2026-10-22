import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, parseAmount, planBatch } from '../lib/tasks/batch-executor.js';
import { encodeAggregate3Value } from '../lib/multicall.js';
import { MULTICALL3 } from '../lib/protocols.js';

const FROM = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
const A = (n) => '0x' + String(n).repeat(40);
const revert = (m = 'execution reverted: ') => new Error(`x: ${JSON.stringify({ error: { message: m, code: 3, data: '0x' } })}`);
// A chain stub. `failing` is a set of target addresses whose individual simulation reverts.
function chain({ failing = [], batchFails = false, gas = { solo: 80_000, batch: 200_000 } } = {}) {
  return {
    callTool: async (name, args) => {
      if (name === 'get_block_number') return { blockNumber: '10' };
      const t = args.transaction;
      const isBatch = t.to === MULTICALL3;
      if (isBatch && batchFails) throw revert('execution reverted: Multicall3: call failed');
      if (!isBatch && failing.includes(t.to)) throw revert();
      if (name === 'eth_call') return { result: '0x' };
      if (name === 'estimate_gas') return { gas: String(isBatch ? gas.batch : gas.solo) };
      throw new Error(`unexpected ${name}`);
    },
  };
}
const four = [{ to: A(1), data: '0xfff6cae9' }, { to: A(2), data: '0xfff6cae9' }, { to: A(3), data: '0xfff6cae9' }, { to: A(4), data: '0xfff6cae9' }];

test('amounts are exact decimals of PROS', () => {
  assert.equal(parseAmount('0.001'), 10n ** 15n);
  assert.equal(parseAmount('1.000000000000000001'), 10n ** 18n + 1n);
  assert.equal(parseAmount(undefined), 0n);
  assert.throws(() => parseAmount('1.5e3', 'x'), /decimal number of PROS/);
  assert.throws(() => parseAmount('-1', 'x'), /decimal number/);
});

test('a batch needs at least 3 actions', () => {
  assert.throws(() => parseActions([{ to: A(1) }, { to: A(2) }]), /at least 3 independent actions \(got 2\)/);
  assert.throws(() => parseActions('no'), /JSON array/);
  assert.equal(parseActions(four).length, 4);
});

test('actions that depend on msg.sender are refused, with the reason', () => {
  const transfer = { to: A(5), data: '0xa9059cbb' + '0'.repeat(128) };
  for (const [data, label] of [['0xa9059cbb', 'ERC-20 transfer'], ['0x095ea7b3', 'ERC-20 approval'], ['0x23b872dd', 'ERC-20 transferFrom']]) {
    assert.throws(() => parseActions([...four.slice(0, 3), { to: A(5), data: data + '0'.repeat(128) }]), new RegExp(`is an ${label}.*Multicall3.*anyone`, 's'));
  }
  assert.ok(transfer);
});

test('malformed actions are rejected precisely', () => {
  assert.throws(() => parseActions([{ to: '0x12' }, ...four.slice(0, 2)]), /"to" must be a 0x address/);
  assert.throws(() => parseActions([{ to: A(1), data: '0xzz' }, ...four.slice(0, 2)]), /whole bytes/);
});

test('all pass: one transaction, with the gas comparison and a prepared (unsigned) tx', async () => {
  const p = await planBatch({ chain: chain() }, { from: FROM, actions: four });
  assert.equal(p.verdict, 'ready');
  assert.deepEqual(p.included, ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(p.excluded, []);
  assert.equal(p.comparison.transactionsBefore, 4);
  assert.equal(p.comparison.transactionsAfter, 1);
  assert.equal(p.comparison.soloGasTotal, 320_000);
  assert.equal(p.comparison.gasSaved, 120_000);
  assert.ok(Math.abs(p.comparison.gasSavedPct - 37.5) < 1e-9);
  assert.equal(p.batch.to, MULTICALL3);
  assert.equal(p.batch.tx.from, FROM);
  assert.equal(p.batch.tx.data, encodeAggregate3Value(four.map((a) => ({ target: a.to, data: a.data, value: 0n, allowFailure: false }))));
  assert.ok(!('privateKey' in p.batch.tx));
});

test('policy exclude: the failing action is named and left out, the rest are batched', async () => {
  const p = await planBatch({ chain: chain({ failing: [A(3)] }) }, { from: FROM, actions: four, onFailure: 'exclude' });
  assert.equal(p.verdict, 'ready');
  assert.deepEqual(p.included, ['a1', 'a2', 'a4']);
  assert.equal(p.excluded.length, 1);
  assert.equal(p.excluded[0].id, 'a3');
  assert.match(p.excluded[0].why, /would fail/);
  assert.equal(p.actions.find((a) => a.id === 'a3').status, 'fails');
  assert.equal(p.batch.calls, 3);
  assert.equal(p.comparison.transactionsBefore, 3);
});

test('policy abort: if any action fails nothing is prepared and everything is reported', async () => {
  const p = await planBatch({ chain: chain({ failing: [A(2)] }) }, { from: FROM, actions: four, onFailure: 'abort' });
  assert.equal(p.verdict, 'nothing-to-send');
  assert.equal(p.batch, null);
  assert.deepEqual(p.included, []);
  assert.equal(p.excluded.length, 4);
  assert.match(p.summary, /a2 would fail, so nothing was prepared/);
  assert.match(p.excluded.find((x) => x.id === 'a1').why, /policy is abort/);
});

test('every action passes alone but the batch would fail: reported, not hidden', async () => {
  const p = await planBatch({ chain: chain({ batchFails: true }) }, { from: FROM, actions: four });
  assert.equal(p.verdict, 'batch-would-fail');
  assert.match(p.summary, /passed alone but the batch would fail: Multicall3: call failed/);
  assert.equal(p.batch.gas, null);
});

test('a batch that costs MORE gas is reported as such, not as a saving', async () => {
  const p = await planBatch({ chain: chain({ gas: { solo: 21_000, batch: 135_000 } }) }, { from: FROM, actions: four.slice(0, 3) });
  assert.ok(p.comparison.gasSaved < 0);
  assert.match(p.summary, /costs 72,000 gas/);
});

test('values are summed into the single payment', async () => {
  const acts = [{ to: A(1), amountPros: '0.001' }, { to: A(2), amountPros: '0.002' }, { to: A(3), amountPros: '0.003' }];
  const p = await planBatch({ chain: chain() }, { from: FROM, actions: acts });
  assert.equal(p.batch.valuePros, '0.006');
  assert.equal(p.batch.tx.value, '0x' + (6n * 10n ** 15n).toString(16));
});

test('bad policy and sender are rejected', async () => {
  await assert.rejects(planBatch({ chain: chain() }, { from: '0x1', actions: four }), /from must be a 0x address/);
  await assert.rejects(planBatch({ chain: chain() }, { from: FROM, actions: four, onFailure: 'yolo' }), /onFailure must be/);
});
