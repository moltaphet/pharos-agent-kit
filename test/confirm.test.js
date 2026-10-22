import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmReads } from '../lib/confirm.js';
import { crossCheck } from '../lib/crosscheck.js';
import { UnstableReadError, stableRead } from '../lib/stable.js';
import { startTrace, traceStore } from '../lib/trace.js';

// A fake client that answers from a script and counts calls.
const fake = (script) => {
  const calls = [];
  return {
    calls,
    marker: 'original',
    describe() { return this.marker; },
    async callTool(name, args, meta) {
      const i = calls.push({ name, args, why: meta?.why }) - 1;
      const v = typeof script === 'function' ? script(i, name) : script[Math.min(i, script.length - 1)];
      if (v instanceof Error) throw v;
      return v;
    },
  };
};
const toolError = () => Object.assign(new Error('execution reverted'), { tool: true });
const call = { transaction: { to: '0x1', data: '0x2' }, block: 100 };

test('a pinned read is read twice and accepted when both agree', async () => {
  const c = fake(['0xaa']);
  assert.equal(await confirmReads(c).callTool('eth_call', call, { why: 'x' }), '0xaa');
  assert.equal(c.calls.length, 2);
  assert.match(c.calls[1].why, /confirming read/);
});

test('when the first two reads disagree a third decides by majority', async () => {
  const c = fake(['0xbad', '0xaa', '0xaa']);
  assert.equal(await confirmReads(c).callTool('eth_call', call, { why: 'x' }), '0xaa');
  assert.equal(c.calls.length, 3);
  const c2 = fake(['0xaa', '0xbad', '0xaa']);
  assert.equal(await confirmReads(c2).callTool('eth_call', call, { why: 'x' }), '0xaa');
});

test('three different answers: refuses with UnstableReadError and never returns a value', async () => {
  const c = fake(['0x1', '0x2', '0x3']);
  await assert.rejects(confirmReads(c).callTool('get_balance', { address: '0x1', block: 5 }, { why: 'x' }), UnstableReadError);
});

test('reads of "latest" and non-state tools are passed through once', async () => {
  const c = fake(['0xaa']);
  const w = confirmReads(c);
  await w.callTool('eth_call', { transaction: {} }, { why: 'x' }); // no block
  await w.callTool('eth_call', { transaction: {}, block: 'latest' }, { why: 'x' });
  await w.callTool('get_gas_price', {}, { why: 'x' });
  await w.callTool('get_logs', { block: 5 }, { why: 'x' });
  assert.equal(c.calls.length, 4);
});

test('a revert (tool error) on the first read propagates unchanged and is not re-read', async () => {
  const c = fake([toolError()]);
  await assert.rejects(confirmReads(c).callTool('eth_call', call, { why: 'x' }), (e) => e.tool === true);
  assert.equal(c.calls.length, 1);
});

test('object results (block headers) are compared by value', async () => {
  const c = fake([{ number: '0x64', timestamp: '0x1' }]);
  assert.deepEqual(await confirmReads(c).callTool('get_block', { block: 100 }, { why: 'x' }), { number: '0x64', timestamp: '0x1' });
  const wrong = fake([{ number: '0x63', timestamp: '0x1' }, { number: '0x64', timestamp: '0x1' }, { number: '0x64', timestamp: '0x1' }]);
  assert.equal((await confirmReads(wrong).callTool('get_block', { block: 100 }, { why: 'x' })).number, '0x64');
});

test('reads inside stableRead are not confirmed a second time', async () => {
  const c = fake(['0xaa']);
  const w = confirmReads(c);
  const { value } = await stableRead(async () => String(await w.callTool('eth_call', call, { why: 'x' })), { label: 't' });
  assert.equal(value, '0xaa');
  assert.equal(c.calls.length, 2); // stableRead's own two reads, not four
});

test('other methods and properties still reach the original client', () => {
  const c = fake(['0xaa']);
  assert.equal(confirmReads(c).describe(), 'original');
  assert.equal(confirmReads(c).marker, 'original');
});

test('a disagreement is recorded in the trace as a decision', async () => {
  const store = startTrace();
  await traceStore.run(store, () => confirmReads(fake(['0xbad', '0xaa', '0xaa'])).callTool('eth_call', call, { why: 'x' }));
  const d = store.entries.find((e) => e.kind === 'decision');
  assert.ok(d && d.ok === true && /majority/.test(d.title));
});

// ---- cross-check against the public RPC -------------------------------------------
const ev = [{ field: 'totalSupply()', data: '0x18160ddd', raw: '0x05' }];

test('RPC first answer differs but a re-read agrees: resolved, not a mismatch', async () => {
  const answers = ['0x09', '0x05'];
  const r = await crossCheck('0xc', ev, 100, async () => answers.shift());
  assert.equal(r.rows[0].status, 'resolved');
  assert.deepEqual([r.match, r.resolved, r.mismatch], [0, 1, 0]);
});

test('RPC keeps disagreeing: still a mismatch', async () => {
  const r = await crossCheck('0xc', ev, 100, async () => '0x09');
  assert.equal(r.mismatch, 1);
  assert.equal(r.resolved, 0);
});
