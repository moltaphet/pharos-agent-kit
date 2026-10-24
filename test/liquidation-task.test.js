import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readDemo, readExamples, readFork } from '../lib/tasks/liquidation-watchdog.js';
import { ORACLE_PRICE_SCALE, WAD, levelOf } from '../lib/liquidation.js';
import { UserError } from '../lib/snapshot.js';
import { BORROWER, ID, world } from './support/morpho-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/liquidation-demo.json'));
const fork = JSON.parse(file('../reports/liquidation-fork-run.json'));
const examples = JSON.parse(file('../agents/liquidation-watchdog/examples/positions.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);

test('the recording has the seven example positions, all read at one real block, with the thresholds each used', () => {
  assert.deepEqual(demo.cases.map((c) => c.id), examples.map((e) => e.id));
  assert.equal(new Set(demo.cases.map((c) => c.block)).size, 1);
  for (const c of demo.cases) {
    assert.equal(c.result.block.number, c.block, c.id);
    assert.equal(c.result.block.historical, true, c.id);
    assert.deepEqual(c.thresholds, { warn: c.warn ?? 1.3, critical: c.critical ?? 1.1 }, c.id);
    assert.equal(c.borrower, c.result.borrower.address, c.id);
  }
  assert.equal(new Set(demo.cases.map((c) => c.marketId)).size, 2, 'two different Morpho Blue markets');
});

test('every level in the recording follows from its health factor and the thresholds, and the health factor from the position', () => {
  for (const c of demo.cases) {
    const r = c.result;
    assert.equal(r.level, levelOf(r.healthFactor, c.thresholds), c.id);
    if (r.healthFactor == null) continue;
    const exact = Number((BigInt(r.position.maxBorrow) * WAD) / BigInt(r.position.borrowed)) / 1e18;
    assert.ok(Math.abs(exact - r.healthFactor) < 1e-12, `${c.id}: maxBorrow / borrowed`);
    assert.equal(BigInt(r.position.maxBorrow), ((BigInt(r.position.collateral) * BigInt(r.position.price)) / ORACLE_PRICE_SCALE * BigInt(r.market.lltv)) / WAD, `${c.id}: Morpho's rule`);
  }
  assert.deepEqual(demo.cases.map((c) => c.result.level), ['critical', 'critical', 'critical', 'ok', 'warning', 'critical', 'no-debt']);
});

test('thresholds are the caller’s: the same loan is OK, then a warning under stricter thresholds', () => {
  const a = byId('comfortable').result;
  const b = byId('comfortable-strict').result;
  assert.equal(a.healthFactor, b.healthFactor);
  assert.deepEqual([a.level, b.level], ['ok', 'warning']);
  assert.equal(a.alertSent, false);
  assert.equal(b.alertSent, true);
});

test('every alert that was raised says what to do, in amounts that are exactly enough, and carries a timestamp', () => {
  for (const c of demo.cases.filter((x) => x.result.alertSent)) {
    const r = c.result;
    assert.match(r.alert.text, /^\[20\d\d-\d\d-\d\dT[\d:.]+Z\] (WARNING|CRITICAL|LIQUIDATABLE NOW): health factor /, c.id);
    assert.match(r.alert.action, /^(Act now: )?repay [\d,.]+ USDC or add [\d,.]+ [A-Za-z]+ of collateral to get back to a health factor of \d\.\d\d\.$/, c.id);
    const repay = BigInt(r.remedies.repayToTarget);
    const after = Number(BigInt(r.position.maxBorrow)) / Number(BigInt(r.position.borrowed) - repay);
    assert.ok(after >= c.thresholds.warn - 1e-9 && after < c.thresholds.warn + 1e-4, `${c.id}: repaying that much reaches the target (${after})`);
    assert.deepEqual(c.consoleOutput.length, 1, `${c.id}: one console message`);
    assert.equal(c.consoleOutput[0], r.alert.text, c.id);
    assert.deepEqual(r.delivered, [{ channel: 'console', ok: true }], c.id);
  }
  assert.equal(byId('nothing-borrowed').result.alertSent, false);
  assert.match(byId('nothing-borrowed').result.alert.headline, /NO DEBT/);
});

test('every read in the recording was confirmed on the public RPC, in two batches, read-only', () => {
  for (const c of demo.cases) {
    const r = c.result;
    assert.equal(r.integrity.inconclusive, 0, c.id);
    assert.equal(r.integrity.confirmed + r.integrity.resolved, r.integrity.batches, c.id);
    assert.equal(r.integrity.batches, 2, c.id);
    assert.ok(r.sources.every((s) => s.block === c.block && /^0x/.test(s.contract)), c.id);
    assert.deepEqual(r.steps.map((s) => s.n), r.steps.map((_, i) => i + 1), c.id);
  }
});

test('the real Morpho agreed with the watchdog on both sides of health factor 1, and paid the bonus the watchdog quotes', () => {
  assert.equal(fork.summary.cases, 4);
  assert.equal(fork.summary.agree, 4);
  assert.equal(fork.summary.bonusMatches, true);
  const [above, justAbove, justBelow, below] = fork.cases;
  assert.deepEqual([above, justAbove].map((c) => c.morphoSaid), ['position is healthy', 'position is healthy']);
  assert.deepEqual([justBelow, below].map((c) => c.morphoExecutedTheLiquidation), [true, true]);
  assert.ok(justAbove.predictedHealthFactor > 1 && justAbove.predictedHealthFactor < 1.00001);
  assert.ok(justBelow.predictedHealthFactor < 1 && justBelow.predictedHealthFactor > 0.99999);
  for (const c of fork.cases) assert.equal(c.agrees, true, c.label);
  assert.ok(Math.abs(justBelow.bonusPaidByMorpho - justBelow.bonusQuotedByWatchdog) < 1e-6);
  assert.match(fork.network, /only the collateral price is moved, by replacing the oracle on the fork/);
});

test('the recordings hold no secret', () => {
  const text = file('../reports/liquidation-demo.json') + file('../reports/liquidation-fork-run.json');
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  assert.equal(/DISCORD_WEBHOOK|TELEGRAM_BOT_TOKEN|api\/webhooks|bot\d+:/i.test(text.replace(/DISCORD_WEBHOOK_URL|TELEGRAM_BOT_TOKEN/g, '')), false);
});

test('compareReplay: the same answer passes; a changed price, debt or verdict is named', () => {
  const rec = byId('largest-near-liquidation').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.identical, same.compared);
  assert.equal(same.sameBlock, true);
  const moved = structuredClone(rec);
  moved.position.price = '1';
  moved.level = 'ok';
  const cmp = compareReplay(rec, moved);
  assert.deepEqual(cmp.differing.map((d) => d.what), ['oracle price', 'level']);
});

test('?example and ?recorded are served; bad input is a UserError before any read; a replay of an unknown case is refused', async () => {
  const ex = await run({ q: { example: '1' }, body: null });
  assert.deepEqual(ex.positions, examples);
  assert.deepEqual(ex.defaults, { warn: 1.3, critical: 1.1 });
  assert.equal((await run({ q: { recorded: '1' }, body: null })).demo.cases.length, 7);
  assert.equal((await readExamples()).length, 7);
  assert.equal((await readDemo()).cases.length, 7);
  assert.equal((await readFork()).summary.agree, 4);
  const never = { callTool: async () => { throw new Error('the chain must not be asked'); } };
  await assert.rejects(run({ q: {}, body: null, chain: never }), /give a marketId and a borrower/);
  await assert.rejects(run({ q: { marketId: '0x12', borrower: BORROWER }, body: null, chain: never }), /32 bytes/);
  await assert.rejects(run({ q: { marketId: ID, borrower: BORROWER, block: 'abc' }, body: null, chain: never }), /block must be a whole number/);
  await assert.rejects(run({ q: { marketId: ID, borrower: BORROWER, warn: '1.0' }, body: null, chain: never }), /critical must be above 1|warn must be above critical/);
  await assert.rejects(run({ q: { marketId: ID, borrower: BORROWER, warn: '1.1', critical: '1.2' }, body: null, chain: never }), /warn must be above critical/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: never }), /unknown recorded case "nope"; known: largest-near-liquidation/);
  await assert.rejects(run({ q: { scan: '1', windows: '500' }, body: null, chain: never }), /windows must be a whole number from 1 to 80/);
});

test('a position is checked by query or body, with the thresholds, and answered from the chain', async () => {
  const W = world();
  for (const [q, body] of [[{ marketId: ID, borrower: BORROWER, warn: '1.5', critical: '1.2' }, null], [{}, { marketId: ID, borrower: BORROWER }]]) {
    const out = await run({ q, body, chain: W.chain, rpc: W.rpc });
    assert.equal(out.watchdog.level, 'critical');
    assert.ok(out.watchdog.healthFactor > 1 && out.watchdog.healthFactor < 1.1);
    assert.equal(out.watchdog.alert.severity, 'critical');
  }
});

test('replay reads the recorded position again at the recorded block and compares it', async () => {
  const W = world({ head: 21_200_000 });
  const out = await run({ q: { replay: 'sample-borrower' }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(out.replayed.block.number, byId('sample-borrower').block);
  assert.equal(out.comparison.sameBlock, true);
  assert.equal(out.comparison.compared, 7);
  assert.ok(out.comparison.differing.length >= 1, 'a different (fake) chain gives different amounts, and the comparison says so');
});

test('the page ships the same positions as the examples, and its sample is a recorded alert', async () => {
  const page = await import('../public/js/tasks/liquidation-watchdog.js');
  assert.deepEqual(page.POSITIONS, examples);
  assert.equal(page.content.evidence.length, 4);
  assert.deepEqual(page.content.tools, ['chain', 'rpc']);
  assert.equal(page.content.run.sample, byId('largest-near-liquidation').consoleOutput[0]);
});
