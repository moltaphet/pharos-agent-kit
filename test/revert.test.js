import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRevert, parseMcpRevert } from '../lib/revert.js';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => a.replace('0x', '').padStart(64, '0');
// Captured from the live Pharos USDC contract: Error("ERC20: transfer amount exceeds balance")
const LIVE_ERROR = '0x08c379a0' + word(0x20) + word(38) + Buffer.from('ERC20: transfer amount exceeds balance').toString('hex').padEnd(64 * 2, '0');

test('decodes Error(string) from a real USDC revert', () => {
  const r = decodeRevert(LIVE_ERROR, 'execution reverted: ERC20: transfer amount exceeds balance');
  assert.equal(r.kind, 'Error');
  assert.equal(r.message, 'ERC20: transfer amount exceeds balance');
});

test('an empty revert is reported as such, keeping the node message', () => {
  assert.deepEqual(decodeRevert('0x', 'execution reverted: ').kind, 'empty');
  assert.match(decodeRevert('0x', 'execution reverted: ').message, /without a reason/);
  assert.equal(decodeRevert('', 'execution reverted: no way').message, 'no way');
});

test('decodes Panic codes', () => {
  assert.match(decodeRevert('0x4e487b71' + word(0x11)).message, /arithmetic overflow or underflow \(code 0x11\)/);
  assert.match(decodeRevert('0x4e487b71' + word(0x32)).message, /array index out of bounds/);
});

test('decodes known custom errors with their arguments', () => {
  const holder = '0x1111111111111111111111111111111111111111';
  const r = decodeRevert('0xe450d38c' + addr(holder) + word(5) + word(100));
  assert.equal(r.name, 'ERC20InsufficientBalance');
  assert.match(r.message, /holds 5 but needs 100/);
  assert.match(r.message, /0x1111111111111111111111111111111111111111/);
  assert.equal(decodeRevert('0xd92e233d').message, 'ZeroAddress: a zero address was passed');
  assert.equal(decodeRevert('0xd93c0665').message, 'EnforcedPause: the contract is paused');
});

test('an unknown custom error keeps its selector so it can be looked up', () => {
  const r = decodeRevert('0xabcdef12' + word(1));
  assert.equal(r.kind, 'custom');
  assert.equal(r.selector, '0xabcdef12');
  assert.match(r.message, /custom error 0xabcdef12/);
});

test('parseMcpRevert reads the JSON Chain MCP puts in a tool error', () => {
  const e = new Error('eth_call: { "error": { "message": "execution reverted: nope", "code": 3, "data": "0x" } }');
  assert.deepEqual(parseMcpRevert(e), { message: 'execution reverted: nope', data: '0x', code: 3 });
  assert.equal(parseMcpRevert(new Error('Timed out')), null);
  assert.equal(parseMcpRevert(new Error('{ not json }')), null);
});
