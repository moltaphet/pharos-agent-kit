#!/usr/bin/env node
// Task 25: check a wallet or contract on Pharos before you interact with it. Prints the level (low / medium / high), every signal read, and each flag in plain language.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { CHAINS, checkAddress } from '../../lib/risk.js';

const usage = 'Usage: pharos-risk <address> [--chain mainnet|atlantic] [--flagged <file with one address per line>] [--window <blocks, default 20000>] [--json]';
const { values, positionals } = parseCli({ usage, options: { chain: { type: 'string' }, flagged: { type: 'string' }, window: { type: 'string' }, json: { type: 'boolean' } } });
const [address] = positionals;
if (!address) fail('give the address to check', usage);
const chain = CHAINS[values.chain ?? 'mainnet'];
if (!chain) fail('--chain must be mainnet or atlantic', usage);
try {
  const flagged = values.flagged ? readFileSync(resolve(values.flagged), 'utf8').split(/\s+/).filter(Boolean) : [];
  const r = await checkAddress({ chain, address, flagged, window: values.window ? Number(values.window) : 20_000 });
  if (values.json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`${r.label ?? r.address} · ${r.kind} on ${r.chainName}\nRISK: ${r.level.toUpperCase()}\n`);
  console.log('Signals checked');
  for (const s of r.signals) console.log(`  [${s.status.toUpperCase().padEnd(4)}] ${s.title}: ${s.detail}`);
  if (r.flags.length) { console.log('\nRed flags'); for (const f of r.flags) console.log(`  ${f.severity.toUpperCase()}: ${f.title}\n    ${f.plain}`); }
  else console.log('\nNo red flags.');
  console.log(`\n${r.explorer}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
