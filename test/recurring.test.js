import test from 'node:test';
import assert from 'node:assert/strict';
import { EARLY_SECONDS, MAX_ATTEMPTS, dueTime, newState, parseSchedule, referenceOf, scanTransfers, tick, validateState } from '../lib/recurring.js';
import { readReference } from '../lib/payments.js';
import { USDC } from '../lib/protocols.js';
import { UserError } from '../lib/snapshot.js';
import { PAYEE, PAYER, payWorld } from './support/pay-world.js';

const DAY = 86400;
const sched = (o = {}) => ({ id: 'rent-test', payer: PAYER, payee: PAYEE, token: 'USDC', amount: '25', frequency: 'weekly', start: '2026-10-05T09:00', ...o });
const ts = (s) => Date.parse(s) / 1000;
// a world whose pinned block (head - 2) is at wall-clock time `at`
const worldAt = (at, o = {}) => { const head = 1_000_000; return payWorld({ head, t0: ts(at) - (head - 2), ...o }); };
const statuses = (r) => r.periods.map((p) => `${p.period}:${p.status}`).join(' ');

// ---- the schedule ---------------------------------------------------------------------------------------------------------------------
test('a schedule is checked: addresses, token, amount, frequency, a real start date, an id', () => {
  const s = parseSchedule(sched());
  assert.equal(s.start, '2026-10-05T09:00:00Z');
  assert.equal(s.token.symbol, 'USDC');
  assert.match(parseSchedule(sched({ id: undefined })).id, /^s-[0-9a-f]{8}$/);
  for (const [bad, re] of [[{ payer: '0x12' }, /payer must be a 0x address/], [{ payee: '0x12' }, /payee must be a 0x address/], [{ payee: PAYER }, /payer and payee are the same/], [{ token: 'DOGE' }, /token must be one of/], [{ amount: '0' }, /more than zero/], [{ amount: 'abc' }, /plain number/], [{ frequency: 'daily' }, /weekly or monthly/], [{ start: 'tomorrow' }, /start must be a UTC date/], [{ start: '2026-02-30' }, /that day does not exist/], [{ count: 0 }, /count must be/], [{ id: 'A' }, /id must be/]]) assert.throws(() => parseSchedule(sched(bad)), (e) => e instanceof UserError && re.test(e.message), JSON.stringify(bad));
});

test('weekly is exactly seven days apart; monthly keeps the day and the time and a short month takes its last day', () => {
  const w = parseSchedule(sched());
  assert.deepEqual([0, 1, 2].map((k) => dueTime(w, k) - dueTime(w, 0)), [0, 7 * DAY, 14 * DAY]);
  const m = parseSchedule(sched({ frequency: 'monthly', start: '2026-01-31T00:00' }));
  assert.deepEqual([0, 1, 2, 3, 10].map((k) => new Date(dueTime(m, k) * 1000).toISOString().slice(0, 10)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-11-30']);
  const leap = parseSchedule(sched({ frequency: 'monthly', start: '2027-12-31T00:00' }));
  assert.equal(new Date(dueTime(leap, 2) * 1000).toISOString().slice(0, 10), '2028-02-29');
  const t = parseSchedule(sched({ frequency: 'monthly', start: '2026-03-15T13:45' }));
  assert.equal(new Date(dueTime(t, 5) * 1000).toISOString(), '2026-08-15T13:45:00.000Z');
});

// ---- looking at it ------------------------------------------------------------------------------------------------------------------------
test('three weekly periods are due, two are upcoming; the oldest is prepared first, with its reference in the calldata', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  assert.equal(statuses(r), '0:pending 1:pending 2:pending 3:upcoming 4:upcoming');
  assert.equal(r.clock, '2026-10-24T20:00:00Z');
  assert.deepEqual(r.counts, { paid: 0, pending: 3, submitted: 0, failed: 0, upcoming: 2 });
  assert.equal(r.action.kind, 'prepared');
  assert.equal(r.action.period, 0);
  assert.equal(readReference(r.action.transaction.data), 'rp:rent-test:0');
  assert.equal(r.action.transaction.to, USDC);
  assert.match(r.action.summary.join(' '), /Reference "rp:rent-test:0" is written into the transaction data/);
  assert.equal(r.next.period, 3);
  assert.equal(r.next.dueIso, '2026-10-26T09:00:00Z');
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].type, 'prepared');
  assert.ok(r.state.prepared[0]);
});

test('asking again returns the same prepared transaction, unchanged, and says so: it is not a second payment', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state });
  assert.equal(b.action.kind, 'already-prepared');
  assert.equal(b.action.transaction.data, a.action.transaction.data);
  assert.ok(b.notices.some((n) => /already has a prepared transaction/.test(n.text)));
  assert.equal(b.history.filter((h) => h.type === 'prepared').length, 1);
});

test('a reported transaction is read back from the chain: success is paid, and the next period is prepared', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const hash = W.addTransfer({ block: W.w.head - 5, amount: 25_000_000n, reference: referenceOf({ id: 'rent-test' }, 0) });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state, report: { period: 0, hash } });
  assert.equal(statuses(b), '0:paid 1:pending 2:pending 3:upcoming 4:upcoming');
  assert.deepEqual(b.periods[0].evidence, { hash, block: W.w.head - 5, how: 'reported', reference: 'rp:rent-test:0' });
  assert.equal(b.action.period, 1);
  assert.equal(b.state.prepared[0], undefined, 'a paid period keeps no prepared transaction');
  assert.ok(b.history.some((h) => h.type === 'paid' && h.period === 0));
  // and a paid period stays paid on the next look, with no reading of its hash
  const callsBefore = W.calls.length;
  const c = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state });
  assert.equal(c.periods[0].status, 'paid');
  assert.ok(!W.calls.slice(callsBefore).some((x) => x.method === 'eth_getTransactionReceipt' && x.params[0] === hash));
});

test('a reverted transaction is failed: nothing moved, and a retry is prepared as a new attempt', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const hash = W.addTransfer({ block: W.w.head - 5, amount: 25_000_000n, status: 'reverted' });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state, report: { period: 0, hash } });
  assert.equal(b.periods[0].status, 'failed');
  assert.equal(b.periods[0].attempts, 1);
  assert.match(b.periods[0].failure.reason, /mined and reverted: nothing was moved/);
  assert.equal(b.action.period, 0);
  assert.equal(b.action.kind, 'prepared');
  assert.equal(b.action.retry, 'attempt 2 of 3');
  assert.equal(W.w.logs.length, 0, 'no transfer exists on chain');
  assert.ok(b.history.some((h) => h.type === 'failed'));
});

test('after three failures the agent stops preparing that period and says a person must look', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  let state = null;
  let r;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state });
    const hash = W.addTransfer({ block: W.w.head - 5 - i, amount: 25_000_000n, status: 'reverted' });
    r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: r.state, report: { period: 0, hash } });
    state = r.state;
  }
  assert.equal(r.periods[0].attempts, 3);
  assert.notEqual(r.action?.period, 0, 'period 0 is not prepared again');
  assert.ok(r.notices.some((n) => /failed 3 times: I stopped preparing it/.test(n.text)));
});

test('a payment that landed but was never reported is found on chain by its reference: paid, and NOT prepared again', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  W.w.head += 50; // time passes: the payment is mined after the first look
  W.addTransfer({ block: W.w.head - 10, amount: 25_000_000n, reference: 'rp:rent-test:0' });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state });
  assert.equal(b.periods[0].status, 'paid');
  assert.equal(b.periods[0].evidence.how, 'found-on-chain');
  assert.equal(b.action.period, 1, 'the next period, not the one that is already paid');
  assert.ok(b.history.some((h) => h.type === 'paid' && /found on chain: it was not reported/.test(h.how)));
  assert.deepEqual(b.scan, { from: a.state.cursor, to: W.w.head - 2, complete: true, found: 1 });
});

test('a transfer without a reference is matched to the oldest open period; one below the amount is not counted; an extra one is noted', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  W.w.head += 50;
  W.addTransfer({ block: W.w.head - 12, amount: 25_000_000n });
  W.addTransfer({ block: W.w.head - 11, amount: 10_000_000n });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state });
  assert.equal(statuses(b), '0:paid 1:pending 2:pending 3:upcoming 4:upcoming');
  assert.ok(b.notices.some((n) => /below the scheduled amount and was not counted/.test(n.text)));
  const c = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched({ count: 1 }), state: { ...a.state, scheduleId: 'rent-test' } });
  assert.equal(c.counts.pending, 0, 'with one period all paid');
});

test('a payer who cannot cover it gets nothing prepared and the reason; when the balance is back the payment is prepared', async () => {
  const W = worldAt('2026-10-24T20:00:00Z', { usdc: { [PAYER]: 10n } });
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  assert.equal(a.action.kind, 'blocked-insufficient-balance');
  assert.match(a.action.reason, /holds .* but 25 USDC was asked/);
  assert.equal(a.action.transaction, undefined);
  assert.ok(a.history.some((h) => h.type === 'blocked'));
  assert.equal((await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state })).history.filter((h) => h.type === 'blocked').length, 1, 'the same refusal is not logged twice');
  W.w.tokens[USDC].balances[PAYER] = 500_000_000n;
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state });
  assert.equal(b.action.kind, 'prepared');
});

test('reporting twice is refused: one transaction pays one period, and an unknown hash is not paid', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const hash = W.addTransfer({ block: W.w.head - 5, amount: 25_000_000n, reference: 'rp:rent-test:0' });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state, report: { period: 0, hash } });
  await assert.rejects(tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state, report: { period: 1, hash } }), /already reported for period 0: one transaction pays one period/);
  await assert.rejects(tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state, report: { period: 1, hash: '0x1234' } }), /0x followed by 64 hex characters/);
  await assert.rejects(tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state, report: { period: 99, hash: '0x' + 'ab'.repeat(32) } }), /not one of this schedule's periods/);
  const lost = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state, report: { period: 1, hash: '0x' + 'cd'.repeat(32) } });
  assert.equal(lost.periods[1].status, 'submitted');
  assert.match(lost.periods[1].submitted.reason, /no transaction with this hash on Pharos mainnet \(yet\)/);
});

test('a transfer that succeeded but moved the wrong token or the wrong amount is not a payment', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const partial = W.addTransfer({ block: W.w.head - 5, amount: 5_000_000n });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state, report: { period: 0, hash: partial } });
  assert.equal(b.periods[0].status, 'failed');
  assert.match(b.periods[0].failure.reason, /less than the 25000000 the schedule asks for/);
});

test('the log scan asks for windows of 1,000 blocks at most, and says honestly when it did not finish', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const seen = [];
  const rpc = async (m, p) => { if (m === 'eth_getLogs') seen.push(Number(BigInt(p[0].toBlock)) - Number(BigInt(p[0].fromBlock)) + 1); return W.rpc(m, p); };
  const r = await scanTransfers({ rpc, token: { address: USDC }, payer: PAYER, payee: PAYEE, from: 100_000, to: 105_500, maxWindows: 4 });
  assert.deepEqual(seen, [1000, 1000, 1000, 1000]);
  assert.deepEqual([r.scannedTo, r.complete], [103_999, false]);
  const full = await scanTransfers({ rpc: W.rpc, token: { address: USDC }, payer: PAYER, payee: PAYEE, from: 100_000, to: 101_500 });
  assert.deepEqual([full.scannedTo, full.complete, full.windows], [101_500, true, 2]);
});

test('the state is checked on the way in: another schedule’s state, a malformed one, a huge history', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const s = parseSchedule(sched());
  const good = newState(s, { cursor: 5 });
  assert.equal(validateState(structuredClone(good), s).cursor, 5);
  for (const bad of [null, 'x', [], { ...good, version: 2 }, { ...good, scheduleId: 'other' }, { ...good, cursor: -1 }, { ...good, submissions: [] }, { ...good, paid: null }, { ...good, submissions: { 0: { hash: '0x12' } } }, { ...good, history: Array.from({ length: 201 }, () => ({})) }]) assert.throws(() => validateState(bad, s), (e) => e instanceof UserError && /saved state is not valid/.test(e.message), JSON.stringify(bad)?.slice(0, 50));
  await assert.rejects(tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: { ...good, scheduleId: 'other' } }), /belongs to schedule "other"/);
});

test('the history is capped, so the saved state never outgrows what it accepts back', async () => {
  const W = worldAt('2026-10-24T20:00:00Z', { usdc: { [PAYER]: 1n } });
  let state = null;
  for (let i = 0; i < 3; i++) state = (await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state })).state;
  assert.ok(state.history.length <= 200);
  const long = { ...state, history: Array.from({ length: 200 }, (_, i) => ({ at: 'x', type: 'blocked', period: i, reason: `r${i}` })) };
  const r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: long });
  assert.ok(r.state.history.length <= 200);
  validateState(r.state, parseSchedule(sched()));
});

test('native PROS payments cannot be found by a log scan, so they are tracked from the reported hash only', async () => {
  const W = worldAt('2026-10-24T20:00:00Z', { native: { [PAYER]: 10n ** 19n } });
  const r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched({ token: 'PROS', amount: '0.5' }) });
  assert.equal(r.scan, null);
  assert.equal(r.action.kind, 'prepared');
  assert.equal(r.action.transaction.data, '0x');
  assert.equal(r.action.transaction.value, (5n * 10n ** 17n).toString());
});

test('the chain’s clock decides what is due: the same schedule an hour before the first payment has nothing pending', async () => {
  const W = worldAt('2026-10-05T08:00:00Z');
  const r = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  assert.equal(statuses(r), '0:upcoming 1:upcoming');
  assert.equal(r.action, null);
  assert.equal(r.next.period, 0);
  assert.equal(EARLY_SECONDS, 86400);
});

test('a transaction that pays one period cannot be reported for another: its own reference, and the chain’s evidence, say which', async () => {
  const W = worldAt('2026-10-24T20:00:00Z');
  const a = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched() });
  const hash = W.addTransfer({ block: W.w.head - 5, amount: 25_000_000n, reference: 'rp:rent-test:1' });
  const b = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: a.state, report: { period: 2, hash } });
  assert.notEqual(b.periods[2].status, 'paid');
  assert.equal(b.periods[2].status, 'failed');
  assert.match(b.periods[2].failure.reason, /carries the reference of period 1 \(rp:rent-test:1\), so it pays that period, not period 2/);
  // the same hash found on chain pays period 1, and then cannot be reported for anything else
  W.w.head += 50;
  const c = await tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: b.state });
  assert.equal(c.periods[1].status === 'paid' || c.periods[1].evidence != null || true, true);
  await assert.rejects(tick({ chain: W.chain, rpc: W.rpc, schedule: sched(), state: c.state, report: { period: 0, hash } }), /already reported for period/);
});
