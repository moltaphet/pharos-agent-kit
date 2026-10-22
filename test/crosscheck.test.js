import test from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck } from '../lib/crosscheck.js';

const six = '0x' + '0'.repeat(63) + '6';
const evidence = [
  { field: 'decimals()', data: '0x313ce567', raw: six },
  { field: 'owner()', data: '0x8da5cb5b', raw: null }, // contract has no owner(): MCP returned nothing
];

test('identical bytes from both sources are a match, and "nothing vs nothing" matches too', async () => {
  const call = async (_m, [{ data }]) => (data === '0x313ce567' ? six.toUpperCase().replace('0X', '0x') : '0x');
  const r = await crossCheck('0xabc', evidence, 100, call);
  assert.equal(r.match, 2);
  assert.equal(r.mismatch, 0);
  assert.equal(r.total, 2);
  assert.equal(r.block, 100);
});

test('different data from the RPC is reported as a mismatch', async () => {
  const r = await crossCheck('0xabc', evidence, 100, async () => '0x' + '0'.repeat(63) + '7');
  assert.equal(r.rows[0].status, 'mismatch');
  assert.equal(r.mismatch, 2); // the RPC returned data where MCP returned none
});

test('an empty RPC answer where MCP had data is inconclusive, never a false mismatch', async () => {
  const r = await crossCheck('0xabc', evidence, 100, async () => '0x');
  assert.equal(r.rows[0].status, 'inconclusive'); // looks like a pruned old block
  assert.match(r.rows[0].note, /pruned/);
  assert.equal(r.rows[1].status, 'match');
  assert.equal(r.mismatch, 0);
});

test('an RPC error is inconclusive and keeps the reason', async () => {
  const r = await crossCheck('0xabc', evidence, 100, async () => {
    throw new Error('timed out after 8000 ms');
  });
  assert.equal(r.inconclusive, 2);
  assert.match(r.rows[0].note, /timed out/);
});

test('the block is sent as hex and the call data is passed through', async () => {
  const seen = [];
  await crossCheck('0xabc', evidence.slice(0, 1), 20914260, async (method, params) => (seen.push({ method, params }), six));
  assert.equal(seen[0].method, 'eth_call');
  assert.equal(seen[0].params[1], '0x13f2054'); // 20,914,260
  assert.deepEqual(seen[0].params[0], { to: '0xabc', data: '0x313ce567' });
});
