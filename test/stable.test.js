import test from 'node:test';
import assert from 'node:assert/strict';
import { UnstableReadError, stableHeader, stableRead } from '../lib/stable.js';

const script = (...vals) => { let i = 0; return async () => vals[i++]; };

test('two agreeing reads are accepted after exactly two reads', async () => {
  const r = await stableRead(script('A', 'A', 'B'));
  assert.deepEqual(r, { value: 'A', reads: 2 });
});

test('a wrong first read is outvoted by two later agreeing reads', async () => {
  const r = await stableRead(script('24401221', '48259972', '48259972'));
  assert.deepEqual(r, { value: '48259972', reads: 3 });
});

test('a wrong second read is outvoted too', async () => {
  const r = await stableRead(script('A', 'X', 'A'));
  assert.equal(r.value, 'A');
});

test('three different answers are reported as unstable, never guessed', async () => {
  await assert.rejects(stableRead(script('A', 'B', 'C'), { label: 'x' }), (e) => e instanceof UnstableReadError && /3 different answers/.test(e.message));
});

test('stableHeader rejects a header for the wrong block', async () => {
  // asked for 100: the node answers 90 once (the bug), then 100 twice
  const answers = [{ number: 90, timestamp: 5 }, { number: 100, timestamp: 7 }, { number: 100, timestamp: 7 }];
  let i = 0;
  const h = await stableHeader(async () => answers[i++], 100);
  assert.deepEqual(h, { number: 100, timestamp: 7 });
  assert.equal(i, 3);
});

test('stableHeader never accepts the same wrong block twice as correct', async () => {
  await assert.rejects(stableHeader(async () => ({ number: 90, timestamp: 5 }), 100), /keeps answering for block 90/);
});
