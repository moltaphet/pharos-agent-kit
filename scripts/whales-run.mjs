#!/usr/bin/env node
// The Whale-Watching Agent, run on Pharos MAINNET (chain 1672, read-only). The watchlist is the busiest addresses (by number of USDC + WPROS transfers) of the 5,000 blocks BEFORE the scan window, so the list is not
// picked with hindsight; the scan covers 2,000 blocks of real activity at a pinned height. The same window is scanned twice with different thresholds, to show that "significant" is a setting.
//
//   node scripts/whales-run.mjs        writes reports/whales-run.json

import { readFileSync, writeFileSync } from 'node:fs';
import { rpcCall } from '../lib/rpc.js';
import { scanWhales, validateConfig } from '../lib/whales.js';

const say = (s) => process.stderr.write(s + '\n');
const rpc = (m, p) => rpcCall(m, p, { why: `whale watching run: ${m}` });
const raw = JSON.parse(readFileSync(new URL('../agents/whale-watching-agent/watchlist.example.json', import.meta.url), 'utf8'));
const tip = Number(BigInt(await rpc('eth_blockNumber', [])));
const to = tip - 3000; // pinned, old enough for every node to have it
const from = to - 1999;
say(`window ${from}–${to} (pinned; chain head was ${tip})`);

const runs = [];
for (const [id, title, edit] of [
  ['default', 'Default thresholds: 100 USDC / 100 WPROS / 100 PROS, or $100 in value', (c) => c],
  ['strict', 'Stricter: 1,000 USDC / 1,000 WPROS, no value rule', (c) => ({ ...c, thresholds: { USDC: '1000', WPROS: '1000' }, usdThreshold: undefined })],
]) {
  const config = validateConfig(edit(raw));
  const r = await scanWhales({ rpc, config, from, to, head: tip });
  runs.push({ id, title, thresholds: Object.fromEntries(Object.entries(config.thresholds).map(([k, v]) => [k, v.text])), usdThreshold: config.usdText, ...r });
  say(`  ${id}: ${r.summary.significantMoves} significant move(s), ${r.summary.positionChanges} position change(s), ${r.summary.walletsActive} of ${r.summary.watched} wallets active`);
}
const report = {
  recordedAt: new Date().toISOString(),
  network: 'Pharos mainnet (chain 1672), read-only: logs, balances (Multicall3) and the PROS/USD feed from the public RPC, at a pinned height',
  window: [from, to], chainHeadAtRecording: tip,
  watchlist: raw.watch, watchlistBasis: 'The eight busiest addresses by number of USDC + WPROS transfers in the 5,000 blocks before the scan window (the largest-volume contract is included), fixed before the scan was run',
  runs,
  summary: { watched: raw.watch.length, defaultMoves: runs[0].summary.significantMoves, strictMoves: runs[1].summary.significantMoves, defaultPositionChanges: runs[0].summary.positionChanges, walletsActive: runs[0].summary.walletsActive },
};
writeFileSync(new URL('../reports/whales-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote reports/whales-run.json: ${report.summary.defaultMoves} moves at default thresholds, ${report.summary.strictMoves} at strict`);
