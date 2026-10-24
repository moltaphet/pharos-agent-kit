// Task: Natural-Language Payment Agent. The API around lib/payments.js: a sentence in; questions, a refusal, or a summary and an UNSIGNED transaction out.
// Also serves the examples, the recorded demo (real requests on Pharos mainnet pinned to a block), the fork run that signs the output with a throwaway key, and a REPLAY.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preparePayment, TOKENS } from '../payments.js';
import { isAddress } from '../abi.js';
import { UserError } from '../snapshot.js';

const AGENT = fileURLToPath(new URL('../../agents/natural-language-payment-agent/', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../reports/', import.meta.url));
export const readExamples = async () => JSON.parse(await readFile(AGENT + 'examples/requests.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(REPORTS + 'payments-demo.json', 'utf8'));
export const readFork = async () => JSON.parse(await readFile(REPORTS + 'payments-fork-run.json', 'utf8'));

// The request's own fields, kept small and plain: what a replay has to reproduce.
export const fingerprint = (r) => ({
  status: r.status,
  understood: r.understood,
  questions: (r.questions ?? []).map((q) => q.field),
  checks: (r.checks ?? []).map((c) => [c.id, c.ok]),
  transaction: r.transaction ? { to: r.transaction.to, data: r.transaction.data, value: r.transaction.value, chainId: r.transaction.chainId } : null,
});
export function compareReplay(recorded, replayed) {
  const a = fingerprint(recorded);
  const b = fingerprint(replayed);
  const rows = Object.keys(a).map((k) => ({ what: k, same: JSON.stringify(a[k]) === JSON.stringify(b[k]), recorded: a[k], replayed: b[k] }));
  return { sameBlock: (recorded.block?.number ?? null) === (replayed.block?.number ?? null), compared: rows.length, identical: rows.filter((r) => r.same).length, differing: rows.filter((r) => !r.same), note: 'The sentence, the checks and the transaction are worked out again at the recorded block. The network fee follows the live gas price, so it can differ and is not compared.' };
}

const parseJson = (v, what) => {
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v;
  try { const o = JSON.parse(v); if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('not an object'); return o; } catch { throw new UserError(`${what} must be a JSON object`); }
};
const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return { requests: await readExamples(), tokens: TOKENS.map((t) => ({ symbol: t.symbol, address: t.address ?? null, native: Boolean(t.native), decimals: t.decimals })) };
  if (q.recorded) return { demo: await readDemo(), fork: await readFork() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.payments.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.payments.map((c) => c.id).join(', ')}`);
    const replayed = await preparePayment({ chain, ...(rpc && { rpc }), text: rec.text, from: rec.from ?? null, answers: rec.answers ?? {}, contacts: rec.contacts ?? {}, block: rec.block });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const src = { ...q, ...(body ?? {}) };
  if (!src.text) throw new UserError('write what to pay, e.g. text=send 100 USDC to 0x… (and from=0x… for the wallet that pays)');
  if (src.from && !isAddress(src.from)) throw new UserError('from must be a 0x address (the wallet that pays)');
  return { payment: await preparePayment({ chain, ...(rpc && { rpc }), text: String(src.text), from: src.from || null, answers: parseJson(src.answers, 'answers'), contacts: parseJson(src.contacts, 'contacts'), block: toBlock(src.block) }) };
}
