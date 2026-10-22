import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAddress, decodeString, decodeUint, encodeAddress, formatUnits, isAddress, topicToAddress } from '../lib/abi.js';

// Real eth_call outputs captured from Pharos mainnet USDC.
const NAME_USDC =
  '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000';

test('decodeString reads a dynamic ABI string', () => {
  assert.equal(decodeString(NAME_USDC), 'USDC');
});

test('decodeString falls back to bytes32 names', () => {
  const bytes32 = '0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0');
  assert.equal(decodeString(bytes32), 'MKR');
});

test('decodeString returns null for empty or garbage input', () => {
  assert.equal(decodeString('0x'), null);
  assert.equal(decodeString('0x1234'), null);
});

test('decodeUint / decodeAddress', () => {
  assert.equal(decodeUint('0x' + '0'.repeat(63) + '6'), 6n);
  assert.equal(
    decodeAddress('0x0000000000000000000000009f8ea09770dc38fc61f5a62031b3be0526d54d92'),
    '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92',
  );
  assert.equal(decodeUint('0x'), null);
});

test('encodeAddress left-pads to 32 bytes', () => {
  const enc = encodeAddress('0x9F8EA09770dc38fc61f5a62031b3be0526d54d92');
  assert.equal(enc.length, 64);
  assert.ok(enc.endsWith('9f8ea09770dc38fc61f5a62031b3be0526d54d92'));
});

test('topicToAddress takes the low 20 bytes', () => {
  assert.equal(
    topicToAddress('0x000000000000000000000000768b959191ce5876cabbbc014a08d72615bdde54'),
    '0x768b959191ce5876cabbbc014a08d72615bdde54',
  );
});

test('formatUnits applies decimals and groups thousands', () => {
  assert.equal(formatUnits(39689671923969n, 6), '39,689,671.923969');
  assert.equal(formatUnits(1000000n, 6), '1');
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits(0n, 18), '0');
  assert.equal(formatUnits(5n, 0), '5');
  assert.equal(formatUnits(1n, 18), '<0.000001');
  assert.equal(formatUnits(22160980930709249062054483n, 18), '22,160,980.930709');
});

test('isAddress', () => {
  assert.ok(isAddress('0xc879c018db60520f4355c26ed1a6d572cdac1815'));
  assert.ok(!isAddress('0x1234'));
  assert.ok(!isAddress(undefined));
});
