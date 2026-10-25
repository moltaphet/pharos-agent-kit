import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, parseSchedule, newState } from '../lib/recurring.js';
import { PAYER, PAYEE, payWorld } from './support/pay-world.js';

const ts = Date.parse('2026-10-24T20:00:00Z') / 1000;
const world = () => payWorld({ t0: ts - 999998 });
const schedule = (o = {}) => ({ id: 'audit-rent', payer: PAYER, payee: PAYEE, token: 'USDC', amount: '25', frequency: 'weekly', start: '2026-10-05T09:00', ...o });
const run = (W, o = {}) => tick({ chain: W.chain, rpc: W.rpc, schedule: schedule(), ...o });

test('audit: recurring custom-token amount uses its real on-chain decimals', async () => {
  const W = world(), token = '0x' + '99'.repeat(20);
  W.w.tokens[token] = { symbol: 'CUSTOM', decimals: 6, balances: { [PAYER]: 100_000_000n } };
  const r = await run(W, { schedule: schedule({ token }) });
  assert.equal(r.action.kind, 'prepared');
  assert.equal(r.schedule.token.decimals, 6);
  assert.equal(BigInt('0x' + r.action.transaction.data.slice(74, 138)), 25_000_000n);
});
test('audit: another schedule reference cannot settle this schedule automatically or by reported hash', async () => {
  const W = world();
  const hash = W.addTransfer({ block: W.w.head - 2, amount: 25_000_000n, reference: 'rp:other-rent:0' });
  const a = await run(W);
  assert.equal(a.counts.paid, 0);
  const b = await run(W, { report: { period: 0, hash } });
  assert.notEqual(b.periods[0].status, 'paid');
});
test('audit: a duplicated untagged transaction log is assigned once', async () => {
  const W = world();
  W.addTransfer({ block: W.w.head - 2, amount: 25_000_000n });
  W.w.logs.push({ ...W.w.logs[0], logIndex: '0x1' });
  assert.equal((await run(W)).counts.paid, 1);
});
test('audit: removed chain logs and invalid period tags are never accepted as paid', async () => {
  const W = world();
  W.addTransfer({ block: W.w.head - 2, amount: 25_000_000n, reference: 'rp:audit-rent:999' });
  W.addTransfer({ block: W.w.head - 2, amount: 25_000_000n });
  W.w.logs[1].removed = true;
  const r = await run(W);
  assert.deepEqual(r.state.paid, {});
});
test('audit: a pending transaction cannot be overwritten by another report', async () => {
  const W = world();
  const a = await run(W, { report: { period: 0, hash: '0x' + 'ab'.repeat(32) } });
  await assert.rejects(run(W, { state: a.state, report: { period: 0, hash: '0x' + 'cd'.repeat(32) } }), /pending|unresolved|submitted/i);
});
test('audit: a paid period cannot accept a new transaction report', async () => {
  const W = world();
  const hash = W.addTransfer({ block: W.w.head - 2, amount: 25_000_000n, reference: 'rp:audit-rent:0' });
  const a = await run(W, { report: { period: 0, hash } });
  await assert.rejects(run(W, { state: a.state, report: { period: 0, hash: '0x' + 'cd'.repeat(32) } }), /already paid/i);
});
test('audit: no payment is prepared until an incomplete history scan catches up', async () => {
  const W = world(), s = parseSchedule(schedule());
  const r = await run(W, { state: newState(s, { cursor: W.w.head - 40_000 }) });
  assert.equal(r.scan.complete, false);
  assert.equal(r.action.transaction, undefined);
  assert.match(r.action.reason, /scan|history/i);
});
test('audit: changing an explicit schedule id does not reuse payment evidence for a different amount', async () => {
  const W = world();
  const a = await run(W);
  await assert.rejects(run(W, { state: a.state, schedule: schedule({ amount: '50' }) }), /schedule|changed/i);
});
test('audit: reporting a receipt mined after the pinned block leaves it unconfirmed', async () => {
  const W = world();
  const hash = W.addTransfer({ block: W.w.head, amount: 25_000_000n, reference: 'rp:audit-rent:0' });
  const r = await run(W, { report: { period: 0, hash } });
  assert.equal(r.periods[0].status, 'submitted');
});
test('audit: a pre-schedule untagged transfer cannot settle a reported period', async () => {
  const W = world(), future = schedule({ start: '2026-10-25T09:00' });
  const hash = W.addTransfer({ block: 1, amount: 25_000_000n });
  const r = await run(W, { schedule: future, report: { period: 0, hash } });
  assert.notEqual(r.periods[0].status, 'paid');
});
test('audit: repeated preparation returns the exact same unsigned transaction even if pending nonce changes', async () => {
  const W = world();
  let nonce = 7n;
  const rpc = async (method, params) => method === 'eth_getTransactionCount' ? '0x' + (nonce++).toString(16) : W.rpc(method, params);
  const first = await run(W, { rpc });
  const second = await run(W, { rpc, state: first.state });
  assert.equal(second.action.kind, 'already-prepared');
  assert.deepEqual(second.action.transaction, first.action.transaction);
});
