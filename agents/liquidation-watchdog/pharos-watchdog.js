#!/usr/bin/env node
// Task: Liquidation Watchdog.
// Watches a borrower's position in a Morpho Blue market on Pharos mainnet and alerts before it can be liquidated. Read-only: every call is an eth_call.

import { McpClient, PHAROS_CHAIN_MCP } from '../../lib/mcp.js';
import { channelsFromEnv, runWatchdog } from '../../lib/liquidation.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-watchdog --market 0x<64 hex> --borrower 0x… [options]

Read a Morpho Blue position on Pharos mainnet, work out its health factor the way Morpho does, and alert if it is close to liquidation.

  pharos-watchdog --market 0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86 --borrower 0x743d7b30661d65b41960bf6b5d1bb93cf7972a73
  pharos-watchdog --market 0xc795… --borrower 0x743d… --warn 1.5 --critical 1.2 --watch 60

Options:
  --market <0x…>       the Morpho Blue market id (32 bytes)
  --borrower <0x…>     the account whose position to watch
  --warn <n>           warn at or below this health factor (default 1.3)
  --critical <n>       critical at or below this health factor (default 1.1)
  --watch <seconds>    keep watching: look again every N seconds (at least 10) and alert when the level gets worse
  --block <n>          read at this block (default: two behind the latest)
  --json               print the full result as JSON
  -h, --help           show this help

Alerts go to the console, with a timestamp. If DISCORD_WEBHOOK_URL (or TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID) is set in the environment, they go there too.
Exit codes: 0 ok · 10 warning · 11 critical · 12 liquidatable · 1 error`;

const { values } = parseCli({
  usage,
  options: { market: { type: 'string' }, borrower: { type: 'string' }, warn: { type: 'string' }, critical: { type: 'string' }, watch: { type: 'string' }, block: { type: 'string' }, json: { type: 'boolean' } },
});
if (!values.market || !values.borrower) fail('--market and --borrower are required', usage);
const every = values.watch == null ? null : Number(values.watch);
if (every != null && (!Number.isFinite(every) || every < 10)) fail('--watch must be a number of seconds, at least 10', usage);

const chain = new McpClient(PHAROS_CHAIN_MCP);
const channels = channelsFromEnv(process.env, (s) => console.log(s));
const thresholds = { ...(values.warn && { warn: values.warn }), ...(values.critical && { critical: values.critical }) };
const EXIT = { ok: 0, 'no-debt': 0, warning: 10, critical: 11, liquidatable: 12 };
let exitCode = 0;
try {
  let previousLevel = null;
  for (;;) {
    const r = await runWatchdog({ chain, marketId: values.market, borrower: values.borrower, block: values.block ? Number(values.block) : null, thresholds, channels: values.json ? [] : channels, previousLevel });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else if (!r.alertSent) console.log(`[${new Date().toISOString()}] ${r.level.toUpperCase()}${r.healthFactor ? `: health factor ${r.healthFactor.toFixed(4)}` : ''} at block ${r.block.number.toLocaleString('en-US')} — no new alert${previousLevel ? ` (was ${previousLevel})` : ''}`);
    if (!values.json && r.delivered.some((d) => d.channel !== 'console')) console.log(`  also sent to: ${r.delivered.filter((d) => d.channel !== 'console').map((d) => `${d.channel} (${d.ok ? 'ok' : 'failed'})`).join(', ')}`);
    previousLevel = r.level;
    exitCode = EXIT[r.level] ?? 0;
    if (every == null) break;
    await new Promise((res) => setTimeout(res, every * 1000));
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  exitCode = 1;
} finally {
  await chain.close();
}
process.exitCode = exitCode;
