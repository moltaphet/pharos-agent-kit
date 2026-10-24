#!/usr/bin/env node
// Task: Recurring Payment Agent.
// Looks at a weekly or monthly payment schedule on Pharos mainnet: what is paid (on chain), what is due, what is next, and the unsigned transaction for the payment to make now.
// State lives in a JSON file, so every run continues where the last stopped. Nothing is signed or sent.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { McpClient, PHAROS_CHAIN_MCP } from '../../lib/mcp.js';
import { tick } from '../../lib/recurring.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-recurring --state state.json (--schedule schedule.json | --payer 0x… --payee 0x… --token USDC --amount 25 --frequency weekly --start 2026-11-01) [options]

  pharos-recurring --state rent.json --payer 0x8ecd… --payee 0xAb58… --token USDC --amount 25 --frequency weekly --start 2026-10-05T09:00
  pharos-recurring --state rent.json --schedule rent.json.schedule --report 0 0x<hash of the transaction you signed for period 0>

Options:
  --state <file>      where the state is kept (created on the first run)
  --schedule <file>   a JSON file with the schedule (otherwise use the flags below)
  --payer --payee --token --amount --frequency (weekly|monthly) --start (UTC date or date-time) --count --id --label
  --report <period> <hash>   tell it you signed and sent the payment for a period
  --block <n>         look at this block (default: two behind the latest)
  --json              print the full result as JSON
  -h, --help          show this help

Exit codes: 0 nothing to pay now · 10 a payment is ready to sign · 11 a payment is due but cannot be made (see why) · 1 error`;

const { values, positionals } = parseCli({ usage, options: { state: { type: 'string' }, schedule: { type: 'string' }, payer: { type: 'string' }, payee: { type: 'string' }, token: { type: 'string' }, amount: { type: 'string' }, frequency: { type: 'string' }, start: { type: 'string' }, count: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' }, report: { type: 'string' }, block: { type: 'string' }, json: { type: 'boolean' } } });
if (!values.state) fail('--state <file> is required', usage);
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const schedule = values.schedule ? JSON.parse(await readFile(values.schedule, 'utf8')) : Object.fromEntries(['payer', 'payee', 'token', 'amount', 'frequency', 'start', 'count', 'id', 'label'].filter((k) => values[k] != null).map((k) => [k, values[k]]));
  const saved = existsSync(values.state) ? JSON.parse(await readFile(values.state, 'utf8')) : null;
  const report = values.report != null ? { period: values.report, hash: positionals[0] } : null;
  const r = await tick({ chain, schedule, state: saved?.state ?? null, report, block: values.block ? Number(values.block) : null });
  await mkdir(dirname(values.state), { recursive: true });
  await writeFile(`${values.state}.tmp`, JSON.stringify({ schedule: r.schedule, state: r.state }, null, 2) + '\n');
  await rename(`${values.state}.tmp`, values.state);
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`\n${r.schedule.frequency} ${r.schedule.amount} ${r.schedule.token.symbol}  ${r.schedule.payer.slice(0, 8)}… → ${r.schedule.payee.slice(0, 8)}…   at block ${r.block.number.toLocaleString('en-US')} · ${r.clock}`);
    for (const p of r.periods) console.log(`  period ${String(p.period).padStart(2)}  ${p.dueIso}  ${p.status.toUpperCase().padEnd(9)} ${p.evidence ? `tx ${p.evidence.hash.slice(0, 12)}… (${p.evidence.how})` : p.failure ? `${p.failure.reason}` : p.submitted ? `tx ${p.submitted.hash.slice(0, 12)}…: ${p.submitted.reason}` : ''}`);
    console.log(`\n  ${r.counts.paid} paid · ${r.counts.pending} pending · ${r.counts.submitted} submitted · ${r.counts.failed} failed · next: ${r.next ? r.next.text : 'none'}`);
    for (const n of r.notices) console.log(`  note: ${n.text}`);
    if (r.action?.transaction) console.log(`\n  PREPARE period ${r.action.period} (${r.action.kind}${r.action.retry ? ', ' + r.action.retry : ''}); sign it once, then report it with --report ${r.action.period} <hash>\n${r.action.summary.map((l) => `    ${l}`).join('\n')}\n    to ${r.action.transaction.to}\n    data ${r.action.transaction.data}`);
    else if (r.action) console.log(`\n  NOT PREPARED for period ${r.action.period}: ${r.action.reason}`);
    console.log(`\n  history (${r.history.length}): ${r.history.slice(-4).map((h) => `${h.type}${h.period != null ? ' #' + h.period : ''}`).join(', ') || 'none yet'}`);
  }
  process.exitCode = r.action?.transaction ? 10 : r.action ? 11 : 0;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
