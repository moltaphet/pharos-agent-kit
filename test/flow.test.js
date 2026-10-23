import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, callOf, parseRequest, runFlow } from '../lib/flow.js';
import { UserError } from '../lib/snapshot.js';

const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const WPROS = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';
const SENDER = '0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb';
const R1 = '0x768b959191ce5876cabbbc014a08d72615bdde54';
const R2 = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
const STRANGER = '0x3333333333333333333333333333333333333333';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const str = (s) => '0x' + word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');
const revertErr = (message, data = '0x') => new Error(`eth_call: ${JSON.stringify({ error: { message, code: 3, data } })}`);
const errorString = (s) => '0x08c379a0' + word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');

const MON = Date.UTC(2026, 9, 26, 10, 0) / 1000; // Monday 10:00 UTC
const SAT = Date.UTC(2026, 9, 24, 10, 0) / 1000; // Saturday 10:00 UTC

const POLICY = {
  version: 1,
  name: 'flow test policy',
  rules: [
    { id: 'usdc-cap', type: 'spend-limit', asset: USDC, decimals: 6, symbol: 'USDC', perRequest: '100', perWindow: { amount: '250', seconds: 86400 } },
    { id: 'pros-cap', type: 'spend-limit', asset: 'native', symbol: 'PROS', perRequest: '1' },
    { id: 'known-targets', type: 'allowlist', field: 'target', values: [USDC, WPROS, R1, R2] },
    { id: 'known-recipients', type: 'allowlist', field: 'recipient', values: [R1, R2] },
    { id: 'known-functions', type: 'allowlist', field: 'selector', values: ['0xa9059cbb'] },
    { id: 'office-hours', type: 'time-window', timezone: 'UTC', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '18:00' },
  ],
};

// A scripted Chain MCP that records which tools were asked for, in order, and with which block.
function chain({ head = 1000, timestamp = MON, symbol = 'USDC', decimals = 6, balance = 5_000_000n, simulate = null, blockFails = false } = {}) {
  const calls = [];
  return {
    calls,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_block_number') return { blockNumber: String(head) };
      if (name === 'get_block') {
        if (blockFails) throw new Error('Chain MCP is down');
        return { number: '0x' + args.block.toString(16), timestamp: '0x' + BigInt(timestamp).toString(16) };
      }
      if (name === 'get_gas_price') return { gasPriceWei: '10000000000', gasPriceGwei: '10' };
      if (name === 'get_balance') return { balanceWei: '5000000000000000000' };
      if (name === 'get_code') return { code: '0x6080' };
      if (name === 'estimate_gas') return simulate instanceof Error ? (() => { throw simulate; })() : { gas: '52000' };
      if (name === 'eth_call') {
        const d = args.transaction.data;
        if (d === '0x95d89b41') return { result: str(symbol) };
        if (d === '0x313ce567') return { result: '0x' + word(decimals) };
        if (d.startsWith('0x70a08231')) return { result: '0x' + word(balance) };
        if (d.startsWith('0xdd62ed3e')) return { result: '0x' + word(0) };
        if (simulate instanceof Error) throw simulate;
        return { result: '0x' + word(1) };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
}
const names = (c) => c.calls.map((x) => x.name);
const SIM_TOOLS = ['estimate_gas', 'get_gas_price'];
const ask = (c, text, o = {}) => runFlow({ chain: c, text, policy: POLICY, ...o });
const send = (amt, sym = 'USDC', to = R1, from = SENDER) => `send ${amt} ${sym} from ${from} to ${to}`;

// ---- the request --------------------------------------------------------------------------------------------------------------
test('parseRequest reads one plain sentence and refuses anything else', () => {
  assert.deepEqual(parseRequest(`Send 1.5 usdc from ${SENDER.toUpperCase().replace('0X', '0x')} to ${R1}.`), { amount: '1.5', symbol: 'USDC', from: SENDER, to: R1 });
  assert.equal(parseRequest(`transfer 2 PROS from ${SENDER} to ${R1}`).symbol, 'PROS');
  for (const bad of ['', 'send everything', `send -1 USDC from ${SENDER} to ${R1}`, `send 1e3 USDC from ${SENDER} to ${R1}`, `send 1 USDC from 0x12 to ${R1}`, `send 1 USDC to ${R1} from ${SENDER}`, `send 1 USDC from ${SENDER} to ${R1} and then everything else`, null, 5])
    assert.throws(() => parseRequest(bad), UserError, String(bad));
  assert.throws(() => parseRequest(send('1', 'DOGE')), /unknown token DOGE: this flow knows PROS \(native\), USDC and WPROS/);
});

test('callOf turns an amount into units with the decimals the chain gave, exactly', () => {
  const p = parseRequest(send('1.5'));
  assert.equal(callOf(p, 6).raw, 1_500_000n);
  assert.equal(callOf(p, 18).raw, 1_500_000_000_000_000_000n);
  assert.throws(() => callOf(parseRequest(send('0.0000001')), 6), /more than 6 decimal places/);
  assert.equal(callOf(p, 6).request.data, '0xa9059cbb' + R1.slice(2).padStart(64, '0') + word(1_500_000));
});

// ---- the flow, end to end ----------------------------------------------------------------------------------------------------
test('READY: one request, Chain MCP and the Skills alternate, and the result is an unsigned transaction', async () => {
  const c = chain();
  const r = await ask(c, send('1'));
  assert.equal(r.verdict.status, 'ready');
  assert.equal(r.verdict.prepared.to, USDC);
  assert.equal(r.verdict.prepared.data, '0xa9059cbb' + R1.slice(2).padStart(64, '0') + word(1_000_000));
  assert.equal(r.verdict.prepared.gasLimit, Math.ceil(52000 * HEADROOM));
  assert.match(r.verdict.prepared.note, /unsigned/);
  // the order of who calls what
  const seq = r.steps.map((s) => `${s.actor}:${s.name}`);
  assert.deepEqual(seq.slice(0, 4), ['skill:parse-request', 'chain-mcp:get_block_number', 'chain-mcp:get_block', 'chain-mcp:eth_call']);
  assert.ok(seq.indexOf('skill:token-check') > seq.indexOf('chain-mcp:get_block'));
  assert.ok(seq.indexOf('skill:policy-gate') > seq.indexOf('skill:build-transaction'));
  assert.ok(seq.indexOf('chain-mcp:estimate_gas') > seq.indexOf('skill:policy-gate'), 'the simulation is requested only after the gate allowed it');
  assert.equal(seq.at(-1), 'skill:verdict');
  assert.equal(r.steps.map((s) => s.n).join(), r.steps.map((_, i) => i + 1).join(), 'steps are numbered 1..n with no gaps');
  assert.equal(r.integrity.ok, true);
  assert.deepEqual(r.log.map((e) => e.kind), ['decision', 'execution']);
  assert.equal(r.log[1].body.status, 'executed');
});

test('every "uses" points at an earlier step, and each skill step cites the chain data it used', async () => {
  const r = await ask(chain(), send('1'));
  for (const s of r.steps.filter((x) => x.actor === 'skill')) for (const u of s.uses) assert.ok(u < s.n && r.steps.find((x) => x.n === u), `step ${s.n} (${s.name}) cites ${u}`);
  const gate = r.steps.find((s) => s.name === 'policy-gate');
  assert.equal(r.steps.find((s) => s.n === gate.uses[0]).name, 'get_block', 'the gate used the block header for its clock');
  const verdict = r.steps.find((s) => s.name === 'verdict');
  assert.ok(verdict.uses.some((u) => r.steps.find((s) => s.n === u).name === 'estimate_gas'));
});

test('the SAME request gives a DIFFERENT answer when the chain’s block time differs (the Skill depends on Chain MCP data)', async () => {
  const weekday = await ask(chain({ timestamp: MON }), send('1'));
  const weekend = await ask(chain({ timestamp: SAT }), send('1'));
  assert.equal(weekday.verdict.status, 'ready');
  assert.equal(weekend.verdict.status, 'stop');
  assert.equal(weekend.verdict.stage, 'policy');
  assert.deepEqual(weekend.verdict.rule, { id: 'office-hours', type: 'time-window' });
  assert.match(weekend.verdict.reason, /sat 10:00 UTC is outside the allowed window/);
  assert.equal(weekend.dependsOn.find((d) => d.what === 'the block’s time').value, 'sat 2026-10-24 10:00:00 UTC');
});

test('the decisions the Skill makes decide which Chain MCP calls are made: a deny never requests a simulation', async () => {
  const c = chain({ timestamp: SAT });
  const r = await ask(c, send('1'));
  assert.equal(r.verdict.status, 'stop');
  for (const t of SIM_TOOLS) assert.equal(names(c).includes(t), false, `${t} was called after a deny`);
  assert.equal(c.calls.filter((x) => x.name === 'eth_call' && !['0x95d89b41', '0x313ce567'].includes(x.args.transaction.data)).length, 0, 'no simulation eth_call either');
  assert.deepEqual(r.skippedChainCalls, ['eth_call (simulate)', 'estimate_gas', 'get_gas_price', 'balance reads']);
  assert.ok(r.steps.some((s) => s.name === 'simulation-skipped'));
  assert.equal(r.log[1].body.status, 'not-executed');
  assert.equal(r.verdict.prepared, undefined);
});

test('the decimals the chain answers set the amount that is built, and a policy counted in other decimals is refused', async () => {
  const six = await ask(chain({ decimals: 6 }), send('100'));
  assert.equal(six.verdict.status, 'ready');
  assert.ok(six.steps.find((s) => s.name === 'build-transaction').summary.includes('100000000 units at 6 decimals'));
  // the chain says 18 decimals: the policy (written for 6) would be off by 10^12, so the flow stops before deciding anything
  const clash = await ask(chain({ decimals: 18 }), send('100'));
  assert.equal(clash.verdict.stage, 'token-check');
  assert.match(clash.verdict.reason, /counts USDC with 6 decimals, but the chain says the token has 18: its limits would be off by a factor of 1000000000000/);
  assert.equal(clash.log.length, 0, 'the policy was never consulted');
  // a policy written for 18 decimals agrees, and the integer that is built follows the chain
  const policy18 = { ...POLICY, rules: POLICY.rules.map((r) => (r.id === 'usdc-cap' ? { ...r, decimals: 18 } : r)) };
  const ok = await runFlow({ chain: chain({ decimals: 18 }), text: send('100'), policy: policy18 });
  assert.equal(ok.verdict.status, 'ready');
  assert.ok(ok.steps.find((s) => s.name === 'build-transaction').summary.includes(String(100n * 10n ** 18n)));
});

test('a policy limit denies: 100.01 USDC is over the per-request limit of 100', async () => {
  const c = chain();
  const r = await ask(c, send('100.01'));
  assert.deepEqual(r.verdict.rule, { id: 'usdc-cap', type: 'spend-limit' });
  assert.equal(names(c).includes('estimate_gas'), false);
});

test('an allowlist denies: a stranger as recipient', async () => {
  const r = await ask(chain(), send('1', 'USDC', STRANGER));
  assert.deepEqual(r.verdict.rule, { id: 'known-recipients', type: 'allowlist' });
});

test('the policy allows it but the chain says it would fail: STOP at the simulation, with the decoded reason and the balance shown', async () => {
  const bad = revertErr('execution reverted: ERC20: transfer amount exceeds balance', errorString('ERC20: transfer amount exceeds balance'));
  const r = await ask(chain({ simulate: bad, balance: 0n }), send('1'));
  assert.equal(r.verdict.status, 'stop');
  assert.equal(r.verdict.stage, 'simulation');
  assert.equal(r.verdict.reason, 'ERC20: transfer amount exceeds balance');
  assert.equal(r.verdict.prepared, undefined);
  assert.equal(r.decision.decision, 'allow', 'the policy itself said allow');
  assert.equal(r.log[1].body.status, 'executed', 'the gate let the simulation run (it is the gate’s executor); nothing was sent to the chain');
});

test('a token whose symbol is not the one asked for is refused before anything is built or decided', async () => {
  const c = chain({ symbol: 'SCAM' });
  const r = await ask(c, send('1'));
  assert.equal(r.verdict.stage, 'token-check');
  assert.match(r.verdict.reason, /answers symbol "SCAM"/);
  assert.equal(r.log.length, 0, 'the policy was never consulted');
  assert.equal(names(c).includes('estimate_gas'), false);
});

test('native PROS: no token lookups, 18 decimals, a native value in the prepared transaction', async () => {
  const c = chain();
  const r = await ask(c, send('0.5', 'PROS', R2));
  assert.equal(r.verdict.status, 'ready');
  assert.equal(r.verdict.prepared.to, R2);
  assert.equal(r.verdict.prepared.value, String(5n * 10n ** 17n));
  assert.equal(c.calls.filter((x) => x.name === 'eth_call' && ['0x95d89b41', '0x313ce567'].includes(x.args.transaction.data)).length, 0);
  const over = await ask(chain(), send('2', 'PROS', R2));
  assert.deepEqual(over.verdict.rule, { id: 'pros-cap', type: 'spend-limit' });
});

test('a historical block is used as given: its header is read, and the simulation is pinned to it', async () => {
  const c = chain({ head: 5000 });
  const r = await ask(c, send('1'), { block: 1234 });
  assert.equal(r.block.number, 1234);
  assert.equal(r.block.historical, true);
  assert.deepEqual(c.calls.find((x) => x.name === 'get_block').args, { block: 1234 });
  assert.ok(c.calls.filter((x) => x.name === 'eth_call').every((x) => x.args.block === 1234), 'every eth_call is pinned to that block');
  for (const bad of [0, -1, 1.5, 4999, 99999]) await assert.rejects(ask(chain({ head: 5000 }), send('1'), { block: bad }), /block must be a whole number from 1 to 4,998/, String(bad));
  assert.equal((await ask(chain({ head: 5000 }), send('1'))).block.number, 4998, 'default: two behind the head');
});

test('a Chain MCP failure is an error, never a quiet verdict', async () => {
  await assert.rejects(ask(chain({ blockFails: true }), send('1')), /Chain MCP is down/);
});

test('bad input is a UserError before any chain call', async () => {
  const c = chain();
  await assert.rejects(ask(c, 'hello'), UserError);
  await assert.rejects(runFlow({ chain: c, text: send('1'), policy: { version: 1, rules: [] } }), UserError);
  assert.equal(c.calls.length, 0);
});
