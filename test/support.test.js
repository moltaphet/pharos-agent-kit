import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagnose, mcpTools } from '../lib/support.js';
import { selectorOf } from '../lib/keccak.js';
import { content } from '../public/js/tasks/dapp-support-agent.js';

const HASH = '0x' + 'ab'.repeat(32);
const A = '0x' + '11'.repeat(20); const B = '0x' + '22'.repeat(20); const TOKEN = '0x' + '33'.repeat(20);
const w = (n) => BigInt(n).toString(16).padStart(64, '0'); const aw = (a) => a.slice(2).padStart(64, '0');
const errorString = (s) => { const b = Buffer.from(s).toString('hex'); return '0x08c379a0' + w(32) + w(s.length) + b.padEnd(Math.ceil(b.length / 64) * 64, '0'); };
const panic = (c) => '0x4e487b71' + w(c);
const sym = '0x' + w(32) + w(4) + Buffer.from('TKN').toString('hex').padEnd(64, '0');
const T = { transfer: selectorOf('transfer(address,uint256)'), transferFrom: selectorOf('transferFrom(address,address,uint256)'), balanceOf: selectorOf('balanceOf(address)'), allowance: selectorOf('allowance(address,address)'), symbol: selectorOf('symbol()'), decimals: selectorOf('decimals()') };

function world({ tx = {}, receipt = {}, replay = { ok: false, data: '0x' }, reads = {}, code = '0x6080', replayNoValue = null, missing = false } = {}) {
  const base = { hash: HASH, from: A, to: TOKEN, input: '0x', value: '0x0', gas: '0x186a0', gasPrice: '0x1', blockNumber: '0x64' };
  const calls = [];
  return {
    calls,
    via: 'Chain MCP',
    getTx: async () => (missing ? null : { ...base, ...tx }),
    getReceipt: async () => (receipt === null ? null : { status: '0x0', gasUsed: '0x5208', blockNumber: '0x64', ...receipt }),
    replay: async (call, block) => { calls.push({ call, block }); return call.value === '0x0' && replayNoValue ? replayNoValue : replay; },
    read: async (to, data, block) => { calls.push({ read: data.slice(0, 10), block }); const k = data.slice(0, 10); return k === T.symbol ? sym : k === T.decimals ? '0x' + w(6) : reads[k] ?? null; },
    balance: async () => 0n,
    code: async () => code,
  };
}
const d = (tools) => diagnose({ hash: HASH, tools });

test('input and special states: bad hash, not found, pending, succeeded', async () => {
  await assert.rejects(diagnose({ hash: '0x123', tools: world() }), /64 hexadecimal/);
  assert.equal((await d(world({ missing: true }))).status, 'not-found');
  assert.equal((await d(world({ receipt: null }))).status, 'pending');
  const ok = await d(world({ receipt: { status: '0x1' } }));
  assert.equal(ok.status, 'succeeded');
  assert.match(ok.headline, /did not fail/);
});

test('the call is replayed on the block before the failure, with the same sender, target, data, value and gas', async () => {
  const t = world({ tx: { input: '0xdeadbeef', value: '0x5' }, replay: { ok: false, data: errorString('nope') } });
  await d(t);
  const r = t.calls.find((c) => c.call);
  assert.equal(r.block, 99);
  assert.deepEqual(r.call, { from: A, data: '0xdeadbeef', value: '0x5', gas: '0x186a0', to: TOKEN });
});

test('out of gas: nearly all the gas used and no reason from the contract', async () => {
  const r = await d(world({ receipt: { gasUsed: '0x186a0' }, replay: { ok: false, data: '0x' } }));
  assert.equal(r.category, 'out-of-gas');
  assert.match(r.plain, /100000 units of gas and used 100,000|100,000 units of gas and used 100,000/);
  assert.equal(r.evidence.gas.percent, 100);
  assert.ok(r.fix.some((f) => /gas limit/.test(f)));
  const notOog = await d(world({ receipt: { gasUsed: '0x186a0' }, replay: { ok: false, data: errorString('owner only') } }));
  assert.equal(notOog.category, 'not-authorized', 'a reason from the contract wins over a high gas figure');
});

test('a revert message is matched to its cause', async () => {
  assert.equal((await d(world({ replay: { ok: false, data: errorString('ERC20: transfer amount exceeds allowance') } }))).category, 'insufficient-allowance', 'a message about the allowance is not read as one about the balance');
  const cases = [['owner only', 'not-authorized'], ['Ownable: caller is not the owner', 'not-authorized'], ['Pausable: paused', 'paused-or-blocked'], ['blocked', 'paused-or-blocked'], ['UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT', 'slippage'],
    ['SPL0', 'slippage'], ['Transaction too old', 'deadline'], ['UniswapV2Router: EXPIRED', 'deadline'], ['transfer to the zero address', 'zero-address'], ['STF', 'transfer-failed'], ['something else entirely', 'revert-reason']];
  for (const [msg, category] of cases) assert.equal((await d(world({ replay: { ok: false, data: errorString(msg) } }))).category, category, msg);
  const r = await d(world({ replay: { ok: false, data: errorString('something else entirely') } }));
  assert.match(r.plain, /something else entirely/);
  assert.equal(r.reason, 'something else entirely');
});

test('transfer: not enough tokens, with the numbers', async () => {
  const input = T.transfer + aw(B) + w(5_000_000);
  const r = await d(world({ tx: { input }, replay: { ok: false, data: errorString('transfer amount exceeds balance') }, reads: { [T.balanceOf]: '0x' + w(1_500_000) } }));
  assert.equal(r.category, 'insufficient-token-balance');
  assert.match(r.plain, /held 1.5 TKN and the transaction needed 5 TKN/);
  assert.equal(r.evidence.balance.balance, '1500000');
});

test('transferFrom: the numbers decide between allowance and balance', async () => {
  const input = T.transferFrom + aw(B) + aw(A) + w(100);
  const noAllowance = await d(world({ tx: { input }, replay: { ok: false, data: errorString('transfer amount exceeds balance') }, reads: { [T.balanceOf]: '0x' + w(1000), [T.allowance]: '0x' + w(10) } }));
  assert.equal(noAllowance.category, 'insufficient-allowance', 'the allowance (10) is below the amount (100) even though the message talked about balance');
  assert.match(noAllowance.plain, /approved for 0\.00001 TKN and needed 0\.0001 TKN/);
  const noBalance = await d(world({ tx: { input }, replay: { ok: false, data: errorString('ERC20: insufficient allowance') }, reads: { [T.balanceOf]: '0x' + w(5), [T.allowance]: '0x' + w(1000) } }));
  assert.equal(noBalance.category, 'insufficient-token-balance');
});

test('panics and custom errors', async () => {
  const p = await d(world({ replay: { ok: false, data: panic(0x12) } }));
  assert.equal(p.category, 'panic');
  assert.match(p.plain, /divided a number by zero/);
  const known = await d(world({ replay: { ok: false, data: '0x' + selectorOf('V3TooLittleReceived()').slice(2) } }));
  assert.equal(known.category, 'slippage');
  const unknown = await d(world({ replay: { ok: false, data: '0x11223344' + w(1) } }));
  assert.equal(unknown.category, 'custom-error');
  assert.match(unknown.plain, /0x11223344/);
  const oz = await d(world({ replay: { ok: false, data: '0xe450d38c' + aw(A) + w(1) + w(2) } }));
  assert.equal(oz.revertKind, 'custom');
});

test('no reason: PROS sent to a non-payable function, a missing function, or just no message', async () => {
  const np = await d(world({ tx: { input: '0xa9059cbb' + w(0), value: '0x1' }, replay: { ok: false, data: '0x' }, replayNoValue: { ok: true, data: '0x' } }));
  assert.equal(np.category, 'not-payable');
  const noFn = await d(world({ tx: { input: '0x12345678' }, replay: { ok: false, data: '0x' }, code: '0x6080604052' + '63a9059cbb14' + '00' }));
  assert.equal(noFn.category, 'wrong-function');
  const silent = await d(world({ tx: { input: '0xa9059cbb' + w(0) }, replay: { ok: false, data: '0x' }, code: '0x6080604052' + '63a9059cbb14' + '00' }));
  assert.equal(silent.category, 'revert-no-reason');
});

test('the replay works on the earlier state: it says something changed first, and does not invent a cause', async () => {
  const r = await d(world({ replay: { ok: true, data: '0x' } }));
  assert.equal(r.category, 'state-changed');
  assert.match(r.plain, /same block/);
});

test('every answer is plain: a headline, a paragraph, at least one fix, and no raw jargon', async () => {
  for (const replay of [{ ok: false, data: errorString('owner only') }, { ok: false, data: panic(0x11) }, { ok: false, data: '0x' }, { ok: true, data: '0x' }]) {
    const r = await d(world({ replay, code: '0x6080' }));
    assert.ok(r.headline.length > 8 && r.plain.length > 60 && r.fix.length >= 1, r.category);
    assert.doesNotMatch(r.plain + r.headline, /\bEVM\b|opcode|selector|calldata|revert data/i, r.category);
  }
});

test('Chain MCP tools: a revert comes back as data, a missing transaction as null', async () => {
  const client = { callTool: async (name, args) => {
    if (name === 'get_transaction') throw new Error('transaction not found');
    if (name === 'eth_call') throw new Error('{"error":{"message":"execution reverted: owner only","code":3,"data":"' + errorString('owner only') + '"}}');
    return {};
  } };
  const tools = mcpTools(client);
  assert.equal(await tools.getTx(HASH), null);
  const r = await tools.replay({ to: TOKEN }, 5);
  assert.equal(r.ok, false);
  assert.equal(r.data, errorString('owner only'));
});

test('the recorded cases: thirteen real failures, eleven kinds, each explained with a fix', () => {
  const run = JSON.parse(readFileSync(new URL('../reports/support-run.json', import.meta.url), 'utf8'));
  assert.equal(run.cases.length, 13);
  assert.ok(run.summary.categories.length >= 10);
  assert.ok(run.cases.filter((c) => c.chain === 'mainnet').length >= 3 && run.cases.filter((c) => c.chain === 'atlantic').length >= 8);
  for (const c of run.cases) { assert.equal(c.diagnosis.status, 'failed', c.id); assert.ok(c.diagnosis.plain.length > 60 && c.diagnosis.fix.length >= 1, c.id); assert.ok(c.explorer.endsWith(c.hash)); }
  const by = Object.fromEntries(run.cases.map((c) => [c.id, c.diagnosis.category]));
  assert.deepEqual([by['not-authorized'], by['insufficient-balance'], by['insufficient-allowance'], by.paused, by['out-of-gas'], by.panic, by['not-payable'], by['wrong-function']],
    ['not-authorized', 'insufficient-token-balance', 'insufficient-allowance', 'paused-or-blocked', 'out-of-gas', 'panic', 'not-payable', 'wrong-function']);
  assert.ok(run.cases.find((c) => c.id === 'insufficient-balance').diagnosis.evidence.balance, 'the balance and the amount needed are in the evidence');
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
