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

// ---- pinning ---------------------------------------------------------------------------------
import { PIN_LAG, pinnedBlock } from '../lib/chain.js';

test('pinnedBlock reads two blocks behind the head, never below 0', async () => {
  const at = (n) => ({ callTool: async () => ({ blockNumber: String(n) }) });
  assert.equal(PIN_LAG, 2);
  assert.equal(await pinnedBlock(at(20_954_500)), 20_954_498);
  assert.equal(await pinnedBlock(at(1)), 0);
  assert.equal(await pinnedBlock(at(100), 'why', 5), 95);
});

// ---- batched cross-check -------------------------------------------------------------------------
import { encodeAggregate3 as enc } from '../lib/multicall.js';

// Builds the aggregate3 return value for [{success, data}], using the library's own layout knowledge.
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
function aggregateReturn(items) {
  const bodies = items.map(({ success, data }) => {
    const b = data.replace(/^0x/, '');
    const padded = b.padEnd(Math.ceil(b.length / 64) * 64, '0');
    return word(success ? 1 : 0) + word(0x40) + word(b.length / 2) + padded;
  });
  let cursor = items.length * 32;
  const offsets = bodies.map((b) => { const o = word(cursor); cursor += b.length / 2; return o; });
  return '0x' + word(0x20) + word(items.length) + offsets.join('') + bodies.join('');
}

const ev3 = [
  { field: 'name()', data: '0x06fdde03', raw: '0x' + word(1) },
  { field: 'symbol()', data: '0x95d89b41', raw: '0x' + word(2) },
  { field: 'owner()', data: '0x8da5cb5b', raw: null },
];

test('batched cross-check replays every field in ONE request and compares each', async () => {
  const calls = [];
  const call = async (m, params) => { calls.push(params); return aggregateReturn([{ success: true, data: '0x' + word(1) }, { success: true, data: '0x' + word(2) }, { success: false, data: '0x' }]); };
  const r = await crossCheck('0x' + 'c'.repeat(40), ev3, 100, call, { batch: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].to.toLowerCase(), '0xca11bde05977b3631167028862be2a173976ca11'); // Multicall3
  assert.equal(calls[0][0].data, enc(ev3.map((e) => ({ target: '0x' + 'c'.repeat(40), data: e.data }))));
  assert.deepEqual([r.match, r.mismatch, r.inconclusive], [3, 0, 0]); // owner(): neither side has a value, which agrees
});

test('batched cross-check: a differing field is re-read on its own before being called a mismatch', async () => {
  let n = 0;
  const call = async (m, params) => (n++ === 0
    ? aggregateReturn([{ success: true, data: '0x' + word(1) }, { success: true, data: '0x' + word(99) }, { success: false, data: '0x' }])
    : '0x' + word(2)); // the re-read of symbol() agrees with Chain MCP
  const r = await crossCheck('0x' + 'c'.repeat(40), ev3, 100, call, { batch: true });
  assert.equal(r.rows[1].status, 'resolved');
  assert.equal(n, 2);
});

test('batched cross-check falls back to one request per field when the batch fails', async () => {
  let n = 0;
  const call = async (m, params) => { n++; if (params[0].to.toLowerCase().startsWith('0xca11')) throw new Error('multicall not available'); return '0x' + word(n === 2 ? 1 : 2); };
  const r = await crossCheck('0x' + 'c'.repeat(40), ev3, 100, call, { batch: true });
  assert.equal(r.total, 3);
  assert.ok(n >= 4); // 1 failed batch + 3 single calls
});
