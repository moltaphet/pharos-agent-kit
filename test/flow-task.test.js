import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyLog } from '../lib/audit-log.js';
import { parsePolicy } from '../lib/policy.js';
import run, { compareReplay, readDemo, readExample } from '../lib/tasks/skill-chain-mcp-flow.js';
import { UserError } from '../lib/snapshot.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/flow-demo.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);

// ---- the recorded demo: five real runs on Pharos mainnet ---------------------------------------------------------------------------
test('the demo has the five cases, each pinned to a block, with the verdict each one is meant to show', () => {
  assert.equal(demo.network.chainId, 1672);
  assert.deepEqual(demo.cases.map((c) => c.id), ['ready', 'weekend', 'over-limit', 'no-balance', 'stranger']);
  const want = { ready: ['ready', 'prepared'], weekend: ['stop', 'policy'], 'over-limit': ['stop', 'policy'], 'no-balance': ['stop', 'simulation'], stranger: ['stop', 'policy'] };
  for (const c of demo.cases) {
    assert.ok(Number.isInteger(c.block) && c.block > 1_000_000, c.id);
    assert.equal(c.result.block.number, c.block);
    assert.equal(c.result.block.historical, true);
    assert.deepEqual([c.result.verdict.status, c.result.verdict.stage], want[c.id], c.id);
  }
  assert.deepEqual(byId('weekend').result.verdict.rule, { id: 'office-hours', type: 'time-window' });
  assert.deepEqual(byId('over-limit').result.verdict.rule, { id: 'usdc-cap', type: 'spend-limit' });
  assert.deepEqual(byId('stranger').result.verdict.rule, { id: 'known-recipients', type: 'allowlist' });
  assert.equal(byId('no-balance').result.verdict.reason, 'ERC20: transfer amount exceeds balance');
});

test('requirement 1: the SAME request gives a different answer because of what Chain MCP said about the block’s time', () => {
  const [a, b] = [byId('ready'), byId('weekend')];
  assert.equal(a.text, b.text);
  assert.notEqual(a.block, b.block);
  assert.equal(a.result.verdict.status, 'ready');
  assert.equal(b.result.verdict.status, 'stop');
  assert.equal(a.result.block.weekday, 'thu');
  assert.equal(b.result.block.weekday, 'sat');
  // the clock the policy used is the timestamp in the get_block answer, not a local one
  for (const c of [a, b]) {
    const header = c.result.steps.find((s) => s.name === 'get_block');
    assert.ok(header.output.includes('"timestamp"') || header.output.includes('timestamp'), 'the header answer carries the timestamp');
    assert.equal(new Date(c.result.block.timestamp * 1000).toISOString().slice(0, 19), c.result.block.iso.replace(' ', 'T').replace(' UTC', ''));
  }
});

test('requirement 2: each run is one request and ends in one verdict, with every step numbered in order', () => {
  for (const c of demo.cases) {
    const r = c.result;
    assert.equal(r.steps[0].name, 'parse-request');
    assert.deepEqual(r.steps.map((s) => s.n), r.steps.map((_, i) => i + 1), c.id);
    for (const s of r.steps.filter((x) => x.actor === 'skill')) for (const u of s.uses) assert.ok(u < s.n, `${c.id}: step ${s.n} uses a later step`);
    assert.ok(r.verdict.headline && r.verdict.reason);
    assert.equal(r.integrity.ok, true);
    assert.equal(verifyLog(r.log).ok, true);
  }
});

test('requirement 4: real data moved through both tools: Chain MCP answers feed the Skill steps, and the Skill’s decision gates the next Chain MCP calls', () => {
  const ready = byId('ready').result;
  const order = ready.steps.map((s) => `${s.actor}:${s.name}`);
  assert.ok(order.indexOf('skill:policy-gate') < order.indexOf('chain-mcp:estimate_gas'), 'the simulation comes after the gate');
  const gate = ready.steps.find((s) => s.name === 'policy-gate');
  assert.equal(ready.steps.find((s) => s.n === gate.uses[0]).name, 'get_block');
  const sim = ready.steps.find((s) => s.name === 'dry-run-verdict');
  assert.ok(sim.uses.some((u) => ready.steps.find((s) => s.n === u).name === 'estimate_gas'));
  assert.equal(ready.chainCalls, 13);
  assert.match(ready.dependsOn.find((d) => /balance/.test(d.what)).value, /1,242,441\.562141 USDC/);
  // denied runs stop calling Chain MCP: 4 calls (head, header, symbol, decimals) and nothing else
  for (const id of ['weekend', 'over-limit', 'stranger']) {
    const r = byId(id).result;
    assert.equal(r.chainCalls, 4, id);
    assert.ok(!r.steps.some((s) => ['estimate_gas', 'get_gas_price'].includes(s.name)), id);
    assert.ok(r.skippedChainCalls.includes('estimate_gas'));
  }
  // a denial is never executed: the audit log says so
  assert.equal(byId('weekend').result.log[1].body.status, 'not-executed');
  assert.equal(ready.log[1].body.status, 'executed');
});

test('the ready run prepared an unsigned ERC-20 transfer with 30% gas headroom', () => {
  const p = byId('ready').result.verdict.prepared;
  assert.equal(p.to, '0xc879c018db60520f4355c26ed1a6d572cdac1815');
  assert.equal(p.value, '0');
  assert.ok(p.data.startsWith('0xa9059cbb') && p.data.endsWith((1_000_000).toString(16).padStart(64, '0')));
  assert.equal(p.gasLimit, Math.ceil(byId('ready').result.verdict.gas.units * 1.3));
  assert.match(p.note, /unsigned/);
});

test('the recorded policy is valid and is the one every case was decided under', () => {
  const hash = parsePolicy(demo.policy).hash;
  for (const c of demo.cases) assert.equal(c.result.policy.hash, hash, c.id);
  assert.deepEqual(demo.policy, JSON.parse(file('../skills/pharos-transfer-preflight/examples/policy.json')));
});

test('the recording has no key, no token and no personal data', () => {
  const text = JSON.stringify(demo);
  assert.equal(/privateKey|private_key|secret|mnemonic/i.test(text), false);
});

// ---- replay -------------------------------------------------------------------------------------------------------------------------
test('compareReplay: an identical replay passes, a changed chain answer is named, and the moving calls are not compared', () => {
  const rec = byId('ready').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.sameVerdict, true);
  assert.equal(same.chainAnswers.identical, same.chainAnswers.compared);
  assert.ok(same.chainAnswers.compared >= 10);
  const moved = structuredClone(rec);
  moved.steps.find((s) => s.name === 'get_block_number').output = '{"blockNumber":"1"}';
  moved.steps.find((s) => s.name === 'get_gas_price').output = '{"gasPriceWei":"1"}';
  assert.equal(compareReplay(rec, moved).chainAnswers.differing.length, 0, 'the head and the gas price are current by nature');
  const changed = structuredClone(rec);
  const bal = changed.steps.find((s) => s.name === 'eth_call' && s.input.includes('0x70a08231'));
  bal.output = '{"result":"0x01"}';
  const cmp = compareReplay(rec, changed);
  assert.equal(cmp.chainAnswers.differing.length >= 1, true);
  assert.equal(cmp.chainAnswers.differing[0].call, 'eth_call');
  const flipped = structuredClone(rec);
  flipped.verdict = { ...flipped.verdict, status: 'stop' };
  assert.equal(compareReplay(rec, flipped).sameVerdict, false);
});

// ---- the API -----------------------------------------------------------------------------------------------------------------------
test('?example and ?recorded are served; an unknown replay or a missing request is a UserError', async () => {
  const ex = await run({ q: { example: '1' }, body: null, chain: null });
  assert.equal(ex.policy.version, 1);
  assert.equal(ex.requests.length, 6);
  assert.equal((await run({ q: { recorded: '1' }, body: null, chain: null })).demo.cases.length, 5);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: null }), /unknown recorded case "nope"; known: ready, weekend/);
  await assert.rejects(run({ q: {}, body: null, chain: null }), /give the request as text/);
  await assert.rejects(run({ q: { text: 'hello' }, body: null, chain: { callTool: async () => { throw new Error('should not be called'); } } }), UserError);
  await assert.rejects(run({ q: { text: 'send 1 USDC from 0x' + '1'.repeat(40) + ' to 0x' + '2'.repeat(40), block: 'abc' }, body: null, chain: null }), /block must be a whole number/);
  assert.deepEqual((await readDemo()).cases.length, 5);
  assert.equal((await readExample('requests.json')).filter((r) => r.block != null).length, 5);
});

test('the page ships the same policy and requests as the skill folder (a drifted copy would demo something else)', async () => {
  const page = await import('../public/js/tasks/skill-chain-mcp-flow.js');
  assert.deepEqual(page.EXAMPLE_POLICY, JSON.parse(file('../skills/pharos-transfer-preflight/examples/policy.json')));
  assert.deepEqual(page.EXAMPLE_REQUESTS, JSON.parse(file('../skills/pharos-transfer-preflight/examples/requests.json')));
  assert.equal(page.content.evidence.length, 4);
  assert.ok(page.content.diagram.includes('<svg') && page.content.diagram.includes('Chain MCP') && page.content.diagram.includes('Policy Gatekeeper'));
});
