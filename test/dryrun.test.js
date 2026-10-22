import test from 'node:test';
import assert from 'node:assert/strict';
import { dryRun, guardedExecute, parseTx } from '../lib/tasks/dry-run-executor.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const revertErr = (message, data = '0x') => new Error(`eth_call: ${JSON.stringify({ error: { message, code: 3, data } })}`);
const errorString = (s) => '0x08c379a0' + word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');

// A scripted chain: `behaviour` decides what eth_call / estimate_gas do.
function chain({ call = () => ({ result: '0x' }), gas = () => ({ gas: '21000' }) } = {}) {
  const seen = [];
  return {
    seen,
    callTool: async (name, args) => {
      seen.push(name);
      if (name === 'get_block_number') return { blockNumber: '500' };
      if (name === 'get_gas_price') return { gasPriceWei: '10000000000', gasPriceGwei: '10' };
      if (name === 'get_balance') return { balanceWei: '5000000000000000000' };
      if (name === 'get_code') return { code: '0x6080' };
      if (name === 'eth_call') {
        const d = args.transaction.data;
        if (d === '0x95d89b41') return { result: '0x' + word(0x20) + word(4) + Buffer.from('USDC').toString('hex').padEnd(64, '0') };
        if (d === '0x313ce567') return { result: '0x' + word(6) };
        if (d.startsWith('0x70a08231')) return { result: '0x' + word(2_000_000) };
        if (d.startsWith('0xdd62ed3e')) return { result: '0x' + word(0) };
        const r = call(args);
        if (r instanceof Error) throw r;
        return r;
      }
      if (name === 'estimate_gas') {
        const r = gas(args);
        if (r instanceof Error) throw r;
        return r;
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
}
const transfer = (amount) => ({ from: A, to: '0xc879c018db60520f4355c26ed1a6d572cdac1815', data: '0xa9059cbb' + B.slice(2).padStart(64, '0') + word(amount) });

test('parseTx rejects malformed input with precise messages', () => {
  assert.throws(() => parseTx({ to: B }), /from must be a 0x address/);
  assert.throws(() => parseTx({ from: A, to: '0x12' }), /to must be a 0x address/);
  assert.throws(() => parseTx({ from: A, to: B, data: '0xzz' }), /data must be 0x followed by whole bytes/);
  assert.throws(() => parseTx({ from: A, to: B, data: '0xabc' }), /whole bytes/);
  assert.throws(() => parseTx({ from: A, to: B, value: '1.5' }), /value must be a whole number of wei/);
  assert.equal(parseTx({ from: A, to: B, value: '0x10' }).value, 16n);
});

test('a succeeding transfer is GO, with gas cost and a before/after prediction', async () => {
  const r = await dryRun({ chain: chain() }, transfer(1_000_000));
  assert.equal(r.verdict, 'go');
  assert.equal(r.prediction, 'success');
  assert.equal(r.gas.units, 21000);
  assert.equal(r.gas.suggestedLimit, 25200); // +20%
  assert.equal(r.gas.costPros, '0.00021'); // 21,000 gas × 10 gwei
  assert.equal(r.outcome.kind, 'erc20-transfer');
  assert.deepEqual(r.outcome.rows[0], { label: '0x1111…1111 USDC', before: '2 USDC', after: '1 USDC' });
  assert.equal(r.outcome.rows[1].after, '3 USDC');
});

test('a reverting call is BLOCKED and the reason is decoded', async () => {
  const bad = revertErr('execution reverted: ERC20: transfer amount exceeds balance', errorString('ERC20: transfer amount exceeds balance'));
  const r = await dryRun({ chain: chain({ call: () => bad, gas: () => bad }) }, transfer(9_000_000));
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.prediction, 'revert');
  assert.equal(r.revert.message, 'ERC20: transfer amount exceeds balance');
  assert.equal(r.gas, null);
  assert.equal(r.outcome.rows[0].after, 'unchanged (it would revert)');
  assert.match(r.summary, /simulation failed: ERC20: transfer amount exceeds balance/);
});

test('if only estimate_gas reverts the transaction is still blocked', async () => {
  const bad = revertErr('execution reverted: ');
  const r = await dryRun({ chain: chain({ gas: () => bad }) }, transfer(1));
  assert.equal(r.verdict, 'blocked');
  assert.equal(r.revert.kind, 'empty');
});

test('a network failure is surfaced as an error, not reported as a revert', async () => {
  await assert.rejects(dryRun({ chain: chain({ call: () => new Error('Timed out talking to the node') }) }, transfer(1)), /Timed out/);
});

test('approve and native value outcomes are predicted', async () => {
  const approve = { from: A, to: '0xc879c018db60520f4355c26ed1a6d572cdac1815', data: '0x095ea7b3' + B.slice(2).padStart(64, '0') + word(5_000_000) };
  const a = await dryRun({ chain: chain() }, approve);
  assert.equal(a.outcome.kind, 'erc20-approve');
  assert.deepEqual([a.outcome.rows[0].before, a.outcome.rows[0].after], ['0 USDC', '5 USDC']);
  const n = await dryRun({ chain: chain() }, { from: A, to: B, data: '0x', value: '1000000000000000000' });
  assert.equal(n.outcome.kind, 'native-transfer');
  assert.match(n.outcome.rows[0].after, /4 PROS/);
});

test('THE GATE: a failed simulation never reaches the executor', async () => {
  const bad = revertErr('execution reverted: nope');
  const sent = [];
  const exec = { send: async (tx) => (sent.push(tx), '0xhash') };
  const r = await guardedExecute({ chain: chain({ call: () => bad, gas: () => bad }), exec }, transfer(1));
  assert.equal(r.blocked, true);
  assert.equal(r.executed, false);
  assert.deepEqual(sent, [], 'send must not be called after a failed simulation');
  assert.match(r.reason, /simulation failed/);
});

test('THE GATE: a successful simulation is handed to the executor exactly once', async () => {
  const sent = [];
  const exec = { send: async (tx) => (sent.push(tx), '0xhash') };
  const r = await guardedExecute({ chain: chain(), exec }, transfer(1_000_000));
  assert.equal(r.executed, true);
  assert.equal(r.sent, '0xhash');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, A);
  assert.equal(sent[0].data.slice(0, 10), '0xa9059cbb');
});
