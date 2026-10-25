// Policy engine for the Policy Gatekeeper skill. Pure: no network, no clock, no files. The caller passes `now` and the history.
//
// A policy is JSON with at least three rule TYPES (the Arena's requirement), each rule with an id:
//   spend-limit   a cap on one asset (the native token, or an ERC-20), per request and/or per rolling window
//   allowlist     only these addresses / selectors may be the target, the recipient, or the called function
//   time-window   only inside these UTC days and hours
//
// evaluate() always evaluates EVERY rule and returns the full trace; the decision is "deny" when any rule fails, and the rule
// that decided is the first failing one in policy order. It fails closed: a request it cannot parse is denied, never guessed at.

import { createHash } from 'node:crypto';
import { isAddress } from './abi.js';
import { UserError } from './snapshot.js';

export const RULE_TYPES = ['spend-limit', 'allowlist', 'time-window'];
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SEL = { transfer: '0xa9059cbb', approve: '0x095ea7b3', transferFrom: '0x23b872dd' };
const MAX_RULES = 50;
const MAX_VALUES = 200;
const NATIVE = 'native';

// ---- amounts -------------------------------------------------------------------------------------------------------------
export function parseUnits(text, decimals, what = 'amount') {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new UserError('decimals must be a whole number from 0 to 36');
  if (typeof text === 'number' && (!Number.isFinite(text) || (Number.isInteger(text) && !Number.isSafeInteger(text)))) throw new UserError(`${what} must be an exact decimal string`);
  const s = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new UserError(`${what} must be a plain decimal number (got ${JSON.stringify(text)})`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new UserError(`${what} has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0'));
}
// 1500000, 6 -> "1.5". No digit grouping and no trailing zeros, so a reason reads the same as the policy that produced it.
export function plain(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

// ---- policy ----------------------------------------------------------------------------------------------------------------
const hhmm = (t, what) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? ''));
  if (!m) throw new UserError(`${what} must be a time like "08:30" (24-hour, UTC)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

function parseRule(r, i) {
  const where = `rule ${i + 1}${r?.id ? ` (${r.id})` : ''}`;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new UserError(`${where}: must be an object`);
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.id)) throw new UserError(`${where}: id must be 1-40 characters of a-z, 0-9 and "-"`);
  if (!RULE_TYPES.includes(r.type)) throw new UserError(`${where}: type must be one of ${RULE_TYPES.join(', ')}`);

  if (r.type === 'spend-limit') {
    const asset = r.asset === NATIVE ? NATIVE : String(r.asset ?? '').toLowerCase();
    if (asset !== NATIVE && !isAddress(asset)) throw new UserError(`${where}: asset must be "native" or a token contract address`);
    const decimals = asset === NATIVE ? 18 : (typeof r.decimals === 'number' ? r.decimals : NaN);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new UserError(`${where}: a token spend limit needs "decimals" (0 to 36)`);
    if (r.perRequest == null && r.perWindow == null) throw new UserError(`${where}: give "perRequest" and/or "perWindow"`);
    const out = { id: r.id, type: r.type, asset, decimals, symbol: String(r.symbol ?? (asset === NATIVE ? 'native token' : 'tokens')).slice(0, 12) };
    if (r.perRequest != null) out.perRequestRaw = parseUnits(r.perRequest, decimals, `${where} perRequest`);
    if (r.perWindow != null) {
      const seconds = Number(r.perWindow.seconds);
      if (!Number.isInteger(seconds) || seconds < 60 || seconds > 31 * 86400) throw new UserError(`${where}: perWindow.seconds must be a whole number from 60 to ${31 * 86400}`);
      out.perWindowRaw = parseUnits(r.perWindow.amount, decimals, `${where} perWindow.amount`);
      out.windowSeconds = seconds;
    }
    return out;
  }

  if (r.type === 'allowlist') {
    if (!['target', 'recipient', 'selector'].includes(r.field)) throw new UserError(`${where}: field must be "target" (the contract or account called), "recipient" (who receives funds) or "selector" (the function)`);
    if (!Array.isArray(r.values) || r.values.length === 0 || r.values.length > MAX_VALUES) throw new UserError(`${where}: values must be a list of 1 to ${MAX_VALUES} entries`);
    const values = r.values.map((v) => String(v).toLowerCase());
    const ok = r.field === 'selector' ? (v) => /^0x[0-9a-f]{8}$/.test(v) : isAddress;
    const bad = values.find((v) => !ok(v));
    if (bad !== undefined) throw new UserError(`${where}: ${JSON.stringify(bad)} is not a valid ${r.field === 'selector' ? '4-byte selector like 0xa9059cbb' : 'address'}`);
    return { id: r.id, type: r.type, field: r.field, values: [...new Set(values)] };
  }

  // time-window
  if (r.timezone !== 'UTC') throw new UserError(`${where}: timezone must be "UTC" (local time zones and daylight saving make a window ambiguous)`);
  const days = r.days == null ? [...DAYS] : r.days;
  if (!Array.isArray(days) || days.length === 0 || days.some((d) => !DAYS.includes(d))) throw new UserError(`${where}: days must be a list from ${DAYS.join(', ')}`);
  const from = hhmm(r.from, `${where} from`);
  const to = hhmm(r.to, `${where} to`);
  if (from >= to) throw new UserError(`${where}: "from" must be earlier than "to" (a window cannot cross midnight; use two rules' worth of days instead)`);
  return { id: r.id, type: r.type, timezone: 'UTC', days: [...new Set(days)], from, to, fromText: r.from, toText: r.to };
}

export function parsePolicy(input, { allowFewRuleTypes = false } = {}) {
  const p = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new UserError('a policy must be a JSON object');
  if (p.version !== 1) throw new UserError('policy.version must be 1');
  if (!Array.isArray(p.rules) || p.rules.length === 0 || p.rules.length > MAX_RULES) throw new UserError(`policy.rules must be a list of 1 to ${MAX_RULES} rules`);
  const rules = p.rules.map(parseRule);
  const ids = new Set();
  for (const r of rules) {
    if (ids.has(r.id)) throw new UserError(`duplicate rule id "${r.id}"`);
    ids.add(r.id);
  }
  const types = new Set(rules.map((r) => r.type));
  if (!allowFewRuleTypes && types.size < 3) throw new UserError(`a policy needs all three rule types (${RULE_TYPES.join(', ')}); this one is missing ${RULE_TYPES.filter((t) => !types.has(t)).join(', ')}`);
  // Identifies the exact policy a decision was made under; the audit log records it.
  const hash = createHash('sha256').update(JSON.stringify(p)).digest('hex');
  return { name: String(p.name ?? 'policy').slice(0, 80), hash, rules, types: [...types] };
}

// ---- requests ----------------------------------------------------------------------------------------------------------------
// Turns a request into what the rules look at. Throws UserError for anything malformed: evaluate() turns that into a DENY.
export function normalizeRequest(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new UserError('the request must be an object');
  const lower = (v) => String(v ?? '').toLowerCase();
  const from = lower(input.from);
  const to = lower(input.to);
  if (!isAddress(from)) throw new UserError('"from" must be a 0x address');
  if (!isAddress(to)) throw new UserError('"to" must be a 0x address');
  const data = lower(input.data ?? '0x') || '0x';
  if (!/^0x([0-9a-f]{2})*$/.test(data)) throw new UserError('"data" must be 0x followed by whole bytes of hex');
  const rawValue = input.value ?? '0';
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(String(rawValue))) throw new UserError('"value" must be a whole number of wei (decimal or 0x hex)');
  if (typeof rawValue === 'number' && !Number.isSafeInteger(rawValue)) throw new UserError('"value" must be an exact whole number of wei');
  const value = BigInt(rawValue);
  if (value >= 1n << 256n) throw new UserError('"value" exceeds uint256');
  const selector = data.length >= 10 ? data.slice(0, 10) : null;
  if (data !== '0x' && data.length < 10) throw new UserError('"data" is shorter than a function selector');
  const words = data.length > 10 ? data.slice(10).match(/.{1,64}/g) : [];
  const word = (i) => words[i];
  const addr = (w) => {
    if (!/^0{24}[0-9a-f]{40}$/.test(w)) throw new UserError('calldata contains a noncanonical ABI address');
    return '0x' + w.slice(24);
  };
  const wellFormed = (n) => words.length === n && words.every((w) => w.length === 64);

  const spend = [];
  let kind = 'contract-call';
  let recipient = null;
  if (data === '0x') {
    kind = 'native-transfer';
    recipient = to;
  } else if (selector === SEL.transfer) {
    if (!wellFormed(2)) throw new UserError('calldata does not match transfer(address,uint256)');
    kind = 'erc20-transfer';
    recipient = addr(word(0));
    spend.push({ asset: to, amountRaw: BigInt('0x' + word(1)) });
  } else if (selector === SEL.approve) {
    if (!wellFormed(2)) throw new UserError('calldata does not match approve(address,uint256)');
    kind = 'erc20-approve'; // an approval is a spend ceiling: the spender may take up to this much
    recipient = addr(word(0));
    spend.push({ asset: to, amountRaw: BigInt('0x' + word(1)) });
  } else if (selector === SEL.transferFrom) {
    if (!wellFormed(3)) throw new UserError('calldata does not match transferFrom(address,address,uint256)');
    kind = 'erc20-transferFrom';
    addr(word(0)); // validate the source address too
    recipient = addr(word(1));
    spend.push({ asset: to, amountRaw: BigInt('0x' + word(2)) });
  }
  if (value > 0n) spend.push({ asset: NATIVE, amountRaw: value });
  return { id: String(input.id ?? '').slice(0, 60) || null, from, to, data, value, selector, kind, recipient, spend };
}

// ---- evaluation --------------------------------------------------------------------------------------------------------------
const nowParts = (nowSec) => {
  const d = new Date(nowSec * 1000);
  return { day: DAYS[d.getUTCDay()], minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), text: `${DAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC` };
};
const shorten = (a) => (a && a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

function checkRule(rule, req, ctx) {
  const base = { rule: rule.id, type: rule.type };

  if (rule.type === 'spend-limit') {
    const mine = req.spend.filter((s) => s.asset === rule.asset);
    if (mine.length === 0) return { ...base, applies: false, pass: true, detail: `this request spends no ${rule.asset === NATIVE ? 'native token' : 'of that token'}, so the limit does not apply` };
    const amount = mine.reduce((sum, s) => sum + s.amountRaw, 0n);
    const f = (raw) => `${plain(raw, rule.decimals)} ${rule.symbol}`;
    if (rule.perRequestRaw != null && amount > rule.perRequestRaw) return { ...base, applies: true, pass: false, detail: `${f(amount)} is over the per-request limit of ${f(rule.perRequestRaw)}` };
    if (rule.perWindowRaw != null) {
      const since = ctx.nowSec - rule.windowSeconds;
      const used = ctx.history.filter((e) => e.decision === 'allow' && e.atSec > since && e.atSec <= ctx.nowSec).flatMap((e) => e.spend ?? []).filter((s) => s.asset === rule.asset).reduce((sum, s) => sum + BigInt(s.amountRaw), 0n);
      if (used + amount > rule.perWindowRaw) return { ...base, applies: true, pass: false, detail: `${f(amount)} on top of ${f(used)} already allowed in the last ${rule.windowSeconds / 3600} h would be ${f(used + amount)}, over the window limit of ${f(rule.perWindowRaw)}` };
      return { ...base, applies: true, pass: true, detail: `${f(amount)} (${f(used)} already used of ${f(rule.perWindowRaw)} in the last ${rule.windowSeconds / 3600} h)` };
    }
    return { ...base, applies: true, pass: true, detail: `${f(amount)} is within the per-request limit of ${f(rule.perRequestRaw)}` };
  }

  if (rule.type === 'allowlist') {
    const subject = rule.field === 'target' ? req.to : rule.field === 'recipient' ? req.recipient : req.selector;
    if (subject == null) return { ...base, applies: false, pass: true, detail: `this request has no ${rule.field} to check (${rule.field === 'selector' ? 'a plain transfer calls no function' : 'it moves no funds to anyone'})` };
    const ok = rule.values.includes(subject);
    return { ...base, applies: true, pass: ok, detail: ok ? `${rule.field} ${shorten(subject)} is on the allowlist` : `${rule.field} ${rule.field === 'selector' ? subject : shorten(subject)} is not on the allowlist (${rule.values.length} allowed)` };
  }

  // time-window
  const { day, minutes, text } = nowParts(ctx.nowSec);
  const inDay = rule.days.includes(day);
  const inTime = minutes >= rule.from && minutes < rule.to;
  const ok = inDay && inTime;
  const window = `${rule.days.length === 7 ? 'every day' : rule.days.join('/')} ${rule.fromText}-${rule.toText} UTC`;
  return { ...base, applies: true, pass: ok, detail: ok ? `${text} is inside the allowed window (${window})` : `${text} is outside the allowed window (${window})` };
}

// -> { decision: 'allow'|'deny', rule: {id,type}, reason, checks, request, spend, atSec, policy }
export function evaluate(policy, requestInput, { nowSec, history = [] }) {
  if (!Number.isInteger(nowSec) || nowSec <= 0) throw new UserError('evaluate needs nowSec, the current time in whole seconds since 1970');
  const policyRef = { name: policy.name, hash: policy.hash };
  let req;
  try {
    req = normalizeRequest(requestInput);
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    // Fail closed: a request we cannot read is a request we do not let through.
    return { decision: 'deny', rule: { id: 'request-shape', type: 'request' }, reason: `the request could not be read, so it is denied: ${err.message}`, checks: [], request: { raw: JSON.stringify(requestInput)?.slice(0, 300) ?? String(requestInput) }, spend: [], atSec: nowSec, policy: policyRef };
  }
  const ctx = { nowSec, history };
  const checks = policy.rules.map((r) => checkRule(r, req, ctx));
  const failed = checks.find((c) => !c.pass);
  const summary = { id: req.id, from: req.from, to: req.to, selector: req.selector, kind: req.kind, recipient: req.recipient, valueWei: req.value.toString() };
  const spend = req.spend.map((s) => ({ asset: s.asset, amountRaw: s.amountRaw.toString() }));
  if (failed) {
    return { decision: 'deny', rule: { id: failed.rule, type: failed.type }, reason: `denied by rule "${failed.rule}" (${failed.type}): ${failed.detail}`, checks, request: summary, spend, atSec: nowSec, policy: policyRef };
  }
  return { decision: 'allow', rule: { id: 'all-rules-passed', type: 'default' }, reason: `allowed: all ${checks.length} rules passed (${checks.filter((c) => c.applies).length} applied)`, checks, request: summary, spend, atSec: nowSec, policy: policyRef };
}
