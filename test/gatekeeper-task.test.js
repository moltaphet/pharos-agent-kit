import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryLog, guardedExecute, verifyLog } from '../lib/audit-log.js';
import { parsePolicy } from '../lib/policy.js';
import run, { MAX_REQUESTS, readExample, runGate, tamperDemo } from '../lib/tasks/policy-gatekeeper.js';
import { UserError } from '../lib/snapshot.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const report = JSON.parse(file('../reports/testnet-gatekeeper.json'));
const clock = async () => Date.UTC(2026, 9, 26, 10, 0) / 1000; // Monday 10:00 UTC

test('the example: one deny per rule type, the executor is called exactly once per allowed request, the log is intact', async () => {
  const g = await runGate({ policy: await readExample('policy.json'), requests: await readExample('requests.json'), clock });
  assert.deepEqual([g.summary.allowed, g.summary.denied], [2, 6]);
  for (const rule of ['native-spend', 'known-targets', 'known-functions', 'office-hours', 'request-shape']) assert.ok(g.summary.deniedByRule[rule] >= 1, `no deny by ${rule}`);
  const types = new Set(g.results.filter((r) => r.decision.decision === 'deny').map((r) => r.decision.rule.type));
  for (const t of ['spend-limit', 'allowlist', 'time-window']) assert.ok(types.has(t), `no deny for rule type ${t}`);
  assert.equal(g.summary.deniedThatReachedTheExecutor, 0);
  assert.equal(g.summary.executorCalls, g.summary.allowed);
  assert.equal(g.results.filter((r) => r.executorCalled).every((r) => r.decision.decision === 'allow'), true);
  assert.equal(g.integrity.ok, true);
  assert.equal(g.log.length, 16, 'a decision and an outcome for each of the 8 requests');
});

test('requests without "at" are checked at the clock time and say so', async () => {
  let calls = 0;
  const g = await runGate({
    policy: await readExample('policy.json'),
    requests: [{ from: '0x' + '9'.repeat(40), to: '0x' + '1'.repeat(40), value: '1' }, { from: '0x' + '9'.repeat(40), to: '0x' + '1'.repeat(40), value: '2' }],
    clock: async () => { calls++; return Date.UTC(2026, 9, 26, 10, 0) / 1000; },
  });
  assert.equal(g.results.every((r) => r.clock === 'chain' && r.decision.decision === 'allow'), true);
  assert.equal(calls, 2, 'runGate asks the clock per request; the HTTP handler caches the block time so Chain MCP is read once');
});

test('bad input is a UserError (HTTP 400), never a crash or a silent pass', async () => {
  const policy = await readExample('policy.json');
  const ok = [{ from: '0x' + '9'.repeat(40), to: '0x' + '1'.repeat(40), at: '2026-10-26T10:00:00Z' }];
  for (const [what, args] of [
    ['empty list', { policy, requests: [] }],
    ['not a list', { policy, requests: {} }],
    [`more than ${MAX_REQUESTS}`, { policy, requests: Array.from({ length: MAX_REQUESTS + 1 }, () => ok[0]) }],
    ['policy not JSON', { policy: '{nope', requests: ok }],
    ['two rule types only', { policy: { ...policy, rules: policy.rules.filter((r) => r.type !== 'time-window') }, requests: ok }],
    ['bad "at"', { policy, requests: [{ ...ok[0], at: 'yesterday' }] }],
    ['"at" without Z', { policy, requests: [{ ...ok[0], at: '2026-10-26T10:00:00' }] }],
  ]) await assert.rejects(runGate({ ...args, clock }), UserError, what);
  await assert.rejects(run({ q: {}, body: null, chain: null }), /POST a JSON body/);
});

test('a non-object entry in the list is denied as unreadable, not thrown', async () => {
  const g = await runGate({ policy: await readExample('policy.json'), requests: ['pay everything', null, [], 5], clock });
  assert.equal(g.summary.denied, 4);
  assert.equal(g.results.every((r) => r.decision.rule.id === 'request-shape'), true);
});

test('?example returns the policy and requests; POST with "tamper" shows the change is caught', async () => {
  const ex = await run({ q: { example: '1' }, body: null, chain: null });
  assert.equal(ex.policy.version, 1);
  assert.equal(ex.requests.length, 8);
  const body = { policy: ex.policy, requests: ex.requests, tamper: 2 };
  const r = await run({ q: {}, body, chain: null });
  assert.equal(r.gate.integrity.ok, true);
  assert.equal(r.tamper.integrity.ok, false);
  assert.match(r.tamper.change, /entry 2 \(decision\)/);
  assert.equal((await run({ q: {}, body: { ...body, tamper: undefined }, chain: null })).tamper, undefined);
  await assert.rejects(run({ q: {}, body: { ...body, tamper: 99 }, chain: null }), /tamper must be the number of an entry, 0 to 15/);
  await assert.rejects(run({ q: {}, body: { ...body, tamper: 1.5 }, chain: null }), UserError);
});

test('tampering with ANY single entry, in either direction, is detected, and the original log is not touched', async () => {
  const g = await runGate({ policy: await readExample('policy.json'), requests: await readExample('requests.json'), clock });
  const before = JSON.stringify(g.log);
  for (let seq = 0; seq < g.log.length; seq++) assert.equal(tamperDemo(g.log, seq).integrity.ok, false, `entry ${seq}`);
  assert.equal(JSON.stringify(g.log), before);
});

test('the page ships the same example as the skill folder (a drifted copy would demo something else)', async () => {
  const page = await import('../public/js/tasks/policy-gatekeeper.js').catch(() => null);
  if (!page) {
    // the page imports browser-only helpers; compare the source text instead
    const src = file('../public/js/tasks/policy-gatekeeper.js');
    for (const r of JSON.parse(file('../skills/pharos-policy-gatekeeper/examples/requests.json'))) assert.ok(src.includes(r.id), `page lacks request ${r.id}`);
    return;
  }
  assert.deepEqual(page.EXAMPLE_POLICY, JSON.parse(file('../skills/pharos-policy-gatekeeper/examples/policy.json')));
  assert.deepEqual(page.EXAMPLE_REQUESTS, JSON.parse(file('../skills/pharos-policy-gatekeeper/examples/requests.json')));
});

// ---- the recorded run on Pharos Atlantic testnet ---------------------------------------------------------------------------------------
test('the testnet run is live, on Atlantic, and every denial happened without a transaction', () => {
  assert.equal(report.mode, 'live');
  assert.equal(report.network.chainId, 688689);
  assert.equal(report.summary.requests, 8);
  assert.deepEqual([report.summary.allowed, report.summary.denied], [2, 6]);
  assert.equal(report.summary.deniedThatWereExecuted, 0);
  assert.equal(report.results.every((r) => r.matched), true);
  const types = new Set(report.results.filter((r) => r.decision === 'deny').map((r) => r.rule.type));
  for (const t of ['spend-limit', 'allowlist', 'time-window']) assert.ok(types.has(t), `no live deny for ${t}`);
  assert.equal(report.transactions.length, report.summary.allowed, 'exactly one transaction per allowed request, none for denied ones');
  const hashes = new Set(report.transactions.map((t) => t.hash));
  for (const r of report.results) {
    if (r.decision === 'allow') assert.ok(r.executed && hashes.has(r.transaction.hash) && r.transaction.status === 'success');
    else assert.ok(!r.executed && r.transaction === null);
  }
  assert.equal(report.transactions.every((t) => t.status === 'success' && BigInt(t.valueWei) === 100000000000000n), true);
  assert.equal(JSON.stringify(report).includes('privateKey'), false);
});

test('the chain proof is internally consistent: balances equal what was allowed, a stranger holds nothing, nonce grew by the allowed count', () => {
  const p = report.proof;
  assert.equal(p.ok, true);
  assert.equal(BigInt(p.walletNonce.after) - BigInt(p.walletNonce.before), BigInt(report.summary.allowed));
  for (const b of p.balances) {
    const sent = report.results.filter((r) => r.executed && r.request.to === b.address).reduce((s, r) => s + BigInt(r.request.value), 0n);
    assert.equal(b.chainWei, sent.toString(), b.label);
    assert.equal(b.expectedWei, b.chainWei);
  }
  assert.equal(p.balances.find((b) => /stranger/.test(b.label)).chainWei, '0');
  assert.equal(p.counter.chain, '0');
});

test('the recorded audit log is an intact chain whose decisions match the results, in order', () => {
  const v = verifyLog(report.auditLog.entries);
  assert.equal(v.ok, true);
  assert.equal(v.head, report.auditLog.integrity.head);
  assert.equal(report.auditLog.entries.length, report.results.length * 2);
  for (const r of report.results) {
    const d = report.auditLog.entries[r.decisionSeq];
    const x = report.auditLog.entries[r.executionSeq];
    assert.equal(d.body.decision, r.decision);
    assert.equal(d.body.rule.id, r.rule.id);
    assert.equal(x.body.decisionSeq, r.decisionSeq);
    assert.equal(x.body.status, r.executed ? 'executed' : 'not-executed');
  }
});

test('replaying the recorded requests through the engine reproduces every recorded decision (the decisions are a function of policy, request, time and history)', async () => {
  const policies = { [report.policies.open.source.name]: parsePolicy(report.policies.open.source), [report.policies.closedToday.source.name]: parsePolicy(report.policies.closedToday.source) };
  assert.equal(policies[report.policies.open.source.name].hash, report.policies.open.hash);
  assert.equal(policies[report.policies.closedToday.source.name].hash, report.policies.closedToday.hash);
  const log = new MemoryLog();
  for (const r of report.results) {
    const out = await guardedExecute({ policy: policies[r.policy], log, request: r.request, nowSec: r.nowSec, execute: async () => ({}) });
    assert.equal(out.decision.decision, r.decision, r.id);
    assert.deepEqual(out.decision.rule, r.rule, r.id);
    assert.equal(out.decision.reason, r.reason, r.id);
  }
});

test('hash links written into the page text point at transactions in the recorded gatekeeper report', () => {
  const src = file('../public/js/tasks/policy-gatekeeper.js');
  const all = new Set(report.transactions.map((t) => t.hash));
  const linked = [...src.matchAll(/atlantic\.pharosscan\.xyz\/tx\/(0x[0-9a-f]{64})/g)].map((m) => m[1]);
  assert.ok(linked.length >= 1);
  for (const h of linked) assert.ok(all.has(h), 'the page links a transaction that is not in reports/testnet-gatekeeper.json');
});
