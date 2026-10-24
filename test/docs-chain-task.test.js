import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readCases, readDemo } from '../lib/tasks/docs-chain-mcp-agent.js';
import { UserError } from '../lib/snapshot.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/docs-chain-demo.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);
const hex = (n) => BigInt(n).toString(16).padStart(64, '0');

// ---- the recorded demo: five real functions on Pharos mainnet -------------------------------------------------------------------------
test('requirement 4: the recording has five cases on five contracts and four different functions, all pinned to one real block', () => {
  assert.deepEqual(demo.cases.map((c) => c.id), ['btc-feed', 'pros-feed', 'usdc-supply', 'wpros-balance', 'pair-token0']);
  assert.equal(new Set(demo.cases.map((c) => c.contract)).size, 5, 'five different contracts');
  assert.equal(new Set(demo.cases.map((c) => c.function)).size, 4, 'four different functions (latestAnswer twice)');
  for (const c of demo.cases) {
    assert.equal(c.result.block.number, 21100000);
    assert.equal(c.result.block.historical, true);
    assert.equal(c.result.request.contract, c.contract);
    assert.equal(c.result.request.signature, c.function.replace(/\)\(.*$/, ')'));
  }
});

test('requirement 1: the explanation is from Docs MCP, with sources, and is only applied when it is grounded', () => {
  for (const id of ['btc-feed', 'pros-feed', 'usdc-supply', 'wpros-balance']) {
    const r = byId(id).result;
    assert.equal(r.verdict.status, 'explained', id);
    assert.equal(r.explanation.kind, 'documented', id);
    assert.ok(r.explanation.text.length > 80, id);
    assert.ok(r.explanation.sources.some((s) => s.cited && s.url.startsWith('https://docs.pharos.xyz/')), `${id}: a cited docs page`);
    assert.ok(r.steps.some((s) => s.actor === 'docs-mcp' && s.name === 'askQuestion'), id);
  }
  // the function the docs do not cover is shown raw, with no meaning invented for it
  const t0 = byId('pair-token0').result;
  assert.ok(['unexplained', 'general-only'].includes(t0.verdict.status));
  assert.equal(t0.explanation.listedIn?.length ?? 0, 0, 'no documentation page lists the pair’s address');
  for (const id of ['btc-feed', 'pros-feed', 'usdc-supply', 'wpros-balance']) assert.ok(byId(id).result.explanation.listedIn.length >= 1, `${id}: a docs page lists the address`);
  assert.equal(t0.interpretation.value, null);
  assert.equal(t0.followUps.length, 0);
  assert.equal(t0.call.values[0].text, '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0');
});

test('requirement 2: each case calls the same function on chain through Chain MCP, after the docs were asked', () => {
  for (const c of demo.cases) {
    const order = c.result.steps.map((s) => `${s.actor}:${s.name}`);
    assert.ok(order.indexOf('docs-mcp:askQuestion') < order.indexOf('chain-mcp:eth_call'), c.id);
    const call = c.result.steps.find((s) => s.actor === 'chain-mcp' && s.name === 'eth_call');
    assert.ok(call.input.includes(c.result.request.selector.slice(2)), `${c.id}: the eth_call carries the function’s selector`);
    assert.ok(call.input.includes(`"block":21100000`), c.id);
  }
});

test('requirement 3: the value is read the way the explanation says, and checked against the chain', () => {
  const btc = byId('btc-feed').result;
  assert.equal(btc.call.values[0].text, '80683130407437730000000');
  assert.equal(btc.interpretation.value.scaled, '80,683.130407');
  assert.equal(btc.interpretation.value.unit, 'BTC/USD');
  assert.equal(btc.interpretation.scaleSource, 'docs and chain agree');
  // The explanation is generated, so one recording may ask for a freshness check and another not; where it did, the check is there and says why it was made.
  for (const c of demo.cases.filter((x) => x.result.followUps.some((f) => f.fn === 'latestTimestamp()' && f.value != null))) {
    assert.ok(c.result.interpretation.freshness.ageSec >= 0, c.id);
    assert.ok(c.result.interpretation.checks.some((x) => /freshness/.test(x.name)), c.id);
  }
  for (const c of demo.cases) for (const f of c.result.followUps) assert.ok(f.why.length > 20 && f.quote, `${c.id}: every follow-up call says what in the explanation asked for it`);
  assert.equal(byId('pros-feed').result.interpretation.value.scaled, '0.65401925');
  assert.equal(byId('usdc-supply').result.interpretation.value.scaled, '25,285,059.533609');
  assert.equal(byId('wpros-balance').result.interpretation.value.scaled, '0.0000676313');
  // every explained case was checked against the contract’s own decimals()
  for (const id of ['btc-feed', 'pros-feed', 'usdc-supply', 'wpros-balance']) assert.ok(byId(id).result.followUps.some((f) => f.fn === 'decimals()' && f.value != null), id);
});

test('the same function on two contracts and two different functions are both covered (the brief asks for at least two)', () => {
  const a = byId('btc-feed').result.request;
  const b = byId('pros-feed').result.request;
  assert.equal(a.signature, b.signature);
  assert.notEqual(a.contract, b.contract);
  assert.notEqual(byId('usdc-supply').result.request.signature, a.signature);
});

test('steps are numbered in order and every "uses" points at an earlier step', () => {
  for (const c of demo.cases) {
    const r = c.result;
    assert.deepEqual(r.steps.map((s) => s.n), r.steps.map((_, i) => i + 1), c.id);
    for (const s of r.steps.filter((x) => x.actor === 'agent')) for (const u of s.uses) assert.ok(u < s.n, `${c.id}: step ${s.n}`);
  }
});

test('every read in the recording was confirmed by the public RPC at the same block', () => {
  for (const c of demo.cases) {
    const i = c.result.integrity;
    assert.ok(i.checked >= 1, c.id);
    assert.equal(i.inconclusive, 0, `${c.id}: no read went unconfirmed`);
    assert.equal(i.confirmed + i.resolved, i.checked, c.id);
    assert.equal(c.result.rpcCalls >= i.checked, true, c.id);
    assert.ok(c.result.steps.some((s) => s.actor === 'public-rpc'), c.id);
  }
});

test('the recording is read-only and holds no secrets', () => {
  const tools = new Set(demo.cases.flatMap((c) => c.result.steps.filter((s) => s.actor === 'chain-mcp').map((s) => s.name)));
  assert.deepEqual([...tools].sort(), ['eth_call', 'get_block', 'get_block_number', 'get_code']);
  // documentation snippets may mention a PRIVATE_KEY variable by name; what must never appear is a key itself
  const text = JSON.stringify(demo);
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  try {
    const key = JSON.parse(readFileSync(new URL('../.wallet/atlantic-testnet.json', import.meta.url), 'utf8')).privateKey;
    assert.equal(text.includes(key), false, 'the throwaway wallet key is not in the recording');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // no wallet file on this machine: nothing to compare with
  }
});

// ---- replay ----------------------------------------------------------------------------------------------------------------------------
test('compareReplay: identical chain answers pass; the head is not compared; a changed answer or raw value is named', () => {
  const rec = byId('btc-feed').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.sameRawValue, true);
  assert.equal(same.chainAnswers.identical, same.chainAnswers.compared);
  assert.ok(same.chainAnswers.compared >= 4);
  const moved = structuredClone(rec);
  moved.steps.find((s) => s.name === 'get_block_number').output = '{"blockNumber":"1"}';
  assert.equal(compareReplay(rec, moved).chainAnswers.differing.length, 0);
  const changed = structuredClone(rec);
  changed.steps.find((s) => s.name === 'get_code').output = '{"code":"0x00"}';
  changed.call.raw = '0x01';
  const cmp = compareReplay(rec, changed);
  assert.equal(cmp.chainAnswers.differing[0].call, 'get_code');
  assert.equal(cmp.sameRawValue, false);
});

test('compareReplay compares only the calls both runs made (the explanation may ask for different follow-ups)', () => {
  const rec = byId('btc-feed').result;
  const fewer = structuredClone(rec);
  fewer.steps = fewer.steps.filter((s) => !(s.actor === 'chain-mcp' && /8205bf6a/.test(s.input)));
  const cmp = compareReplay(rec, fewer);
  assert.equal(cmp.chainAnswers.identical, cmp.chainAnswers.compared);
  assert.match(cmp.note, /generated again/);
});

// ---- the API ---------------------------------------------------------------------------------------------------------------------------
const chainStub = (calls = []) => ({
  callTool: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_block_number') return { blockNumber: '1000' };
    if (name === 'get_block') return { number: '0x1', timestamp: '0x65000000' };
    if (name === 'get_code') return { code: '0x6080' };
    if (name === 'eth_call') return { result: '0x' + hex(42) };
    throw new Error(`unexpected ${name}`);
  },
});
const rpcStub = async () => '0x' + hex(42);
const docsStub = (text) => ({ callTool: async (name, args) => (name === 'askQuestion' ? text : `Title: X\nLink: https://docs.pharos.xyz/x\nContent: lists ${args.query}`) });

test('?example and ?recorded are served; bad input is a UserError before any server is asked', async () => {
  assert.equal((await run({ q: { example: '1' }, body: null })).cases.length, 5);
  assert.equal((await run({ q: { recorded: '1' }, body: null })).demo.cases.length, 5);
  assert.deepEqual((await readCases()).map((c) => c.id), demo.cases.map((c) => c.id));
  assert.equal((await readDemo()).cases.length, 5);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null }), /unknown recorded case "nope"; known: btc-feed, pros-feed/);
  await assert.rejects(run({ q: {}, body: null }), /give a contract and a function/);
  await assert.rejects(run({ q: { contract: '0x12', function: 'f()(uint256)' }, body: null, chain: chainStub(), docs: docsStub('x'), rpc: rpcStub }), /contract must be a 0x address/);
  await assert.rejects(run({ q: { contract: '0x' + '1'.repeat(40), function: 'f(' }, body: null, chain: chainStub(), docs: docsStub('x'), rpc: rpcStub }), UserError);
  await assert.rejects(run({ q: { contract: '0x' + '1'.repeat(40), function: 'f()(uint256)', block: 'abc' }, body: null, chain: chainStub(), docs: docsStub('x'), rpc: rpcStub }), /block must be a whole number/);
});

test('arguments arrive as a comma list or JSON, and the call carries them', async () => {
  const addr = '0x' + 'ab'.repeat(20);
  for (const args of [addr, JSON.stringify([addr]), [addr]]) {
    const calls = [];
    const out = await run({ q: { contract: '0x' + '1'.repeat(40), function: 'balanceOf(address)(uint256)', args: typeof args === 'string' ? args : undefined }, body: Array.isArray(args) ? { args } : null, chain: chainStub(calls), rpc: rpcStub, docs: docsStub('`balanceOf` of the contract. See [Token Registry](https://docs.pharos.xyz/getting-started/token-registry).\n\n# Sources\n\n- [Token Registry](https://docs.pharos.xyz/getting-started/token-registry)') });
    assert.equal(out.agent.request.args[0], addr);
    assert.ok(calls.some((c) => c.name === 'eth_call' && c.args.transaction.data === '0x70a08231' + 'ab'.repeat(20).padStart(64, '0')));
  }
});

test('the page ships the same cases as the agent folder (a drifted copy would demo something else)', async () => {
  const page = await import('../public/js/tasks/docs-chain-mcp-agent.js');
  assert.deepEqual(page.CASES, JSON.parse(file('../agents/docs-chain-mcp-agent/examples/cases.json')));
  assert.equal(page.content.evidence.length, 4);
  assert.deepEqual(page.content.tools, ['docs', 'chain']);
});
