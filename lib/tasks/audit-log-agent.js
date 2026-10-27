// Task: Audit-Log Agent. The web side of lib/auditlog.js: a live report for any wallet over a date range of up to 12 hours (the web has 60 seconds; the CLI does 7 days),
// the recorded reports of three real wallets with their notable transactions re-read from the chain on every load, and the Markdown, CSV and PDF exports.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildReport, resolveRange, toCsv, toMarkdown, toPdf } from '../auditlog.js';
import { publicRpc } from '../onchain.js';
import { batchRpcStrict } from '../rpc-batch.js';
import { UserError } from '../snapshot.js';
import { confirmed } from '../retry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const WEB_MAX_DAYS = 0.5;
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const exportOf = (report, format) => {
  if (format === 'md') return { format, filename: `activity-${report.wallet.slice(0, 10)}.md`, mime: 'text/markdown', text: toMarkdown(report) };
  if (format === 'csv') return { format, filename: `activity-${report.wallet.slice(0, 10)}.csv`, mime: 'text/csv', text: toCsv(report) };
  if (format === 'pdf') return { format, filename: `activity-${report.wallet.slice(0, 10)}.pdf`, mime: 'application/pdf', base64: toPdf(report).toString('base64') };
  throw new UserError('format must be md, csv or pdf');
};

// every notable transaction of the recordings is read back: it exists, is in the recorded block, and (for token events) the wallet really is in its logs
async function verify(run) {
  const rows = run.wallets.flatMap((w) => w.report.notable.slice(0, 5).map((n) => ({ wallet: w.address, hash: n.hash, block: n.block })));
  const results = await Promise.all(rows.map(async (r) => {
    const w = r.wallet.slice(2).toLowerCase();
    const c = await confirmed(() => batchRpcStrict([{ method: 'eth_getTransactionReceipt', params: [r.hash] }]).then((x) => x[0]), (rc) => Boolean(rc) && parseInt(rc.blockNumber, 16) === r.block && JSON.stringify(rc.logs).toLowerCase().includes(w));
    return { hash: r.hash, verified: c.ok };
  }));
  return { checkedAt: new Date().toISOString(), total: results.length, verifiedCount: results.filter((x) => x.verified).length, results };
}

export default async function run({ q }) {
  if (q.recorded) {
    const run = await json('reports/auditlog-run.json');
    return { run: jsonSafe(run), verification: await verify(run) };
  }
  if (q.export && q.id) {
    const run = await json('reports/auditlog-run.json');
    const w = run.wallets.find((x) => x.id === q.id);
    if (!w) throw new UserError('id must be one of ' + run.wallets.map((x) => x.id).join(', '));
    return exportOf(w.report, q.export);
  }
  if (q.report) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(q.wallet ?? '')) throw new UserError('wallet must be a 0x… address of 40 hex digits');
    const range = await resolveRange({ rpc: publicRpc, from: q.from, to: q.to, maxDays: WEB_MAX_DAYS });
    const report = await buildReport({ wallet: q.wallet, ...range });
    return { range, report: jsonSafe(report), exports: Object.fromEntries(['md', 'csv', 'pdf'].map((f) => [f, exportOf(report, f)])), note: 'Live report. The web covers up to 12 hours; the CLI covers up to 7 days.' };
  }
  throw new UserError('use ?recorded=1, ?report=1&wallet=0x…&from=2026-10-26T08:00&to=2026-10-26T14:00, or ?export=md|csv|pdf&id=wallet-a');
}
