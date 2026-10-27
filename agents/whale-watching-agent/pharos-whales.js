#!/usr/bin/env node
// Task 23: scan Pharos mainnet for significant moves of a watchlist and print an explained report plus a summary across all addresses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { formatUnits } from '../../lib/abi.js';
import { rpcCall } from '../../lib/rpc.js';
import { scanWhales, validateConfig } from '../../lib/whales.js';

const usage = 'Usage: pharos-whales --config <watchlist.json> [--blocks <n, default 1000, max 2000>] [--json]';
const { values } = parseCli({ usage, allowPositionals: false, options: { config: { type: 'string' }, blocks: { type: 'string' }, json: { type: 'boolean' } } });
if (!values.config) fail('provide --config', usage);
try {
  const text = readFileSync(resolve(values.config), 'utf8');
  if (text.length > 64 * 1024) throw new Error('config is larger than 64 KiB');
  const config = validateConfig(JSON.parse(text));
  const blocks = values.blocks ? Number(values.blocks) : 1000;
  if (!Number.isInteger(blocks) || blocks < 1) throw new Error('--blocks must be a whole number');
  const tip = Number(BigInt(await rpcCall('eth_blockNumber', []))) - 3; // three blocks of margin: the public RPC's nodes are not always at the same height
  const r = await scanWhales({ config, from: tip - blocks + 1, to: tip, head: tip });
  if (values.json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`Blocks ${r.window[0].toLocaleString('en-US')}–${r.window[1].toLocaleString('en-US')} · ${r.summary.watched} watched · ${r.summary.significantMoves} significant move(s) · ${r.summary.positionChanges} position change(s)\n`);
  for (const m of r.moves) console.log(`• ${m.what}\n  block ${m.block.toLocaleString('en-US')} · ${m.link}\n${m.why.map((w) => `  – ${w}`).join('\n')}`);
  console.log('\nPosition changes');
  for (const p of r.positions.filter((x) => x.significant)) console.log(`• ${p.what}${p.pct != null ? ` (${p.pct > 0 ? '+' : ''}${p.pct}%)` : ''}`);
  console.log('\nSummary by wallet');
  for (const w of r.summary.perWallet) console.log(`• ${w.label}: ${w.significantMoves} move(s), in $${formatUnits(BigInt(w.inUsd), 6, 2)}, out $${formatUnits(BigInt(w.outUsd), 6, 2)}${w.positionChanges.length ? `, ${w.positionChanges.join(', ')}` : ''}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
