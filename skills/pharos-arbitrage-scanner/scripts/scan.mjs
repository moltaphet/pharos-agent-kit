#!/usr/bin/env node
// Scan FaroSwap V2 vs V3 for an arbitrage on one pair. Read-only: "execute" is a simulated fill.
//   node skills/pharos-arbitrage-scanner/scripts/scan.mjs [--pair WPROS/DLP] [--size 1] [--min-net 0.001]
//        [--source live|profitable|marginal] [--watch 5 --interval 4] [--log scans.jsonl] [--json]
// Exit code: 0 = a profitable (simulated) trade was found, 10 = skipped, 1 = error. Run from the repo root.
import { appendFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { scanPair } from '../../../lib/tasks/arbitrage-scanner.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const pair = arg('pair', 'WPROS/DLP');
const source = arg('source', 'live');
const cfg = { size: Number(arg('size', 1)), minNet: Number(arg('min-net', 0.001)) };
const watch = Number(arg('watch', 1));
const interval = Number(arg('interval', 4)) * 1000;
const logFile = arg('log');
const asJson = process.argv.includes('--json');
const n = (x, d = 5) => (x == null ? 'n/a' : Number(x.toPrecision(d)).toString());

const chain = new McpClient(PHAROS_CHAIN_MCP);
let acted = 0;
try {
  for (let i = 1; i <= watch; i++) {
    const r = await scanPair({ chain }, pair, cfg, source);
    if (r.decision === 'execute-simulated') acted++;
    if (logFile) await appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n');
    if (asJson) console.log(JSON.stringify(r));
    else {
      console.log(`scan ${i}/${watch}  ${r.pair}  block ${r.block ?? 'synthetic'}${r.sourceLabel ? `  [${r.sourceLabel}]` : ''}`);
      console.log(`  ${r.sources.v2.venue} ${n(r.sources.v2.price)} ${r.quote}/${r.base}   ${r.sources.v3.venue} ${n(r.sources.v3.price)}`);
      console.log(`  gross spread ${n(r.grossSpreadPct, 4)}%   best size ${n(r.size)} ${r.quote}`);
      console.log(`  gross ${n(r.gross)} − fees ${n(r.costs.fees)} − price impact ${n(r.costs.priceImpact)} − gas ${n(r.costs.gas)} = net ${n(r.net)} ${r.quote}`);
      console.log(`  DECISION ${r.decision.toUpperCase()}${r.fill ? ` (simulated fill: spend ${n(r.fill.spend)}, receive ${n(r.fill.receive)})` : ''}`);
      for (const why of r.reasons) console.log(`    skipped because: ${why}`);
    }
    if (i < watch) await new Promise((res) => setTimeout(res, interval));
  }
  process.exitCode = acted ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
