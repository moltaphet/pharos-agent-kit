// The Recurring Payment Agent's engine: a weekly or monthly schedule (amount, token, recipient) in, and for every period its status, the next payment and, when one is
// due and can be paid, the unsigned transaction for it. Nothing here signs or sends.
//
// "Paid" is a fact about the chain, not about the agent's own records. A period is paid when a transfer from the payer to the payee for at least the amount is on chain:
//   - the transaction hash the person reported (read back: receipt, status and the ERC-20 Transfer log), or
//   - a Transfer(payer, payee) log found by scanning the blocks since the schedule was created, even if nobody reported it.
// Every payment this agent prepares carries a reference ("rp:<schedule>:<period>") after the transfer's own calldata, so a transfer on chain can be tied to exactly
// one period. Before anything is prepared the chain is read again: that is what stops a payment that already landed from being made twice.

import { blockNumber, getBlock } from './chain.js';
import { publicRpc, makeReader, asUint, asString } from './onchain.js';
import { keccak256, selectorOf } from './keccak.js';
import { isAddress } from './abi.js';
import { assessTransfer, readReference, tokenBySymbol, tokenByAddress, parseDecimal, summaryLines, TOKENS, explorerTx } from './payments.js';
import { fmtUnits, SEL } from './defi.js';
import { tracer } from './steps.js';
import { UserError } from './snapshot.js';

export const FREQUENCIES = ['weekly', 'monthly'];
export const MAX_PERIODS = 120;
export const EARLY_SECONDS = 24 * 3600; // a payment up to a day before the due time counts for that period
export const MAX_ATTEMPTS = 3;
export const SCAN_WINDOW = 1000; // the most blocks the node answers a log query for
export const TRANSFER_TOPIC = '0x' + keccak256(Buffer.from('Transfer(address,address,uint256)'));
const DAY = 86400;
const topicAddr = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const iso = (ts) => new Date(ts * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const short = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;

// ---- the schedule ------------------------------------------------------------------------------------------------------------------------------

export function parseSchedule(input = {}) {
  const s = {};
  if (!isAddress(input.payer)) throw new UserError('payer must be a 0x address (the wallet that pays)');
  if (!isAddress(input.payee)) throw new UserError('payee must be a 0x address (who receives the payments)');
  s.payer = input.payer.toLowerCase();
  s.payee = input.payee.toLowerCase();
  if (s.payer === s.payee) throw new UserError('payer and payee are the same address');
  const tokenRef = String(input.token ?? '').trim();
  const token = isAddress(tokenRef) ? tokenByAddress(tokenRef) ?? { symbol: null, address: tokenRef.toLowerCase(), decimals: null, custom: true } : tokenBySymbol(tokenRef);
  if (!token) throw new UserError(`token must be one of ${TOKENS.map((t) => t.symbol).join(', ')} or a 0x contract address`);
  s.token = token.native ? { symbol: 'PROS', native: true, decimals: 18 } : { symbol: token.symbol, address: token.address, decimals: token.decimals };
  const decimals = token.decimals ?? 18;
  s.amount = String(input.amount ?? '').trim();
  if (parseDecimal(s.amount, decimals, 'amount') <= 0n) throw new UserError('amount must be more than zero');
  s.amount = s.amount.replace(/,/g, '');
  if (!FREQUENCIES.includes(input.frequency)) throw new UserError(`frequency must be ${FREQUENCIES.join(' or ')}`);
  s.frequency = input.frequency;
  const start = String(input.start ?? '');
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$/.test(start)) throw new UserError('start must be a UTC date like 2026-11-01, or with a time like 2026-11-01T09:00');
  const ts = Date.parse(start.length === 10 ? `${start}T00:00:00Z` : start.endsWith('Z') ? start : `${start}${start.length === 16 ? ':00' : ''}Z`) / 1000;
  if (!Number.isFinite(ts)) throw new UserError('start is not a real date');
  if (new Date(ts * 1000).toISOString().slice(0, 10) !== start.slice(0, 10)) throw new UserError('start is not a real date (that day does not exist)');
  s.start = iso(ts);
  s.count = input.count == null || input.count === '' ? null : Number(input.count);
  if (s.count != null && (!Number.isInteger(s.count) || s.count < 1 || s.count > MAX_PERIODS)) throw new UserError(`count must be a whole number from 1 to ${MAX_PERIODS}, or left empty for no end`);
  s.label = String(input.label ?? '').slice(0, 60);
  const given = input.id == null || input.id === '' ? null : String(input.id);
  if (given != null && !/^[a-z0-9][a-z0-9-]{2,31}$/.test(given)) throw new UserError('id must be 3 to 32 characters of a–z, 0–9 and -');
  s.id = given ?? `s-${keccak256(Buffer.from([s.payer, s.payee, s.token.symbol ?? s.token.address, s.amount, s.frequency, s.start].join('|'))).slice(0, 8)}`;
  return s;
}

// The due time of period k (0-based) as a unix time: weekly is exactly 7 days apart; monthly keeps the day of the month and the time of day, and a month
// that is too short takes its last day (the 31st becomes the 28th, 29th or 30th).
export function dueTime(schedule, k) {
  const start = new Date(schedule.start);
  if (schedule.frequency === 'weekly') return Math.floor(start.getTime() / 1000) + k * 7 * DAY;
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + k;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), last);
  return Math.floor(Date.UTC(y, m, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()) / 1000);
}
export const referenceOf = (schedule, k) => `rp:${schedule.id}:${k}`;

// ---- state -------------------------------------------------------------------------------------------------------------------------------------

const MAX_HISTORY = 200;
const scheduleHash = (s) => keccak256(Buffer.from([s.payer, s.payee, s.token.native ? 'native' : s.token.address, s.amount, s.frequency, s.start].join('|')));
export const newState = (schedule, { cursor }) => ({ version: 1, scheduleId: schedule.id, scheduleHash: scheduleHash(schedule), cursor, createdBlock: cursor, submissions: {}, prepared: {}, attempts: {}, paid: {}, history: [] });

export function validateState(state, schedule) {
  const bad = (what) => { throw new UserError(`the saved state is not valid (${what}); press "Reset saved state" and run again`); };
  if (typeof state !== 'object' || state === null || Array.isArray(state)) bad('it is not an object');
  if (state.version !== 1) bad('unknown version');
  if (state.scheduleId !== schedule.id) bad(`it belongs to schedule "${state.scheduleId}", not "${schedule.id}"`);
  if (state.scheduleHash != null && state.scheduleHash !== scheduleHash(schedule)) bad('the schedule payment terms changed');
  state.scheduleHash = scheduleHash(schedule);
  if (!Number.isSafeInteger(state.cursor) || state.cursor < 0) bad('cursor must be a block number');
  for (const key of ['submissions', 'prepared', 'attempts', 'paid']) if (typeof state[key] !== 'object' || state[key] === null || Array.isArray(state[key])) bad(`${key} must be an object`);
  for (const [k, v] of Object.entries(state.submissions)) if (!/^\d+$/.test(k) || !/^0x[0-9a-f]{64}$/.test(v?.hash ?? '')) bad('a reported transaction has the wrong shape');
  for (const key of ['submissions', 'prepared', 'attempts', 'paid']) for (const k of Object.keys(state[key])) if (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= MAX_PERIODS) bad('invalid period number');
  for (const v of Object.values(state.attempts)) if (!Number.isSafeInteger(v) || v < 0) bad('attempts must be non-negative whole numbers');
  const hashes = new Set();
  for (const v of Object.values(state.paid)) {
    if (!v || !/^0x[0-9a-f]{64}$/.test(v.hash ?? '') || !Number.isSafeInteger(v.block) || v.block < 0) bad('a paid transaction has the wrong shape');
    if (hashes.has(v.hash)) bad('one transaction cannot pay two periods');
    hashes.add(v.hash);
  }
  for (const v of Object.values(state.prepared)) if (!v || typeof v !== 'object' || typeof v.data !== 'string' || !isAddress(v.to) || (v.transaction != null && (typeof v.transaction !== 'object' || v.transaction.data !== v.data || v.transaction.to !== v.to))) bad('a prepared transaction has the wrong shape');
  if (!Array.isArray(state.history) || state.history.length > MAX_HISTORY) bad(`history must be a list of at most ${MAX_HISTORY}`);
  if (state.history.some((v) => !v || typeof v !== 'object' || Array.isArray(v))) bad('history entries must be objects');
  return state;
}

// ---- reading the chain -------------------------------------------------------------------------------------------------------------------------

const hexNum = (h) => Number(BigInt(h));

// Transfer(payer → payee) logs of the token between two blocks, in windows the node accepts. Returns what it found and how far it really got.
export async function scanTransfers({ rpc, token, payer, payee, from, to, maxWindows = 30 }) {
  const logs = [];
  let scannedTo = from - 1;
  let windows = 0;
  for (let start = from; start <= to && windows < maxWindows; start += SCAN_WINDOW, windows++) {
    const end = Math.min(start + SCAN_WINDOW - 1, to);
    const got = await rpc('eth_getLogs', [{ address: token.address, topics: [TRANSFER_TOPIC, topicAddr(payer), topicAddr(payee)], fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16) }]);
    for (const l of got) if (!l.removed) logs.push({ hash: l.transactionHash, block: hexNum(l.blockNumber), logIndex: hexNum(l.logIndex), amount: BigInt(l.data) });
    scannedTo = end;
  }
  return { logs, scannedFrom: from, scannedTo, complete: scannedTo >= to, windows };
}

// The reference a payment's transaction carries (null when it carries none), read from the transaction's input.
async function referenceOfTx(rpc, hash) {
  const tx = await rpc('eth_getTransactionByHash', [hash]);
  return tx?.input ? readReference(tx.input) : null;
}

// What the chain says about a transaction the person reported.
async function readReported({ rpc, chain, at, schedule, hash, amountRaw, period = null }) {
  const [receipt, tx] = await Promise.all([rpc('eth_getTransactionReceipt', [hash]), rpc('eth_getTransactionByHash', [hash])]);
  if (!tx) return { state: 'unknown', detail: 'no transaction with this hash on Pharos mainnet (yet): it may not have been broadcast' };
  if (!receipt) return { state: 'pending', detail: 'the transaction is known but not mined yet' };
  const block = hexNum(receipt.blockNumber);
  if (block > at) return { state: 'pending', detail: 'the receipt is newer than the pinned block and is not confirmed here yet' };
  if (receipt.status !== '0x1') return { state: 'failed', block, detail: 'the transaction was mined and reverted: nothing was moved', gasUsed: hexNum(receipt.gasUsed) };
  const reference = readReference(tx.input, { native: Boolean(schedule.token.native) });
  const tagged = reference?.match(/^rp:([a-z0-9-]+):(\d+)$/);
  if (reference && (!tagged || tagged[1] !== schedule.id)) return { state: 'mismatch', block, detail: 'it carries a reference for a different payment or schedule' };
  if (tagged && period != null && Number(tagged[2]) !== period) return { state: 'mismatch', block, detail: `it carries the reference of period ${tagged[2]} (${reference}), so it pays that period, not period ${period}` };
  if (!tagged && period != null) {
    const header = await getBlock(chain, block, 'Time of the reported transfer: it must belong to this schedule');
    if (header.timestamp < dueTime(schedule, period) - EARLY_SECONDS) return { state: 'mismatch', block, detail: 'it was paid before this scheduled period and cannot settle it' };
  }
  if (schedule.token.native) {
    const ok = tx.from.toLowerCase() === schedule.payer && tx.to?.toLowerCase() === schedule.payee && BigInt(tx.value) >= amountRaw;
    return ok ? { state: 'paid', block, detail: 'a native transfer of at least the amount from the payer to the payee', reference: tx.input === '0x' ? null : readReference(tx.input, { native: true }) } : { state: 'mismatch', block, detail: 'it succeeded but is not a transfer of the right amount from the payer to the payee' };
  }
  const log = receipt.logs.find((l) => l.address.toLowerCase() === schedule.token.address && l.topics[0] === TRANSFER_TOPIC && l.topics[1]?.toLowerCase() === topicAddr(schedule.payer) && l.topics[2]?.toLowerCase() === topicAddr(schedule.payee));
  if (!log) return { state: 'mismatch', block, detail: `it succeeded but it did not transfer ${schedule.token.symbol} from the payer to the payee` };
  const got = BigInt(log.data);
  if (got < amountRaw) return { state: 'partial', block, detail: `it transferred ${got} base units, less than the ${amountRaw} the schedule asks for`, amount: got };
  return { state: 'paid', block, detail: 'the token contract logged a Transfer from the payer to the payee for at least the amount', amount: got, reference };
}

// ---- the tick ---------------------------------------------------------------------------------------------------------------------------------

// One look at the schedule. Reads the chain, settles what can be settled, and prepares the next payment that is due and payable.
//   state:  what the previous tick returned (null the first time), `report`: { period, hash } the person reports after signing.
export async function tick({ chain, rpc = publicRpc, schedule: input, state: stateIn = null, report = null, block = null, now = null, prepare = true }) {
  const schedule = parseSchedule(input);
  const tr = tracer();
  const head = await blockNumber(chain);
  const at = block ?? head - 2;
  if (!Number.isInteger(at) || at < 1 || at > head - 2) throw new UserError(`block must be a whole number from 1 to ${head - 2}`);
  const header = await getBlock(chain, at, 'Block header: the chain’s own clock, which decides what is due');
  const clock = now ?? header.timestamp;
  if (!Number.isSafeInteger(clock) || clock < 0) throw new UserError('now must be a whole Unix timestamp');
  if (!schedule.token.native && schedule.token.decimals == null) {
    const reader = makeReader({ chain, rpc, tr, block: at });
    const rows = await reader.batch([{ id: 'decimals', target: schedule.token.address, data: SEL.decimals, label: 'decimals()' }, { id: 'symbol', target: schedule.token.address, data: selectorOf('symbol()'), label: 'symbol()' }], 'Read the custom token scale before interpreting the scheduled amount', at);
    const decimals = asUint(rows[0]);
    if (decimals == null || decimals > 255n) throw new UserError('the custom token must report valid decimals from 0 to 255');
    schedule.token.decimals = Number(decimals);
    schedule.token.symbol = asString(rows[1]) ?? '?';
  }
  const decimals = schedule.token.decimals ?? 18;
  const amountRaw = parseDecimal(schedule.amount, decimals, 'amount');
  let state = stateIn == null ? newState(schedule, { cursor: at }) : validateState(structuredClone(stateIn), schedule);
  if (state.cursor > at + 1) throw new UserError('the saved state is newer than the requested block; reset it before replaying an older block');
  const history = [...state.history];
  const log = (type, extra) => history.push({ at: iso(clock), block: at, type, ...extra });
  const periodsDue = [];
  for (let k = 0; k < (schedule.count ?? MAX_PERIODS); k++) {
    const due = dueTime(schedule, k);
    if (due > clock + 366 * DAY && k > 0) break;
    periodsDue.push({ k, due });
    if (periodsDue.filter((p) => p.due > clock).length >= 2) break; // the next one and one after it is as far as the table looks
  }
  tr.agent('schedule', `${schedule.frequency} ${schedule.amount} ${schedule.token.symbol} from ${short(schedule.payer)} to ${short(schedule.payee)}: ${periodsDue.filter((p) => p.due <= clock).length} period(s) due at block time ${iso(clock)}.`, { uses: [], output: { due: periodsDue.filter((p) => p.due <= clock).length } });

  // 1. report: the person says they signed and sent a transaction for a period
  const notices = [];
  if (report) {
    const k = Number(report.period);
    if (!periodsDue.some((p) => p.k === k)) throw new UserError(`period ${report.period} is not one of this schedule's periods`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(report.hash ?? '')) throw new UserError('the transaction hash must be 0x followed by 64 hex characters');
    const hash = report.hash.toLowerCase();
    const reusedBy = Object.entries(state.submissions).find(([, v]) => v.hash === hash) ?? Object.entries(state.paid).find(([, v]) => v.hash === hash);
    if (reusedBy) throw new UserError(`that transaction was already reported for period ${reusedBy[0]}: one transaction pays one period`);
    if (state.paid[k]) throw new UserError(`period ${k} is already paid; no new transaction can be reported for it`);
    if (state.submissions[k]) {
      const previous = await readReported({ rpc, chain, at, schedule, hash: state.submissions[k].hash, amountRaw, period: k });
      if (!['failed', 'mismatch', 'partial'].includes(previous.state)) throw new UserError(`period ${k} has an unresolved submitted transaction; check it before reporting another one`);
    }
    state.submissions[k] = { hash, reportedAt: iso(clock) };
    log('submitted', { period: k, hash });
    notices.push({ period: k, text: `Reported ${short(hash)} for period ${k}; the chain is read below.` });
  }

  // 2. what the chain says about every reported transaction
  const evidence = { ...state.paid }; // period -> { hash, block, how }: what was already proven on chain stays proven
  const failures = {}; // period -> reason
  const inFlight = {};
  for (const [kStr, sub] of Object.entries(state.submissions)) {
    const k = Number(kStr);
    if (evidence[k]) continue;
    const r = await readReported({ rpc, chain, at, schedule, hash: sub.hash, amountRaw, period: k });
    tr.agent('read-reported', `Period ${k}, ${short(sub.hash)}: ${r.state}. ${r.detail}.`, { uses: [], output: { state: r.state } });
    if (r.state === 'paid') evidence[k] = { hash: sub.hash, block: r.block, how: 'reported', reference: r.reference ?? null };
    else if (r.state === 'failed' || r.state === 'mismatch' || r.state === 'partial') failures[k] = { hash: sub.hash, reason: r.detail };
    else inFlight[k] = { hash: sub.hash, reason: r.detail };
  }

  // 3. the chain, for payments nobody reported: the transfers since the schedule was created (or since the last look)
  let scan = null;
  if (!schedule.token.native) {
    const from = state.cursor;
    const to = at;
    if (from <= to) {
      scan = await scanTransfers({ rpc, token: schedule.token, payer: schedule.payer, payee: schedule.payee, from, to });
      tr.agent('scan-transfers', `Scanned blocks ${scan.scannedFrom.toLocaleString('en-US')}–${scan.scannedTo.toLocaleString('en-US')} for ${schedule.token.symbol} transfers from the payer to the payee: ${scan.logs.length} found${scan.complete ? '' : ' (the scan is not finished: it continues at the next look)'}.`, { uses: [], output: { found: scan.logs.length } });
      const known = new Set([...Object.values(state.paid).map((v) => v.hash), ...Object.entries(state.submissions).filter(([k]) => !failures[k]).map(([, v]) => v.hash)]);
      for (const l of scan.logs.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)) {
        if (l.amount < amountRaw) { notices.push({ text: `A transfer of ${fmtUnits(l.amount, decimals, 6)} ${schedule.token.symbol} at block ${l.block.toLocaleString('en-US')} is below the scheduled amount and was not counted.` }); continue; }
        if (known.has(l.hash.toLowerCase())) continue;
        const ref = await referenceOfTx(rpc, l.hash);
        const m = ref?.match(/^rp:([a-z0-9-]+):(\d+)$/);
        if (ref && (!m || m[1] !== schedule.id)) { notices.push({ text: `A transfer (${short(l.hash)}) belongs to another payment reference and was not counted.` }); continue; }
        let k = null;
        if (m && m[1] === schedule.id) k = periodsDue.some((p) => p.k === Number(m[2])) ? Number(m[2]) : null;
        else {
          const when = (await getBlock(chain, l.block, 'Block header of a transfer found on chain')).timestamp;
          k = periodsDue.find((p) => p.due <= when + EARLY_SECONDS && !evidence[p.k] && !(state.submissions[p.k] && !failures[p.k]))?.k ?? null;
        }
        if (k == null || evidence[k]) { notices.push({ text: `A transfer at block ${l.block.toLocaleString('en-US')} matches no open period (an extra payment: ${short(l.hash)}).` }); continue; }
        evidence[k] = { hash: l.hash.toLowerCase(), block: l.block, how: 'found-on-chain', reference: ref };
        known.add(l.hash.toLowerCase());
        if (!state.submissions[k] || failures[k]) { log('paid', { period: k, hash: l.hash.toLowerCase(), how: 'found on chain: it was not reported' }); delete failures[k]; delete inFlight[k]; }
      }
      state.cursor = scan.scannedTo + 1;
    }
  }
  for (const k of Object.keys(evidence)) {
    if (!history.some((h) => h.type === 'paid' && h.period === Number(k))) log('paid', { period: Number(k), hash: evidence[k].hash, how: evidence[k].how === 'reported' ? 'confirmed on chain from the reported hash' : 'found on chain' });
    state.paid[k] = evidence[k];
    delete state.prepared[k];
  }
  for (const [k, f] of Object.entries(failures)) {
    if (!history.some((h) => h.type === 'failed' && h.period === Number(k) && h.hash === f.hash)) { log('failed', { period: Number(k), hash: f.hash, reason: f.reason }); state.attempts[k] = (state.attempts[k] ?? 0) + 1; delete state.prepared[k]; }
  }

  // 4. every period's status
  const periods = periodsDue.map(({ k, due }) => {
    const base = { period: k, due, dueIso: iso(due), reference: referenceOf(schedule, k) };
    if (evidence[k]) return { ...base, status: 'paid', evidence: evidence[k], explorer: explorerTx(evidence[k].hash) };
    if (inFlight[k]) return { ...base, status: 'submitted', submitted: inFlight[k], explorer: explorerTx(inFlight[k].hash) };
    if (due > clock) return { ...base, status: 'upcoming', inSeconds: due - clock };
    if (failures[k]) return { ...base, status: 'failed', failure: failures[k], attempts: state.attempts[k] ?? 1, explorer: explorerTx(failures[k].hash) };
    return { ...base, status: 'pending', overdueSeconds: clock - due };
  });
  const next = periods.find((p) => p.status === 'upcoming') ?? null;

  // 5. prepare the oldest payment that is due and open, unless one is already prepared or the payer cannot pay it
  let action = null;
  const open = periods.find((p) => p.status === 'pending' || (p.status === 'failed' && (p.attempts ?? 1) < MAX_ATTEMPTS));
  const stuck = periods.filter((p) => p.status === 'failed' && (p.attempts ?? 1) >= MAX_ATTEMPTS);
  for (const p of stuck) notices.push({ period: p.period, text: `Period ${p.period} failed ${p.attempts} times: I stopped preparing it. Look at ${short(p.failure.hash)} and fix the cause.` });
  if (open && prepare && scan && !scan.complete) {
    action = { period: open.period, kind: 'blocked-history-incomplete', reason: 'The payment history scan is incomplete. Run again to finish the scan before preparing another payment.' };
  } else if (open && prepare) {
    const k = open.period;
    const kept = state.prepared[k];
    const result = await assessTransfer({ chain, rpc, from: schedule.payer, to: schedule.payee, token: schedule.token.native ? TOKENS[0] : { ...schedule.token }, amountRaw, reference: schedule.token.native ? null : referenceOf(schedule, k), block: at, tr });
    const blocked = result.checks.find((c) => !c.ok && c.level === 'fail');
    if (!result.ok) {
      const why = blocked?.detail ?? 'a check failed';
      const insufficient = blocked?.id === 'balance';
      action = { period: k, kind: insufficient ? 'blocked-insufficient-balance' : 'blocked', reason: why, checks: result.checks };
      if (!history.some((h) => h.type === 'blocked' && h.period === k && h.reason === why)) log('blocked', { period: k, reason: why });
    } else {
      const same = kept && kept.data === result.transaction.data && kept.to === result.transaction.to;
      const transaction = same && kept.transaction ? kept.transaction : result.transaction;
      action = { period: k, kind: same ? 'already-prepared' : 'prepared', transaction, summary: summaryLines({ from: schedule.payer, to: schedule.payee, result, reference: schedule.token.native ? null : referenceOf(schedule, k) }), checks: result.checks, reference: referenceOf(schedule, k), retry: open.status === 'failed' ? `attempt ${(open.attempts ?? 1) + 1} of ${MAX_ATTEMPTS}` : null };
      if (!same) { state.prepared[k] = { data: result.transaction.data, to: result.transaction.to, transaction: result.transaction, preparedAt: iso(clock), block: at }; log('prepared', { period: k, reference: referenceOf(schedule, k), ...(open.status === 'failed' && { retry: true }) }); }
      else notices.push({ period: k, text: `Period ${k} already has a prepared transaction: here it is again, unchanged. Sign it once.` });
    }
    tr.agent('prepare', action.kind === 'prepared' || action.kind === 'already-prepared' ? `Period ${k}: ${action.kind === 'prepared' ? 'prepared' : 'already prepared'} (${referenceOf(schedule, k)}).` : `Period ${k}: not prepared: ${action.reason}`, { uses: [], output: { kind: action.kind } });
  }
  state.history = history.slice(-MAX_HISTORY);
  state.submissions = Object.fromEntries(Object.entries(state.submissions).filter(([, v]) => v));

  const steps = tr.steps.sort((a, b) => a.n - b.n);
  const counts = { paid: periods.filter((p) => p.status === 'paid').length, pending: periods.filter((p) => p.status === 'pending').length, submitted: periods.filter((p) => p.status === 'submitted').length, failed: periods.filter((p) => p.status === 'failed').length, upcoming: periods.filter((p) => p.status === 'upcoming').length };
  return jsonSafe({
    block: { number: at, head, timestamp: header.timestamp, iso: iso(header.timestamp) }, clock: iso(clock), schedule, counts, periods, next: next && { period: next.period, due: next.due, dueIso: next.dueIso, inSeconds: next.inSeconds, text: `${schedule.amount} ${schedule.token.symbol} on ${next.dueIso}` },
    action, notices, history: state.history, scan: scan && { from: scan.scannedFrom, to: scan.scannedTo, complete: scan.complete, found: scan.logs.length }, state, steps,
    chainCalls: steps.filter((s) => s.actor === 'chain-mcp').length, rpcCalls: steps.filter((s) => s.actor === 'public-rpc').length,
  });
}

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
