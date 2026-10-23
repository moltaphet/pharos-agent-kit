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
import { appendFile, readFile } from 'node:fs/promises';
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
  const e = { seq: prevEntry ? prevEntry.seq + 1 : 0, kind, prev: prevEntry ? prevEntry.hash : GENESIS, body };
  e.hash = entryHash(e);
  return e;
}

// Walk the whole log and report every way it fails to be a valid chain.
export function verifyLog(entries) {
  const problems = [];
  let prev = null;
  entries.forEach((e, i) => {
    if (e.seq !== i) problems.push({ seq: i, problem: `entry ${i} has seq ${e.seq} (missing, duplicated or reordered)` });
    const expectPrev = prev ? prev.hash : GENESIS;
    if (e.prev !== expectPrev) problems.push({ seq: i, problem: `entry ${i} does not follow the entry before it (prev hash differs)` });
    if (entryHash(e) !== e.hash) problems.push({ seq: i, problem: `entry ${i} was changed after it was written (its hash does not match its content)` });
    if (e.kind === 'execution') {
      const d = entries.find((x) => x.kind === 'decision' && x.seq === e.body.decisionSeq);
      if (!d || d.seq >= e.seq) problems.push({ seq: i, problem: `execution ${i} points at decision ${e.body.decisionSeq}, which does not come before it` });
      else if (d.body.decision === 'deny' && e.body.status === 'executed') problems.push({ seq: i, problem: `execution ${i} shows a DENIED request (decision ${d.seq}) as executed` });
    }
    prev = e;
  });
  return { ok: problems.length === 0, count: entries.length, head: prev ? prev.hash : GENESIS, problems };
}

// What the spend-limit rules need: the earlier decisions, with their time and spend.
export const historyOf = (entries) => entries.filter((e) => e.kind === 'decision').map((e) => ({ decision: e.body.decision, atSec: e.body.atSec, spend: e.body.spend }));

export class MemoryLog {
  constructor(entries = []) { this.entries = entries; }
  async all() { return this.entries.slice(); }
  async append(kind, body) {
    const e = makeEntry(this.entries[this.entries.length - 1] ?? null, kind, body);
    this.entries.push(e);
    return e;
  }
}

// One JSON object per line, appended (never rewritten). Reads re-check nothing: call verifyLog on the result.
export class FileLog {
  constructor(path) { this.path = path; this.queue = Promise.resolve(); }
  async all() {
    let text = '';
    try { text = await readFile(this.path, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return text.split('\n').filter(Boolean).map((l, i) => {
      try { return JSON.parse(l); } catch { throw new UserError(`audit log line ${i + 1} is not valid JSON`); }
    });
  }
  append(kind, body) {
    // Serialised so two concurrent requests cannot both chain from the same predecessor.
    const run = this.queue.then(async () => {
      const entries = await this.all();
      const e = makeEntry(entries[entries.length - 1] ?? null, kind, body);
      await appendFile(this.path, JSON.stringify(e) + '\n');
      return e;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

// Decide, record, and only then (if allowed) execute. `execute(request, decision)` returns
// anything JSON-able, e.g. { txHash }.
export async function guardedExecute({ policy, log, request, nowSec, execute }) {
  const entries = await log.all();
  const chain = verifyLog(entries);
  if (!chain.ok) throw new UserError(`the audit log is not intact, so nothing is decided or executed: ${chain.problems[0].problem}`);

  const decision = evaluate(policy, request, { nowSec, history: historyOf(entries) });
  const dEntry = await log.append('decision', decision); // write-ahead: if this throws, nothing runs

  if (decision.decision !== 'allow') {
    const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'not-executed', note: `denied by ${decision.rule.id}; the executor was not called` });
    return { decision, executed: false, decisionEntry: dEntry, executionEntry: x };
  }
  try {
    const result = await execute(request, decision);
    const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'executed', result });
    return { decision, executed: true, result, decisionEntry: dEntry, executionEntry: x };
  } catch (err) {
    const x = await log.append('execution', { decisionSeq: dEntry.seq, status: 'failed', error: String(err?.message ?? err).slice(0, 300) });
    return { decision, executed: false, error: err, decisionEntry: dEntry, executionEntry: x };
  }
}
