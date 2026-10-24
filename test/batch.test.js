import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, parseAmount, planBatch } from '../lib/tasks/batch-executor.js';
import { encodeAggregate3Value } from '../lib/multicall.js';
import { MULTICALL3 } from '../lib/protocols.js';

const FROM = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
const A = (n) => '0x' + String(n).repeat(40);
const revert = (m = 'execution reverted: ') => new Error(`x: ${JSON.stringify({ error: { message: m, code: 3, data: '0x' } })}`);
// A chain stub. `failing` is a set of target addresses whose individual simulation reverts.
function chain({ failing = [], batchFails = false, gas = { solo: 80_000, batch: 200_000 }, noCode = [] } = {}) {
  return {
    callTool: async (name, args) => {
      if (name === 'get_block_number') return { blockNumber: '10' };
      if (name === 'get_code') return { result: noCode.includes(args.address) ? '0x' : '0x6080' };
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

test('an action with data aimed at an address without code is refused, because a simulation can never fail there', async () => {
  const plan = await planBatch({ chain: chain({ noCode: [A(2)] }) }, { from: FROM, actions: four });
  assert.deepEqual(plan.included, ['a1', 'a3', 'a4']);
  const bad = plan.actions.find((a) => a.id === 'a2');
  assert.equal(bad.status, 'fails');
  assert.match(bad.reason, /no contract code at 0x2222.* on block 8/);
});

test('a plain value transfer (no data) to an account without code is fine', async () => {
  const plan = await planBatch({ chain: chain({ noCode: [A(1), A(2), A(3)] }) }, { from: FROM, actions: [1, 2, 3].map((n) => ({ to: A(n), amountPros: '0.001' })) });
  assert.equal(plan.verdict, 'ready');
  assert.equal(plan.included.length, 3);
});

// ---- found by stress-testing --------------------------------------------------------------------------------------------------------
test('an action that is not an object, or has the wrong types, is a precise error (it used to end as a crash)', () => {
  const ok = [{ to: A(1) }, { to: A(2) }];
  for (const bad of [null, 1, 'x', [], true]) assert.throws(() => parseActions([...ok, bad]), (e) => e.constructor.name === 'UserError' && /action 3 must be an object/.test(e.message), JSON.stringify(bad));
  assert.throws(() => parseActions([...ok, { to: A(3), data: 5 }]), /"data" must be a 0x hex string/);
  assert.throws(() => parseActions([...ok, { to: 5 }]), /"to" must be a 0x address/);
  assert.throws(() => parseActions([...ok, { to: A(3), amountPros: { a: 1 } }]), /"amountPros" must be a decimal number/);
  assert.equal(parseActions([...ok, { to: A(3), amountPros: 1 }])[2].value, 10n ** 18n, 'a JSON number is fine');
});

test('ids are short labels and unique, so a failure can always be named', () => {
  const ok = [{ to: A(1) }, { to: A(2) }];
  assert.throws(() => parseActions([{ id: 'x', to: A(1) }, { id: 'x', to: A(2) }, { to: A(3) }]), /the id "x" is used twice/);
  for (const id of [{ a: 1 }, 5, '', '<img src=x onerror=alert(1)>', 'x'.repeat(41)]) assert.throws(() => parseActions([{ id, to: A(1) }, ...ok]), /"id" must be a short label/, JSON.stringify(id));
  assert.equal(parseActions([{ id: 'pay rent #1'.replace('#', ''), to: A(1) }, ...ok])[0].id, 'pay rent 1');
});

test('calls that depend on who sends them are refused: a wrapped-token deposit would credit Multicall3, an NFT or vault call would act as Multicall3', () => {
  const ok = [{ to: A(1) }, { to: A(2) }];
  const calls = { '0xd0e30db0': /wrapped-token deposit/, '0x2e1a7d4d': /wrapped-token withdrawal/, '0x42842e0e': /NFT transfer/, '0xb88d4fde': /NFT transfer/, '0xf242432a': /ERC-1155/, '0xa22cb465': /approval for all/, '0x6e553f65': /vault deposit/, '0xba087652': /vault redemption/, '0x39509351': /allowance increase/ };
  for (const [sel, re] of Object.entries(calls)) assert.throws(() => parseActions([...ok, { to: A(3), data: sel + '00'.repeat(64) }]), re, sel);
  assert.doesNotThrow(() => parseActions([...ok, { to: A(3), data: '0xfff6cae9' }]), 'a sender-independent call is still fine');
});

test('the comparison says whether the batch is cheaper, so "ready" is never mistaken for "worth it"', async () => {
  const dear = await planBatch({ chain: chain({ gas: { solo: 21_000, batch: 135_000 } }) }, { from: FROM, actions: four });
  assert.equal(dear.comparison.cheaper, false);
  assert.match(dear.summary, /costs/);
  const cheap = await planBatch({ chain: chain({ gas: { solo: 80_000, batch: 200_000 } }) }, { from: FROM, actions: four });
  assert.equal(cheap.comparison.cheaper, true);
});
