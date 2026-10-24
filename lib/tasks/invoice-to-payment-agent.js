// Task: Invoice-to-Payment Agent. The API around lib/invoice.js: an invoice in (text, JSON or a payment link); flags, or a payment summary and an UNSIGNED transaction carrying the
// invoice's reference. Also serves the sample invoices, the recorded demo (pinned to a block), the fork run and a REPLAY.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareInvoicePayment } from '../invoice.js';
import { compareReplay as compareBase } from './natural-language-payment-agent.js';
import { isAddress } from '../abi.js';
import { UserError } from '../snapshot.js';

const AGENT = fileURLToPath(new URL('../../agents/invoice-to-payment-agent/', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../reports/', import.meta.url));
export const readExamples = async () => JSON.parse(await readFile(AGENT + 'examples/invoices.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(REPORTS + 'payments-demo.json', 'utf8'));
export const readFork = async () => JSON.parse(await readFile(REPORTS + 'payments-fork-run.json', 'utf8'));

// What a replay must reproduce: the verdict, every flag, the reference and the transaction.
export function compareReplay(recorded, replayed) {
  const pick = (r) => ({ status: r.status, reference: r.invoice?.reference ?? null, flags: (r.flags ?? []).map((f) => `${f.severity}:${f.code}`), checks: (r.checks ?? []).map((c) => [c.id, c.ok]), transaction: r.transaction ? { to: r.transaction.to, data: r.transaction.data, value: r.transaction.value } : null });
  const a = pick(recorded);
  const b = pick(replayed);
  const rows = Object.keys(a).map((k) => ({ what: k, same: JSON.stringify(a[k]) === JSON.stringify(b[k]), recorded: a[k], replayed: b[k] }));
  return { sameBlock: (recorded.block?.number ?? null) === (replayed.block?.number ?? null), compared: rows.length, identical: rows.filter((r) => r.same).length, differing: rows.filter((r) => !r.same), note: compareBase({ block: {} }, { block: {} }).note };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return { invoices: await readExamples() };
  if (q.recorded) return { demo: await readDemo(), fork: await readFork() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.invoices.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.invoices.map((c) => c.id).join(', ')}`);
    const replayed = await prepareInvoicePayment({ chain, ...(rpc && { rpc }), invoice: rec.text, from: rec.from ?? null, payIn: rec.payIn ?? null, block: rec.block, now: rec.now });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const src = { ...q, ...(body ?? {}) };
  if (!src.invoice) throw new UserError('paste an invoice (plain text, JSON or an ethereum: payment link) as the invoice field');
  if (src.from && !isAddress(src.from)) throw new UserError('from must be a 0x address (the wallet that pays)');
  return { payment: await prepareInvoicePayment({ chain, ...(rpc && { rpc }), invoice: String(src.invoice), from: src.from || null, payIn: src.payIn || null, block: toBlock(src.block) }) };
}
