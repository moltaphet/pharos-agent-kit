import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseConfig } from '../lib/tasks/threshold-guardian.js';

const ADDR = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb';
const base = (over = {}) => ({
  action: 'do it',
  conditions: [
    { id: 'gas', type: 'gas-price', op: '<=', threshold: 20 },
    { id: 'bal', type: 'native-balance', address: ADDR, op: '>=', threshold: 1 },
    { id: 'gas2', type: 'gas-price', op: '>', threshold: 0 },
  ],
  ...over,
});

// A chain stub: gas 10 gwei, native balance 5 PROS.
const chain = (gwei = 10, balance = '5') => ({
  callTool: async (name) => {
    if (name === 'get_block_number') return { blockNumber: '100' };
    if (name === 'get_gas_price') return { gasPriceGwei: String(gwei) };
    if (name === 'get_balance') return { balance };
    throw new Error(`unexpected tool ${name}`);
  },
});

test('rejects configs that cannot be trusted, with precise messages', () => {
  assert.throws(() => parseConfig(null), /JSON object/);
  assert.throws(() => parseConfig({ conditions: [] }), /at least one condition/);
  assert.throws(() => parseConfig(base({ conditions: [{ type: 'nope', op: '>=', threshold: 1 }] })), /unknown type "nope"/);
  assert.throws(() => parseConfig(base({ conditions: [{ type: 'gas-price', op: '=>', threshold: 1 }, ...base().conditions.slice(1)] })), /op must be one of/);
  assert.throws(() => parseConfig(base({ conditions: [{ type: 'gas-price', op: '<=', threshold: '20' }, ...base().conditions.slice(1)] })), /threshold must be a number/);
  assert.throws(() => parseConfig(base({ conditions: [{ type: 'native-balance', address: '0x12', op: '>=', threshold: 1 }, ...base().conditions.slice(1)] })), /"address" must be a 0x address/);
  assert.throws(() => parseConfig(base({ conditions: base().conditions.slice(0, 2) })), /at least 3 independent conditions/);
  assert.throws(() => parseConfig(base({ require: { atLeast: 9 } })), /config.require/);
  assert.throws(() => parseConfig(base({ conditions: [base().conditions[0], { ...base().conditions[0] }, base().conditions[1]] })), /duplicate id/);
});

test('require: all / any / atLeast resolve to the number of conditions needed', () => {
  assert.equal(parseConfig(base()).need, 3);
  assert.equal(parseConfig(base({ require: 'any' })).need, 1);
  assert.equal(parseConfig(base({ require: { atLeast: 2 } })).need, 2);
});

test('fires when every condition is met, and the trace says why', async () => {
  const r = await evaluate({ chain: chain() }, base());
  assert.equal(r.decision, 'fire');
  assert.equal(r.passed, 3);
  assert.equal(r.block, 100);
  assert.match(r.trace[0], /^PASS {2}gas: 10 gwei <= 20/);
  assert.match(r.trace.at(-1), /DECISION {2}FIRE: do it/);
});

test('holds when a condition fails, and says how many more are needed', async () => {
  const r = await evaluate({ chain: chain(50) }, base());
  assert.equal(r.decision, 'hold');
  assert.equal(r.passed, 2); // gas<=20 fails; the other two pass
  assert.match(r.trace[0], /^FAIL {2}gas: 50 gwei <= 20/);
  assert.match(r.trace.at(-1), /HOLD: 1 more condition needed/);
});

test('"any" and "atLeast" change the outcome for the same readings', async () => {
  assert.equal((await evaluate({ chain: chain(50) }, base({ require: 'any' }))).decision, 'fire');
  assert.equal((await evaluate({ chain: chain(50) }, base({ require: { atLeast: 3 } }))).decision, 'hold');
});

test('a condition that cannot be read counts as not met (fail safe)', async () => {
  const broken = { callTool: async (name) => { if (name === 'get_balance') throw new Error('boom'); return chain().callTool(name); } };
  const r = await evaluate({ chain: broken }, base());
  assert.equal(r.decision, 'hold');
  const bal = r.results.find((x) => x.id === 'bal');
  assert.equal(bal.pass, false);
  assert.match(bal.error, /boom/);
  assert.match(r.trace.join('\n'), /ERROR {2}bal: could not be read \(boom\)/);
});
