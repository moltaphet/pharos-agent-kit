import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readDemo, readExamples, readFork } from '../lib/tasks/recurring-payment-agent.js';
import { readReference } from '../lib/payments.js';
import { PAYER, PAYEE, payWorld } from './support/pay-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/recurring-demo.json'));
const fork = JSON.parse(file('../reports/recurring-fork-run.json'));
const examples = JSON.parse(file('../agents/recurring-payment-agent/examples/schedules.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);
const step = (n) => fork.timeline[n - 1];
const status = (t) => t.periods.map((p) => `${p.period}:${p.status}`).join(' ');

test('the mainnet recording looks at three real schedules at one pinned block: weekly rent, a monthly 31st, and a payer with nothing', () => {
  assert.deepEqual(demo.cases.map((c) => c.id), examples.map((e) => e.id));
  assert.equal(new Set(demo.cases.map((c) => c.block)).size, 1);
  const rent = byId('weekly-rent').result;
  assert.deepEqual(rent.counts, { paid: 0, pending: 3, submitted: 0, failed: 0, upcoming: 2 });
  assert.equal(rent.action.kind, 'prepared');
  assert.equal(readReference(rent.action.transaction.data), 'rp:rent-weekly:0');
  assert.equal(rent.next.dueIso, '2026-10-26T09:00:00Z');
  const sub = byId('monthly-subscription').result;
  assert.deepEqual(sub.periods.map((p) => p.dueIso.slice(0, 10)), ['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30'], 'the 31st becomes the 30th in a 30-day month');
  assert.deepEqual(sub.periods.map((p) => p.status), ['pending', 'pending', 'upcoming', 'upcoming']);
  const poor = byId('payer-with-nothing').result;
  assert.equal(poor.action.kind, 'blocked-insufficient-balance');
  assert.equal(poor.action.transaction, undefined);
  for (const c of demo.cases) {
    assert.equal(c.result.block.number, c.block, c.id);
    assert.equal(c.result.clock, new Date(c.result.block.timestamp * 1000).toISOString().replace(/\.\d+Z$/, 'Z'), `${c.id}: the clock is the block's`);
  }
});

test('the fork lifecycle: three due, pay one, a payment fails and is retried, one lands unreported, a short balance blocks, then all three are paid', () => {
  assert.equal(fork.timeline.length, 8);
  assert.equal(status(step(1)), '0:pending 1:pending 2:pending 3:upcoming 4:upcoming');
  assert.equal(step(1).action.kind, 'prepared');
  assert.equal(status(step(2)), '0:paid 1:pending 2:pending 3:upcoming 4:upcoming');
  assert.equal(step(2).periods[0].how, 'reported');
  assert.equal(step(2).action.period, 1);
  assert.equal(status(step(3)), '0:paid 1:failed 2:pending 3:upcoming 4:upcoming');
  assert.match(step(3).periods[1].reason, /mined and reverted: nothing was moved/);
  assert.equal(step(3).action.retry, 'attempt 2 of 3');
  assert.equal(status(step(4)), '0:paid 1:paid 2:pending 3:upcoming 4:upcoming');
  assert.equal(step(4).periods[1].how, 'found-on-chain', 'nobody reported the retry; the chain showed it');
  assert.equal(step(4).action.period, 2, 'so period 1 was not prepared again');
  assert.equal(step(5).action.kind, 'blocked-insufficient-balance');
  assert.equal(step(5).action.transaction, undefined);
  assert.equal(step(6).action.kind, 'already-prepared', 'the balance is back: the same transaction is returned, not a new one');
  assert.equal(status(step(7)), '0:paid 1:paid 2:paid 3:upcoming 4:upcoming');
  assert.equal(step(7).action, null);
  assert.equal(status(step(8)), status(step(7)));
  assert.equal(step(8).action, null, 'nothing is prepared when everything due is paid');
});

test('exactly once per period, from the chain: one transfer carries each reference, the payee holds three payments, and a failed transaction moved nothing', () => {
  const p = fork.proof;
  assert.equal(p.exactlyOncePerPeriod, true);
  assert.equal(p.payeeBalances.final, '75000000');
  assert.deepEqual(p.transfersPerReference, { 'rp:rent-demo:0': 1, 'rp:rent-demo:1': 1, 'rp:rent-demo:2': 1 });
  assert.equal(p.transfersOnChain.length, 3);
  assert.deepEqual(p.transfersOnChain.map((t) => t.reference).sort(), ['rp:rent-demo:0', 'rp:rent-demo:1', 'rp:rent-demo:2']);
  assert.equal(p.failedTransaction.status, 'reverted');
  assert.equal(p.payeeBalances.afterFailureReported, p.payeeBalances.afterFirstPayment, 'the failed transaction moved nothing');
  assert.equal(p.payeeBalances.whilePayerWasPoor, '50000000', 'while the payer was short, nothing was paid');
  assert.equal(p.periodsPaid, 3);
  assert.equal(fork.history ?? undefined, undefined);
  const hist = step(8).history.map((h) => h.type);
  assert.deepEqual(hist.filter((t) => t === 'paid').length, 3);
  assert.ok(hist.includes('failed') && hist.includes('blocked') && hist.includes('prepared'));
  assert.ok(step(8).history.every((h) => /^20\d\d-/.test(h.at)), 'every event has a time');
});

test('the fork run refused every double payment attempt', () => {
  assert.equal(fork.guards.length, 3);
  for (const g of fork.guards) assert.equal(g.refused, true, g.what);
  assert.match(fork.guards[0].message, /already reported for period 0: one transaction pays one period/);
  assert.match(fork.guards[1].message, /already reported for period 1/, 'the retry that landed unreported pays period 1: it cannot be reported for another period');
  assert.match(fork.guards[2].message, /0x followed by 64 hex characters/);
});

test('the recordings hold no secret and only the throwaway fork is impersonated', () => {
  const text = file('../reports/recurring-fork-run.json');
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  assert.match(fork.network, /the payer is impersonated, no key is read/);
});

test('compareReplay: the same answer passes; a different status, clock or prepared transaction is named', () => {
  const rec = byId('weekly-rent').result;
  assert.equal(compareReplay(rec, structuredClone(rec)).identical, 4);
  const other = structuredClone(rec);
  other.periods[0].status = 'paid';
  other.action.transaction.data = '0x';
  assert.deepEqual(compareReplay(rec, other).differing.map((d) => d.what), ['statuses', 'action']);
});

test('?example and ?recorded are served; the schedule arrives by query or body; state is passed back in; bad input is a UserError', async () => {
  assert.deepEqual((await run({ q: { example: '1' }, body: null })).schedules, examples);
  const rec = await run({ q: { recorded: '1' }, body: null });
  assert.equal(rec.demo.cases.length, 3);
  assert.deepEqual(rec.fork, fork);
  assert.equal((await readExamples()).length, 3);
  assert.equal((await readDemo()).cases.length, 3);
  assert.equal((await readFork()).timeline.length, 8);
  const W = payWorld({ t0: Date.parse('2026-10-24T20:00:00Z') / 1000 - (1_000_000 - 2) });
  const schedule = { id: 'rent-test', payer: PAYER, payee: PAYEE, token: 'USDC', amount: '25', frequency: 'weekly', start: '2026-10-05T09:00' };
  const a = await run({ q: {}, body: { schedule }, chain: W.chain, rpc: W.rpc });
  assert.equal(a.agent.action.kind, 'prepared');
  const b = await run({ q: {}, body: { schedule, state: a.agent.state }, chain: W.chain, rpc: W.rpc });
  assert.equal(b.agent.action.kind, 'already-prepared');
  const viaQuery = await run({ q: { ...schedule }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(viaQuery.agent.counts.pending, 3);
  await assert.rejects(run({ q: {}, body: null, chain: W.chain }), /give a schedule: payer, payee, token, amount, frequency/);
  await assert.rejects(run({ q: { ...schedule, frequency: 'daily' }, body: null, chain: W.chain }), /weekly or monthly/);
  await assert.rejects(run({ q: { ...schedule, block: 'abc' }, body: null, chain: W.chain }), /block must be a whole number/);
  await assert.rejects(run({ q: { ...schedule }, body: { state: { nope: 1 } }, chain: W.chain }), /saved state is not valid/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: W.chain }), /unknown recorded case "nope"; known: weekly-rent/);
});

test('replay looks at the recorded schedule again at the recorded block and compares it', async () => {
  const W = payWorld({ head: 21_200_000, t0: demo.cases[0].result.block.timestamp - (demo.cases[0].block) });
  const out = await run({ q: { replay: 'weekly-rent' }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(out.replayed.block.number, byId('weekly-rent').block);
  assert.equal(out.comparison.sameBlock, true);
  assert.equal(out.comparison.differing.map((d) => d.what).includes('clock'), false);
  assert.deepEqual(out.replayed.periods.map((p) => p.status), byId('weekly-rent').result.periods.map((p) => p.status));
});

test('the page ships the same schedules as the examples, and the sample is the recorded weekly rent', async () => {
  const page = await import('../public/js/tasks/recurring-payment-agent.js');
  assert.deepEqual(page.SCHEDULES, examples);
  assert.equal(page.content.evidence.length, 4);
  const r = byId('weekly-rent').result;
  for (const p of r.periods) assert.ok(page.content.run.sample.includes(`${p.dueIso}  ${p.status.toUpperCase()}`), `period ${p.period}`);
  assert.ok(page.content.run.sample.includes(`block ${r.block.number.toLocaleString('en-US')}`));
});
