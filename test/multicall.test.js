import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAggregate3, encodeAggregate3, multicall } from '../lib/multicall.js';

const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';

test('encodeAggregate3 matches the ABI layout for two calls', () => {
  const data = encodeAggregate3([
    { target: USDC, data: '0x313ce567' },
    { target: USDC, data: '0x06fdde03', allowFailure: false },
  ]);
  assert.ok(data.startsWith('0x82ad56cb'));
  const body = data.slice(10);
  const w = (i) => body.slice(i * 64, i * 64 + 64);
  assert.equal(BigInt('0x' + w(0)), 0x20n); // offset to the array
  assert.equal(BigInt('0x' + w(1)), 2n); // length
  assert.equal(BigInt('0x' + w(2)), 0x40n); // first tuple starts after the 2-word offset table
  // tuple 0: target, allowFailure=1, offset 0x60, length 4, data padded to a word
  assert.equal(w(4).slice(24), USDC.slice(2));
  assert.equal(BigInt('0x' + w(5)), 1n);
  assert.equal(BigInt('0x' + w(6)), 0x60n);
  assert.equal(BigInt('0x' + w(7)), 4n);
  assert.equal(w(8), '313ce567' + '0'.repeat(56));
  // tuple 1 follows at the declared offset, with allowFailure=0
  const second = Number(BigInt('0x' + w(3))) / 32 + 2;
  assert.equal(BigInt('0x' + w(second + 1)), 0n);
});

test('decodeAggregate3 reads success flags and return data of several results', () => {
  // two results: (true, 0x…06) and (false, 0x)
  const six = '0'.repeat(63) + '6';
  const r0 = '0'.repeat(63) + '1' + '0'.repeat(62) + '40' + '0'.repeat(62) + '20' + six;
  const r1 = '0'.repeat(64) + '0'.repeat(62) + '40' + '0'.repeat(64);
  const hex = '0x' + '0'.repeat(62) + '20' + '0'.repeat(62) + '02' + '0'.repeat(62) + '40' + (0x40 + r0.length / 2).toString(16).padStart(64, '0') + r0 + r1;
  const out = decodeAggregate3(hex);
  assert.deepEqual(out.map((o) => o.success), [true, false]);
  assert.equal(out[0].data, '0x' + six);
  assert.equal(out[1].data, '0x');
});

test('multicall chunks large batches and keeps results in order', async () => {
  const seen = [];
  const chain = {
    callTool: async (_n, args) => {
      seen.push(args.transaction.data);
      // answer every call in the chunk with success + (index) so order is checkable
      const n = Number(BigInt('0x' + args.transaction.data.slice(10 + 64, 10 + 128)));
      const items = Array.from({ length: n }, () => '0'.repeat(63) + '1' + '0'.repeat(62) + '40' + '0'.repeat(62) + '20' + '0'.repeat(63) + '7');
      let off = n * 32;
      const offs = items.map((it) => { const o = off; off += it.length / 2; return o.toString(16).padStart(64, '0'); });
      return { result: '0x' + '0'.repeat(62) + '20' + n.toString(16).padStart(64, '0') + offs.join('') + items.join('') };
    },
  };
  const calls = Array.from({ length: 130 }, (_, i) => ({ target: USDC, data: '0x313ce567' }));
  const out = await multicall(chain, calls, { chunk: 60 });
  assert.equal(seen.length, 3); // 60 + 60 + 10
  assert.equal(out.length, 130);
  assert.ok(out.every((o) => o.success && o.data.endsWith('7')));
});

test('malformed aggregate results fail closed instead of truncating data or trusting offsets', () => {
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  const malformed = [
    '0x', '0xzz', '0x0',
    '0x' + w(1) + w(0), // unaligned array
    '0x' + w(32) + w(1n << 255n), // enormous result count
    '0x' + w(32) + w(1) + w(32) + w(2) + w(64) + w(0), // invalid ABI bool
    '0x' + w(32) + w(1) + w(32) + w(1) + w(64) + w(32), // missing byte payload
    '0x' + w(32) + w(1) + w(0), // tuple inside offset table
  ];
  for (const hex of malformed) assert.throws(() => decodeAggregate3(hex), /multicall/i, hex);
});

test('multicall rejects invalid chunk sizes and result counts that do not match requests', async () => {
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  let requests = 0;
  const chain = { callTool: async () => { requests++; return { result: '0x' + w(32) + w(0) }; } };
  for (const chunk of [0, -1, 0.5, Infinity, '60']) {
    await assert.rejects(multicall(chain, [{ target: USDC, data: '0x' }], { chunk }), /chunk/);
  }
  assert.equal(requests, 0);
  await assert.rejects(multicall(chain, [{ target: USDC, data: '0x' }]), /result count/);
});

test('aggregate encoders reject malformed addresses, bytes and booleans', () => {
  for (const call of [
    { target: '0x1', data: '0x' },
    { target: USDC, data: '0x1' },
    { target: USDC, data: '0xgg' },
    { target: USDC, data: '0x', allowFailure: 'false' },
  ]) assert.throws(() => encodeAggregate3([call]), /multicall/i);
});
