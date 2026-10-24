// Task: Recurring Payment Agent. The API around lib/recurring.js: look at a weekly or monthly schedule on Pharos mainnet, settle what the chain shows, prepare the next payment that is
// due. State is never kept on the server: the caller passes it in and gets the new one back (the CLI keeps it in a file, the page in the browser), so nothing can be lost or paid twice
// because a server restarted. Also serves the examples, the recorded demo (pinned), the fork run (the whole lifecycle on a real EVM) and a REPLAY.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tick } from '../recurring.js';
import { UserError } from '../snapshot.js';

const AGENT = fileURLToPath(new URL('../../agents/recurring-payment-agent/', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../reports/', import.meta.url));
export const readExamples = async () => JSON.parse(await readFile(AGENT + 'examples/schedules.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(REPORTS + 'recurring-demo.json', 'utf8'));
export const readFork = async () => JSON.parse(await readFile(REPORTS + 'recurring-fork-run.json', 'utf8'));

export function compareReplay(recorded, replayed) {
  const pick = (r) => ({ clock: r.clock, statuses: r.periods.map((p) => `${p.period}:${p.status}`), action: r.action ? { period: r.action.period, kind: r.action.kind, data: r.action.transaction?.data ?? null } : null, next: r.next?.dueIso ?? null });
  const a = pick(recorded);
  const b = pick(replayed);
  const rows = Object.keys(a).map((k) => ({ what: k, same: JSON.stringify(a[k]) === JSON.stringify(b[k]), recorded: a[k], replayed: b[k] }));
  return { sameBlock: recorded.block.number === replayed.block.number, compared: rows.length, identical: rows.filter((r) => r.same).length, differing: rows.filter((r) => !r.same), note: 'The chain’s clock is the block’s time, so what is due, what is paid and what is prepared are worked out again at the recorded block.' };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return { schedules: await readExamples() };
  if (q.recorded) return { demo: await readDemo(), fork: await readFork() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await tick({ chain, ...(rpc && { rpc }), schedule: rec.schedule, block: rec.block });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const src = { ...q, ...(body ?? {}) };
  const schedule = src.schedule ?? Object.fromEntries(['id', 'label', 'payer', 'payee', 'token', 'amount', 'frequency', 'start', 'count'].filter((k) => src[k] != null && src[k] !== '').map((k) => [k, src[k]]));
  if (!schedule.payer) throw new UserError('give a schedule: payer, payee, token, amount, frequency (weekly or monthly) and start');
  const report = src.report ?? (src.period != null && src.period !== '' ? { period: src.period, hash: src.hash } : null);
  return { agent: await tick({ chain, ...(rpc && { rpc }), schedule, state: src.state ?? null, report, block: toBlock(src.block) }) };
}
