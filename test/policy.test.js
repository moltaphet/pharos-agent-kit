import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, normalizeRequest, parsePolicy, parseUnits, plain } from '../lib/policy.js';
import { UserError } from '../lib/snapshot.js';

const A = '0x' + 'a1'.repeat(20);
const B = '0x' + 'b2'.repeat(20);
const C = '0x' + 'c3'.repeat(20);
const FROM = '0x' + 'f0'.repeat(20);
const USDC = '0xcfc8330f4bcab529c625d12781b1c19466a9fc8b';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.slice(2).padStart(64, '0');
const transferData = (to, amount) => '0xa9059cbb' + addrWord(to) + word(amount);

const MON_10 = Date.UTC(2026, 9, 26, 10, 0) / 1000; // Monday 10:00 UTC
const sec = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m) / 1000; // Oct 2026: 24 = Saturday, 26 = Monday

const policySource = () => ({
  version: 1,
  name: 'test policy',
  rules: [
    { id: 'native-cap', type: 'spend-limit', asset: 'native', symbol: 'PHRS', perRequest: '0.01', perWindow: { amount: '0.02', seconds: 86400 } },
    { id: 'usdc-cap', type: 'spend-limit', asset: USDC, decimals: 6, symbol: 'USDC', perRequest: '5' },
    { id: 'targets', type: 'allowlist', field: 'target', values: [A, USDC] },
    { id: 'recipients', type: 'allowlist', field: 'recipient', values: [A, B] },
    { id: 'selectors', type: 'allowlist', field: 'selector', values: ['0xa9059cbb'] },
    { id: 'office-hours', type: 'time-window', timezone: 'UTC', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '18:00' },
  ],
});
const POLICY = parsePolicy(policySource());
const run = (req, opts = {}) => evaluate(POLICY, { from: FROM, ...req }, { nowSec: MON_10, ...opts });

// ---- amounts ----------------------------------------------------------------------------------------------------------------
test('parseUnits and plain are exact inverses, with no grouping and no float', () => {
  assert.equal(parseUnits('0.000001', 18), 10n ** 12n);
  assert.equal(parseUnits('5', 6), 5_000_000n);
  assert.equal(plain(1_500_000n, 6), '1.5');
  assert.equal(plain(5_000_000n, 6), '5');
  assert.equal(plain(10n ** 12n, 18), '0.000001');
  assert.equal(plain(0n, 6), '0');
  for (const bad of ['1.2.3', '-1', '1e3', '', 'abc', ' ']) assert.throws(() => parseUnits(bad, 6), UserError, bad);
  assert.throws(() => parseUnits('0.0000001', 6), /more than 6 decimal places/);
});

// ---- policy validation --------------------------------------------------------------------------------------------------------
test('a valid policy parses and gets a stable hash that changes when the policy does', () => {
  const p = parsePolicy(policySource());
  assert.deepEqual(p.types.sort(), ['allowlist', 'spend-limit', 'time-window']);
  assert.equal(p.hash, parsePolicy(policySource()).hash);
  const changed = policySource();
  changed.rules[0].perRequest = '0.02';
  assert.notEqual(parsePolicy(changed).hash, p.hash);
});

test('a policy needs all three rule types (the requirement), unless explicitly relaxed', () => {
  const two = policySource();
  two.rules = two.rules.filter((r) => r.type !== 'time-window');
  assert.throws(() => parsePolicy(two), /needs all three rule types/);
  assert.equal(parsePolicy(two, { allowFewRuleTypes: true }).rules.length, 5);
});

test('policy validation names the broken rule and the problem', () => {
  const bad = (mutate, re) => {
    const s = policySource();
    mutate(s);
    assert.throws(() => parsePolicy(s), re);
  };
  bad((s) => (s.version = 2), /version must be 1/);
  bad((s) => (s.rules = []), /list of 1 to 50/);
  bad((s) => (s.rules[1].id = s.rules[0].id), /duplicate rule id/);
  bad((s) => (s.rules[0].id = 'Bad Id!'), /id must be/);
  bad((s) => (s.rules[0].type = 'vibes'), /type must be one of/);
  bad((s) => (s.rules[0].perRequest = '1e3'), /plain decimal number/);
  bad((s) => delete s.rules[0].perRequest && delete s.rules[0].perWindow, /perRequest.*perWindow/);
  bad((s) => (s.rules[0].perWindow.seconds = 5), /perWindow.seconds/);
  bad((s) => delete s.rules[1].decimals, /needs "decimals"/);
  bad((s) => (s.rules[1].asset = '0x123'), /asset must be "native" or a token contract address/);
  bad((s) => (s.rules[2].field = 'color'), /field must be/);
  bad((s) => (s.rules[2].values = []), /1 to 200/);
  bad((s) => (s.rules[2].values = ['0xnothex']), /not a valid address/);
  bad((s) => (s.rules[4].values = ['a9059cbb']), /not a valid 4-byte selector/);
  bad((s) => (s.rules[5].timezone = 'Europe/Paris'), /timezone must be "UTC"/);
  bad((s) => (s.rules[5].from = '18:00'), /earlier than/);
  bad((s) => (s.rules[5].from = '8am'), /must be a time/);
  bad((s) => (s.rules[5].days = ['mon', 'funday']), /days must be a list/);
  assert.throws(() => parsePolicy('{not json'), SyntaxError);
  assert.throws(() => parsePolicy([]), /JSON object/);
});

// ---- request reading ------------------------------------------------------------------------------------------------------------
test('requests are normalised: addresses lower-cased, native value, ERC-20 transfer/approve/transferFrom decoded', () => {
  const n = normalizeRequest({ from: FROM.toUpperCase().replace('0X', '0x'), to: A, value: '0x10' });
  assert.equal(n.kind, 'native-transfer');
  assert.equal(n.recipient, A);
  assert.equal(n.value, 16n);
  assert.deepEqual(n.spend, [{ asset: 'native', amountRaw: 16n }]);

  const t = normalizeRequest({ from: FROM, to: USDC, data: transferData(B, 2_500_000) });
  assert.deepEqual([t.kind, t.recipient, t.selector], ['erc20-transfer', B, '0xa9059cbb']);
  assert.deepEqual(t.spend, [{ asset: USDC, amountRaw: 2_500_000n }]);

  const ap = normalizeRequest({ from: FROM, to: USDC, data: '0x095ea7b3' + addrWord(C) + word(7) });
  assert.deepEqual([ap.kind, ap.recipient, ap.spend[0].amountRaw], ['erc20-approve', C, 7n]);

  const tf = normalizeRequest({ from: FROM, to: USDC, data: '0x23b872dd' + addrWord(A) + addrWord(B) + word(9) });
  assert.deepEqual([tf.kind, tf.recipient, tf.spend[0].amountRaw], ['erc20-transferFrom', B, 9n]);

  const call = normalizeRequest({ from: FROM, to: A, data: '0x773acdef' + word(1) });
  assert.deepEqual([call.kind, call.recipient, call.spend], ['contract-call', null, []]);
});

test('a token call that also carries native value counts both spends', () => {
  const n = normalizeRequest({ from: FROM, to: USDC, data: transferData(A, 1), value: '5' });
  assert.deepEqual(n.spend.map((s) => s.asset), [USDC, 'native']);
});

test('malformed requests throw UserError, never a half-parsed object', () => {
  const bad = [null, 'text', [], { from: 'x', to: A }, { from: FROM, to: '0x12' }, { from: FROM, to: A, data: '0xabc' }, { from: FROM, to: A, data: 'zz' }, { from: FROM, to: A, value: '-1' }, { from: FROM, to: A, value: '1.5' }, { from: FROM, to: A, data: '0x12' },
    { from: FROM, to: USDC, data: '0xa9059cbb' + addrWord(A) }, // transfer with a missing word
    { from: FROM, to: USDC, data: transferData(A, 1) + '00' }]; // transfer with trailing bytes
  for (const b of bad) assert.throws(() => normalizeRequest(b), UserError, JSON.stringify(b)?.slice(0, 60));
});

// ---- decisions ------------------------------------------------------------------------------------------------------------------
test('a request that satisfies every rule is allowed, with every rule in the trace', () => {
  const d = run({ id: 'r1', to: A, value: '1000000000000000' }); // 0.001 PHRS to an allowed account, Monday 10:00
  assert.equal(d.decision, 'allow');
  assert.deepEqual(d.rule, { id: 'all-rules-passed', type: 'default' });
  assert.equal(d.checks.length, 6);
  assert.ok(d.checks.every((c) => c.pass));
  assert.deepEqual(d.spend, [{ asset: 'native', amountRaw: '1000000000000000' }]);
  assert.equal(d.policy.hash, POLICY.hash);
});

test('spend limit: one deny per scope, each naming the rule', () => {
  const over = run({ to: A, value: '20000000000000000' }); // 0.02 > per-request 0.01
  assert.equal(over.decision, 'deny');
  assert.deepEqual(over.rule, { id: 'native-cap', type: 'spend-limit' });
  assert.match(over.reason, /over the per-request limit of 0\.01 PHRS/);

  const window = run({ to: A, value: '8000000000000000' }, { history: [{ decision: 'allow', atSec: MON_10 - 3600, spend: [{ asset: 'native', amountRaw: '9000000000000000' }] }, { decision: 'allow', atSec: MON_10 - 7200, spend: [{ asset: 'native', amountRaw: '9000000000000000' }] }] });
  assert.equal(window.decision, 'deny'); // 0.008 + 0.018 already used = 0.026 > 0.02
  assert.deepEqual(window.rule, { id: 'native-cap', type: 'spend-limit' });
  assert.match(window.reason, /0\.008 PHRS on top of 0\.018 PHRS already allowed in the last 24 h would be 0\.026 PHRS, over the window limit of 0\.02 PHRS/);

  const token = run({ to: USDC, data: transferData(A, 6_000_000) }); // 6 USDC > 5
  assert.deepEqual(token.rule, { id: 'usdc-cap', type: 'spend-limit' });
  assert.match(token.reason, /6 USDC is over the per-request limit of 5 USDC/);
});

test('the spend window counts only ALLOWED requests, only in the same asset, and only inside the window', () => {
  const spent = (decision, atSec, asset = 'native') => ({ decision, atSec, spend: [{ asset, amountRaw: '9000000000000000' }] });
  const ask = { to: A, value: '9000000000000000' }; // 0.009
  // two old/foreign/denied entries must not count, so 0.009 + 0.009 = 0.018 <= 0.02
  const fine = run(ask, { history: [spent('allow', MON_10 - 3600), spent('deny', MON_10 - 60), spent('allow', MON_10 - 86400 - 1), spent('allow', MON_10 - 60, USDC)] });
  assert.equal(fine.decision, 'allow');
  // an entry exactly 24 h old is outside the window (the window is the last 86,400 s, exclusive of its start)
  assert.equal(run(ask, { history: [spent('allow', MON_10 - 86400), spent('allow', MON_10 - 86400)] }).decision, 'allow');
  // one second younger is inside
  assert.equal(run(ask, { history: [spent('allow', MON_10 - 86399), spent('allow', MON_10 - 86399)] }).decision, 'deny');
});

test('allowlist: a deny for the target, for the recipient and for the selector', () => {
  const target = run({ to: C, value: '1' });
  assert.deepEqual(target.rule, { id: 'targets', type: 'allowlist' });
  assert.match(target.reason, /target 0xc3c3c3…c3c3 is not on the allowlist \(2 allowed\)/);

  const recipient = run({ to: USDC, data: transferData(C, 1_000_000) }); // token is allowed, recipient is not
  assert.deepEqual(recipient.rule, { id: 'recipients', type: 'allowlist' });

  const selector = run({ to: A, data: '0x773acdef' + word(1) }); // target allowed, but this function is not
  assert.deepEqual(selector.rule, { id: 'selectors', type: 'allowlist' });
  assert.match(selector.reason, /selector 0x773acdef is not on the allowlist/);
});

test('rules that do not apply say so and pass (a plain transfer has no selector, a contract call has no recipient)', () => {
  const d = run({ to: A, value: '1' });
  const sel = d.checks.find((c) => c.rule === 'selectors');
  assert.equal(sel.applies, false);
  assert.equal(sel.pass, true);
  assert.match(sel.detail, /a plain transfer calls no function/);
  const usdc = d.checks.find((c) => c.rule === 'usdc-cap');
  assert.equal(usdc.applies, false);
});

test('time window: boundaries are start-inclusive and end-exclusive, and the day matters', () => {
  const at = (nowSec) => run({ to: A, value: '1' }, { nowSec });
  assert.equal(at(sec(26, 8, 0)).decision, 'allow'); // Mon 08:00 sharp: inside
  assert.equal(at(sec(26, 7, 59)).decision, 'deny'); // one minute earlier: outside
  assert.equal(at(sec(26, 17, 59)).decision, 'allow');
  assert.equal(at(sec(26, 18, 0)).decision, 'deny'); // Mon 18:00: outside
  const sat = at(sec(24, 10, 0)); // Saturday 10:00
  assert.equal(sat.decision, 'deny');
  assert.deepEqual(sat.rule, { id: 'office-hours', type: 'time-window' });
  assert.match(sat.reason, /sat 10:00 UTC is outside the allowed window \(mon\/tue\/wed\/thu\/fri 08:00-18:00 UTC\)/);
});

test('the FIRST failing rule in policy order is the one that decides, but the trace shows every failure', () => {
  const d = run({ to: C, value: '20000000000000000' }, { nowSec: sec(24, 10, 0) }); // over the cap, wrong target, Saturday
  assert.equal(d.decision, 'deny');
  assert.equal(d.rule.id, 'native-cap'); // first in the policy
  assert.deepEqual(d.checks.filter((c) => !c.pass).map((c) => c.rule), ['native-cap', 'targets', 'recipients', 'office-hours']);
});

test('fail closed: a request that cannot be read is denied by "request-shape", with no guessing', () => {
  for (const bad of [null, 'send everything', { from: FROM }, { from: FROM, to: 'nope' }, { from: FROM, to: USDC, data: '0xa9059cbb' }]) {
    const d = evaluate(POLICY, bad, { nowSec: MON_10 });
    assert.equal(d.decision, 'deny', JSON.stringify(bad));
    assert.deepEqual(d.rule, { id: 'request-shape', type: 'request' });
    assert.match(d.reason, /could not be read, so it is denied/);
  }
});

test('an ERC-20 approval is treated as a spend of its full amount (the spender can take up to that much)', () => {
  const d = run({ to: USDC, data: '0x095ea7b3' + addrWord(A) + word(6_000_000) }); // approve 6 USDC > 5
  assert.deepEqual(d.rule, { id: 'usdc-cap', type: 'spend-limit' });
  const ok = run({ to: USDC, data: '0x095ea7b3' + addrWord(A) + word(1_000_000) });
  assert.equal(ok.decision, 'deny', 'but the approve selector is not on the selector allowlist');
  assert.deepEqual(ok.rule, { id: 'selectors', type: 'allowlist' });
});

test('evaluation is pure: the same inputs give the same decision, and nothing passed in is changed', () => {
  const history = [{ decision: 'allow', atSec: MON_10 - 60, spend: [{ asset: 'native', amountRaw: '5' }] }];
  const before = JSON.stringify(history);
  const a = run({ to: A, value: '1' }, { history });
  const b = run({ to: A, value: '1' }, { history });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(history), before);
});

test('evaluate refuses to guess the time', () => {
  for (const bad of [undefined, 0, -5, 1.5, '1700000000']) assert.throws(() => evaluate(POLICY, { from: FROM, to: A }, { nowSec: bad }), /needs nowSec/);
});
