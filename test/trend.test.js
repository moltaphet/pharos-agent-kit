import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, evaluate, newState, observe, parseRule } from '../lib/trend.js';

const feed = (state, values, startBlock = 100) => values.reduce((s, v, i) => observe(s, { block: startBlock + i, time: `t${i}`, value: v }, { now: () => 'NOW' }).state, state);
const run = (values, rule) => values.reduce((acc, v, i) => { const r = observe(acc.state, { block: 100 + i, time: `t${i}`, value: v }, { now: () => 'NOW' }); return { state: r.state, fired: [...acc.fired, r.fired], cleared: [...acc.cleared, r.cleared] }; }, { state: newState(rule), fired: [], cleared: [] });

test('a rule needs at least 3 observations: one reading can never be a trend', () => {
  assert.throws(() => parseRule({ observations: 2 }), /at least 3/);
  assert.throws(() => parseRule({ observations: 1 }), /at least 3/);
  assert.throws(() => parseRule({ direction: 'sideways' }), /direction/);
  assert.throws(() => parseRule({ minStepPct: -1 }), /minStepPct/);
  assert.equal(parseRule({ observations: 5 }).observations, 5);
});

test('steady decline triggers exactly when the third falling observation arrives', () => {
  const r = run([100, 98, 95, 91], { direction: 'down', observations: 3 });
  assert.deepEqual(r.fired, [false, false, true, false]); // fires once, at the 3rd observation (block 102)
  const ev = r.state.events[0];
  assert.equal(ev.type, 'triggered');
  assert.equal(ev.block, 102);
  assert.deepEqual(ev.observations, ['b100', 'b101', 'b102']);
  assert.deepEqual(ev.values, [100, 98, 95]);
  assert.equal(r.state.active, true);
});

test('a single spike does not trigger it', () => {
  const r = run([100, 100, 160, 100, 100], { direction: 'up', observations: 3 });
  assert.ok(r.fired.every((f) => !f), 'no trigger');
  assert.equal(r.state.events.length, 0);
  assert.equal(r.state.active, false);
});

test('a single dip does not trigger a down rule either', () => {
  assert.ok(run([100, 100, 40, 100, 100], { direction: 'down', observations: 3 }).fired.every((f) => !f));
});

test('flat readings never count as a trend', () => {
  assert.ok(run([100, 100, 100, 100], { direction: 'down', observations: 3 }).fired.every((f) => !f));
});

test('minStepPct filters out tiny moves', () => {
  assert.ok(run([100, 99.9, 99.8, 99.7], { direction: 'down', observations: 3, minStepPct: 1 }).fired.every((f) => !f));
  assert.ok(run([100, 98, 96, 94], { direction: 'down', observations: 3, minStepPct: 1 }).fired.some(Boolean));
});

test('the trend clears when it breaks and re-arms for the next one', () => {
  const r = run([100, 98, 95, 99, 97, 94, 90], { direction: 'down', observations: 3 });
  assert.deepEqual(r.state.events.map((e) => `${e.type}@${e.block}`), ['triggered@102', 'cleared@103', 'triggered@105']);
  assert.equal(r.state.active, true);
});

test('observing the same block twice never duplicates history', () => {
  let s = feed(newState({ observations: 3 }), [100, 98, 95]);
  const again = observe(s, { block: 102, value: 95 });
  assert.equal(again.added, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.state.observations.length, 3);
  assert.equal(again.fired, false, 'a duplicate cannot fire the trigger again');
});

test('out-of-order observations are sorted by block', () => {
  const s = feed(newState({ observations: 3 }), [100, 98, 95]);
  const r = observe(s, { block: 50, value: 120 });
  assert.deepEqual(r.state.observations.map((o) => o.block), [50, 100, 101, 102]);
});

test('evaluate explains why a trend is not met', () => {
  const s = feed(newState({ direction: 'down', observations: 3 }), [100, 98, 99]);
  const e = evaluate(s.observations, s.rule);
  assert.equal(e.met, false);
  assert.match(e.reason, /not falling between b101 and b102/);
  assert.match(evaluate(s.observations.slice(0, 2), s.rule).reason, /needs 3 observations, has 2/);
});

test('persistence: state survives a restart without losing or duplicating history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trend-'));
  const path = join(dir, 'state.json');
  const store1 = new FileStore(path);
  assert.equal(await store1.load(), null, 'no file yet');
  let s = feed(newState({ direction: 'down', observations: 3 }), [100, 98]);
  await store1.save(s);

  // "restart": a brand-new store and a brand-new state object, loaded from disk
  const store2 = new FileStore(path);
  s = await store2.load();
  assert.equal(s.observations.length, 2, 'nothing lost');
  const third = observe(s, { block: 102, value: 95 }, { now: () => 'NOW' });
  assert.equal(third.fired, true, 'the third observation after the restart completes the trend');
  await store2.save(third.state);

  // another restart, and the same block is observed again (a retry)
  const loaded = await new FileStore(path).load();
  assert.equal(observe(loaded, { block: 102, value: 95 }).added, false);
  assert.equal(loaded.observations.length, 3);
  assert.equal(loaded.events.length, 1, 'the trigger is recorded once');
  assert.equal((await readFile(path, 'utf8')).endsWith('}\n'), true);
});

test('a corrupt or foreign file is rejected, not silently replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trend-'));
  const path = join(dir, 'bad.json');
  await writeFile(path, '{"hello":"world"}');
  await assert.rejects(new FileStore(path).load(), /not a trend-watcher state file/);
  await writeFile(path, '{ nope');
  await assert.rejects(new FileStore(path).load(), (e) => e.constructor.name === 'UserError' && e.message.includes(path) && /not valid JSON/.test(e.message), 'a truncated file is a clear user error that names the file');
});

test('history is capped: the newest 200 observations and events are kept, so the saved state never outgrows what is accepted back', () => {
  let state = newState({ direction: 'down', observations: 3 });
  for (let i = 1; i <= 230; i++) state = observe(state, { block: i * 10, value: i % 2 ? 100 : 90 }).state; // flapping: many triggered/cleared events
  assert.equal(state.observations.length, 200);
  assert.equal(state.observations[0].block, 310, 'the 30 oldest were dropped');
  assert.equal(state.observations.at(-1).block, 2300);
  assert.ok(state.events.length <= 200);
});
