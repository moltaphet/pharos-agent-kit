// Audit log for the Policy Gatekeeper: an append-only, hash-chained record of every decision.
//
// Each entry carries the hash of the entry before it, so editing, deleting, reordering or
// inserting any past entry breaks every hash after it and verifyLog() says exactly where.
// (A chain proves the log was not altered; it cannot prove the *last* entries were not cut
// off, so verifyLog() also returns the head hash: store or publish it to pin the length.)
//
// guardedExecute() is the only path from a request to an executor. It writes the decision
// BEFORE anything runs (write-ahead), never calls the executor on a deny, and fails closed:
// if the decision cannot be recorded, nothing is executed.

import { createHash } from 'node:crypto';
import { appendFile, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluate } from './policy.js';
import { UserError } from './snapshot.js';

export const GENESIS = '0'.repeat(64);

// Stable JSON: keys sorted at every level, so the same entry always hashes the same.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const entryHash = (e) => createHash('sha256').update(canonical({ seq: e.seq, kind: e.kind, prev: e.prev, body: e.body })).digest('hex');

export function makeEntry(prevEntry, kind, body) {
  // Hash the exact JSON representation that will be persisted (Date, undefined array
  // entries and toJSON must not change the content after the hash was computed).
  const storedBody = JSON.parse(JSON.stringify(body));
  const e = { seq: prevEntry ? prevEntry.seq + 1 : 0, kind, prev: prevEntry ? prevEntry.hash : GENESIS, body: storedBody };
  e.hash = entryHash(e);
  return e;
}

// Walk the whole log and report every way it fails to be a valid chain.
export function verifyLog(entries) {
  const problems = [];
  let prev = null;
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e) || !e.body || typeof e.body !== 'object' || typeof e.kind !== 'string') {
      problems.push({ seq: i, problem: `entry ${i} is not a valid audit entry` });
      prev = null;
      return;
    }
    if (e.seq !== i) problems.push({ seq: i, problem: `entry ${i} has seq ${e.seq} (missing, duplicated or reordered)` });
    const expectPrev = prev ? prev.hash : GENESIS;
    if (e.prev !== expectPrev) problems.push({ seq: i, problem: `entry ${i} does not follow the entry before it (prev hash differs)` });
    if (entryHash(e) !== e.hash) problems.push({ seq: i, problem: `entry ${i} was changed after it was written (its hash does not match its content)` });
    if (e.kind === 'execution') {
      const d = entries.find((x) => x?.kind === 'decision' && x.seq === e.body.decisionSeq);
      if (!d || d.seq >= e.seq) problems.push({ seq: i, problem: `execution ${i} points at decision ${e.body.decisionSeq}, which does not come before it` });
      else if (d.body?.decision === 'deny' && e.body.status === 'executed') problems.push({ seq: i, problem: `execution ${i} shows a DENIED request (decision ${d.seq}) as executed` });
    }
    prev = e;
  });
  return { ok: problems.length === 0, count: entries.length, head: prev ? prev.hash : GENESIS, problems };
}

// What the spend-limit rules need: the earlier decisions, with their time and spend.
export const historyOf = (entries) => entries.filter((e) => e.kind === 'decision').map((e) => ({ decision: e.body.decision, atSec: e.body.atSec, spend: e.body.spend }));

export class MemoryLog {
  constructor(entries = []) { this.entries = structuredClone(entries); }
  async all() { return structuredClone(this.entries); }
  async append(kind, body) {
    const e = makeEntry(this.entries[this.entries.length - 1] ?? null, kind, body);
    this.entries.push(e);
    return structuredClone(e);
  }
}

// Serialise read/evaluate/reserve, rather than just append: the decision is the spend reservation.
const decisionQueues = new WeakMap();
function serialDecision(log, run) {
  const next = (decisionQueues.get(log) ?? Promise.resolve()).then(run);
  decisionQueues.set(log, next.catch(() => {}));
  return next;
}

// One JSON object per line. The exclusive lock covers readers, writers and the entire
// decision reservation, including independent instances/processes using the same path.
// An abandoned lock fails closed; never guess that another writer has stopped spending.
export class FileLog {
  constructor(path) { this.path = resolve(path); }
  async locked(run) {
    const lockPath = this.path + '.lock';
    const until = Date.now() + 5000;
    let lock;
    for (;;) {
      try { lock = await open(lockPath, 'wx'); break; }
      catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (Date.now() >= until) throw new UserError('audit log is locked by another writer; nothing was executed');
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    try { return await run(); }
    finally { await lock.close(); await unlink(lockPath); }
  }
  async readEntries() {
    let text = '';
    try { text = await readFile(this.path, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return text.split('\n').filter(Boolean).map((l, i) => {
      try { return JSON.parse(l); } catch { throw new UserError(`audit log line ${i + 1} is not valid JSON`); }
    });
  }
  all() { return this.locked(() => this.readEntries()); }
  async appendEntry(kind, body) {
    const entries = await this.readEntries();
    const e = makeEntry(entries[entries.length - 1] ?? null, kind, body);
    await appendFile(this.path, JSON.stringify(e) + '\n');
    return e;
  }
  append(kind, body) {
    const snapshot = JSON.parse(JSON.stringify(body));
    return this.locked(() => this.appendEntry(kind, snapshot));
  }
  reserve(policy, request, nowSec) {
    return this.locked(async () => {
      const decision = decisionFor(await this.readEntries(), policy, request, nowSec);
      const dEntry = await this.appendEntry('decision', decision);
      return { decision, dEntry };
    });
  }
}

function decisionFor(entries, policy, request, nowSec) {
  const chain = verifyLog(entries);
  if (!chain.ok) throw new UserError(`the audit log is not intact, so nothing is decided or executed: ${chain.problems[0].problem}`);
  return evaluate(policy, request, { nowSec, history: historyOf(entries) });
}

// Decide, record, and only then (if allowed) execute. `execute(request, decision)` returns
// anything JSON-able, e.g. { txHash }.
export async function guardedExecute({ policy, log, request, nowSec, execute }) {
  // Clone before yielding: the request executed must be the exact one evaluated.
  request = structuredClone(request);
  const { decision, dEntry } = log instanceof FileLog
    ? await log.reserve(policy, request, nowSec)
    : await serialDecision(log, async () => {
      const decision = decisionFor(await log.all(), policy, request, nowSec);
      const dEntry = await log.append('decision', decision);
      return { decision, dEntry };
    }); // write-ahead: if this throws, nothing runs

  if (decision.decision !== 'allow') {
    const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'not-executed', note: `denied by ${decision.rule.id}; the executor was not called` });
    return { decision, executed: false, decisionEntry: dEntry, executionEntry: x };
  }
  let result;
  try {
    result = await execute(request, decision);
  } catch (err) {
    const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'failed', error: String(err?.message ?? err).slice(0, 300) });
    return { decision, executed: false, error: err, decisionEntry: dEntry, executionEntry: x };
  }
  // A failure recording the outcome cannot undo the execution. Surface it to the
  // caller; never write a contradictory 'failed' record that could invite a retry.
  const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'executed', result });
  return { decision, executed: true, result, decisionEntry: dEntry, executionEntry: x };
}
