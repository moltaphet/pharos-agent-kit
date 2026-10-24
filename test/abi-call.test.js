import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { decodeOutputs, encodeArg, encodeCall, parseSignature } from '../lib/abi-call.js';
import { keccak256, selectorOf } from '../lib/keccak.js';
import { UserError } from '../lib/snapshot.js';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const ADDR = '0x768b959191ce5876cabbbc014a08d72615bdde54';
const hasCast = (() => { try { execFileSync('cast', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('keccak256 matches the published vectors (and is not NIST SHA3)', () => {
  assert.equal(keccak256(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(keccak256('The quick brown fox jumps over the lazy dog'), '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
  assert.notEqual(keccak256(''), 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a', 'SHA3-256 pads differently');
});

test('keccak256 handles inputs at and across the 136-byte block boundary', () => {
  for (const n of [0, 1, 135, 136, 137, 271, 272, 300]) {
    const s = 'a'.repeat(n);
    assert.match(keccak256(s), /^[0-9a-f]{64}$/);
    if (hasCast) assert.equal(keccak256(s), execFileSync('cast', ['keccak', s || '0x'], { encoding: 'utf8' }).trim().slice(2), `length ${n}`);
  }
});

test('selectors match the well-known ones', () => {
  const known = { 'transfer(address,uint256)': '0xa9059cbb', 'approve(address,uint256)': '0x095ea7b3', 'balanceOf(address)': '0x70a08231', 'totalSupply()': '0x18160ddd', 'decimals()': '0x313ce567', 'symbol()': '0x95d89b41', 'latestAnswer()': '0x50d25bcd', 'latestTimestamp()': '0x8205bf6a' };
  for (const [sig, sel] of Object.entries(known)) assert.equal(selectorOf(sig), sel, sig);
});

test('parseSignature reads cast-style signatures, with aliases and whitespace', () => {
  const f = parseSignature(' balanceOf( address ) ( uint ) ');
  assert.deepEqual([f.name, f.inputs, f.outputs, f.signature, f.selector], ['balanceOf', ['address'], ['uint256'], 'balanceOf(address)', '0x70a08231']);
  assert.deepEqual(parseSignature('latestAnswer()(int256)').outputs, ['int256']);
  assert.deepEqual(parseSignature('foo(uint8,bool,bytes4)(address,uint112)').inputs, ['uint8', 'bool', 'bytes4']);
  assert.deepEqual(parseSignature('transfer(address,uint256)').outputs, [], 'outputs may be omitted');
  assert.equal(parseSignature('symbol()(string)').outputs[0], 'string');
});

test('parseSignature refuses what it cannot encode or decode, with the reason', () => {
  const bad = ['', 'latestAnswer', 'a(b', '1abc()(uint256)', 'f(uint7)(uint256)', 'f(uint264)(uint256)', 'f(bytes33)(uint256)', 'f(string)(uint256)', 'f()(string,uint256)', 'f(uint256[])(uint256)', 'f((uint256,uint256))(uint256)', 'f(a,b,c,d,e)(uint256)', null];
  for (const b of bad) assert.throws(() => parseSignature(b), UserError, String(b));
  assert.throws(() => parseSignature('f(string)(uint256)'), /string is only supported as the single return value/);
  assert.throws(() => parseSignature('f(uint256[])(uint256)'), /not supported/);
});

test('encodeCall builds the calldata cast builds', () => {
  assert.equal(encodeCall(parseSignature('balanceOf(address)(uint256)'), [ADDR]), '0x70a08231' + ADDR.slice(2).padStart(64, '0'));
  assert.equal(encodeCall(parseSignature('latestAnswer()(int256)')), '0x50d25bcd');
  assert.equal(encodeCall(parseSignature('transfer(address,uint256)'), [ADDR, '1000000']), '0xa9059cbb' + ADDR.slice(2).padStart(64, '0') + word(1_000_000));
  if (hasCast) {
    const viaCast = execFileSync('cast', ['calldata', 'foo(address,uint8,bool,int16)', ADDR, '7', 'true', '-5'], { encoding: 'utf8' }).trim();
    assert.equal(encodeCall(parseSignature('foo(address,uint8,bool,int16)'), [ADDR, '7', 'true', '-5']), viaCast);
    const withBytes = execFileSync('cast', ['calldata', 'bar(bytes4,uint256)', '0xdeadbeef', '42'], { encoding: 'utf8' }).trim();
    assert.equal(encodeCall(parseSignature('bar(bytes4,uint256)'), ['0xdeadbeef', '42']), withBytes);
  }
});

test('encodeArg checks every value against its type', () => {
  for (const [type, v] of [['address', '0x12'], ['bool', 'maybe'], ['uint8', '256'], ['uint8', '-1'], ['int8', '128'], ['int8', '-129'], ['uint256', '1.5'], ['uint256', 'abc'], ['bytes4', '0xdeadbe'], ['bytes4', 'deadbeef']]) assert.throws(() => encodeArg(type, v), UserError, `${type} ${v}`);
  assert.equal(encodeArg('uint8', '255'), word(255));
  assert.equal(encodeArg('int8', '-128'), 'f'.repeat(62) + '80');
  assert.equal(encodeArg('uint256', '0x10'), word(16));
  assert.equal(encodeArg('bytes4', '0xDEADBEEF'), 'deadbeef' + '0'.repeat(56));
  assert.throws(() => encodeCall(parseSignature('balanceOf(address)(uint256)'), []), /takes 1 argument, 0 given/);
});

test('decodeOutputs: integers (two’s complement), addresses, bools, bytesN', () => {
  assert.equal(decodeOutputs(['uint256'], '0x' + word(30472196509250))[0].value, 30472196509250n);
  assert.equal(decodeOutputs(['int256'], '0x' + 'f'.repeat(64))[0].value, -1n);
  assert.equal(decodeOutputs(['int256'], '0x' + word(80456378420027975000000n))[0].text, '80456378420027975000000');
  assert.equal(decodeOutputs(['uint8'], '0x' + word(18))[0].value, 18n);
  assert.equal(decodeOutputs(['address'], '0x' + ADDR.slice(2).padStart(64, '0'))[0].value, ADDR);
  assert.equal(decodeOutputs(['bool'], '0x' + word(1))[0].value, true);
  assert.equal(decodeOutputs(['bytes4'], '0xdeadbeef' + '0'.repeat(56))[0].value, '0xdeadbeef');
  const two = decodeOutputs(['uint112', 'uint112', 'uint32'], '0x' + word(5) + word(6) + word(7));
  assert.deepEqual(two.map((x) => x.value), [5n, 6n, 7n]);
});

test('decodeOutputs: strings and bytes', () => {
  const enc = (s) => '0x' + word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');
  assert.equal(decodeOutputs(['string'], enc('SelfManagedFeedsCacheProxy'))[0].value, 'SelfManagedFeedsCacheProxy');
  assert.equal(decodeOutputs(['bytes'], '0x' + word(0x20) + word(2) + 'abcd'.padEnd(64, '0'))[0].value, '0xabcd');
});

test('decodeOutputs refuses data that is not the declared type, instead of printing nonsense', () => {
  assert.throws(() => decodeOutputs(['uint256'], '0x'), /returned no data/);
  assert.throws(() => decodeOutputs(['uint256'], '0x1234'), /needs 32/);
  assert.throws(() => decodeOutputs(['uint256'], 'zz'), /not valid hex/);
  assert.throws(() => decodeOutputs(['uint8'], '0x' + word(300)), /does not fit in uint8/);
  assert.throws(() => decodeOutputs(['address'], '0x' + 'f'.repeat(64)), /not an address/);
  assert.throws(() => decodeOutputs(['bool'], '0x' + word(2)), /neither 0 nor 1/);
  assert.throws(() => decodeOutputs(['string'], '0x' + word(0x20) + word(99) + 'aa'), /malformed/);
  assert.throws(() => decodeOutputs(['string'], '0x' + word(1)), /too short/);
  assert.deepEqual(decodeOutputs([], '0x'), []);
});
