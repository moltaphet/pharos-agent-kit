#!/usr/bin/env node
// Task: Event/Log Monitor (Chain MCP)
// Polls get_logs filtered by contract address + event topic, prints each new
// event exactly once, and keeps running until stopped.

import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { blockNumber, readToken } from '../lib/chain.js';
import { EVENTS, formatInt, isAddress, isHash32 } from '../lib/abi.js';
import { makeLabeler, parseLabelFlags, shortAddress } from '../lib/labels.js';
import { Dedupe, decodeLog, pageRange } from '../lib/watch.js';
import { fail, parseCli, utc } from '../lib/cli.js';

const DEFAULT_CONTRACT = '0xc879c018db60520f4355c26ed1a6d572cdac1815'; // USDC on Pharos mainnet

const usage = `Usage: pharos-watch [contract] [options]

Watch a Pharos contract for an event and print every new occurrence once.

  contract              0x address to watch (default: USDC on Pharos mainnet)

Options:
  --event <name>        ${Object.keys(EVENTS).join(' | ')}  (default: Transfer)
  --topic0 <0x…>        watch a custom event by its topic0 hash (printed raw)
  --interval <sec>      poll interval in seconds (default: 3)
  --from-block <n>      start scanning at block n (default: only events from now on)
  --max-events <n>      exit after n events (handy for demos and tests)
  --duration <sec>      exit after this many seconds
  --label <0x…=Name>    give an address a name in the output (repeatable)
  --json                one JSON object per line instead of text
  -h, --help            show this help`;

const { values, positionals } = parseCli({
  usage,
  options: {
    event: { type: 'string', default: 'Transfer' },
    topic0: { type: 'string' },
    interval: { type: 'string', default: '3' },
    'from-block': { type: 'string' },
    'max-events': { type: 'string' },
    duration: { type: 'string' },
    label: { type: 'string', multiple: true },
    json: { type: 'boolean' },
  },
});

const address = (positionals[0] ?? DEFAULT_CONTRACT).toLowerCase();
if (!isAddress(address)) fail(`"${positionals[0]}" is not a valid 0x address`, usage);
const topic0 = values.topic0 ?? EVENTS[values.event];
if (!topic0) fail(`unknown event "${values.event}" (use one of ${Object.keys(EVENTS).join(', ')} or --topic0)`, usage);
if (values.topic0 && !isHash32(values.topic0)) fail('--topic0 must be a 32-byte 0x hash', usage);
const num = (flag, v) => {
  if (v == null) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) fail(`--${flag} must be a number`, usage);
  return Number(v);
};
const intervalMs = Math.max(0.5, num('interval', values.interval)) * 1000;
const maxEvents = num('max-events', values['max-events']);
const durationMs = num('duration', values.duration) * 1000 || null;

const label = makeLabeler(parseLabelFlags(values.label));
const client = new McpClient(PHAROS_CHAIN_MCP);
const dedupe = new Dedupe();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const who = (a) => (label(a) ? `${label(a)} (${shortAddress(a)})` : shortAddress(a));

let printed = 0;
let stopping = false;
process.on('SIGINT', () => (stopping = true));

function print(ev) {
  if (values.json) return console.log(JSON.stringify(ev));
  const amt = ev.amount ? `${ev.amount.formatted}${ev.amount.symbol ? ' ' + ev.amount.symbol : ''}` : ev.tokenId ? `tokenId ${ev.tokenId}` : '';
  const parties = [ev.from && who(ev.from), ev.owner && who(ev.owner), ev.spender && `spender ${who(ev.spender)}`]
    .filter(Boolean)
    .join(' → ');
  const to = ev.to ? ` → ${who(ev.to)}` : '';
  const when = ev.timestamp ? utc(ev.timestamp).slice(11) : '--:--:-- UTC';
  const detail = ev.event === 'Unknown' ? `topics=${ev.topics.length} data=${ev.data}` : `${parties}${to}  ${amt}`.trim();
  console.log(`[${when}] block ${formatInt(ev.block)}  ${ev.event.padEnd(10)} ${detail}\n    tx ${ev.txHash}`);
}

try {
  const token = await readToken(client, address); // symbol + decimals so amounts read naturally
  let head = await blockNumber(client);
  let cursor = values['from-block'] ? Number(values['from-block']) : head + 1;
  if (!Number.isInteger(cursor) || cursor < 0) fail('--from-block must be a block number', usage);

  if (!values.json) {
    console.error(`Watching ${values.topic0 ? 'topic ' + topic0.slice(0, 10) + '…' : values.event} on ${token.symbol ?? 'contract'} ${address}`);
    console.error(`Starting at block ${formatInt(cursor)} (chain head ${formatInt(head)}), polling every ${intervalMs / 1000}s. Ctrl-C to stop.\n`);
  }

  const deadline = durationMs ? Date.now() + durationMs : Infinity;
  while (!stopping && Date.now() < deadline && !(maxEvents && printed >= maxEvents)) {
    try {
      head = await blockNumber(client);
      for (const [from, to] of pageRange(cursor, head)) {
        const logs = await client.callTool('get_logs', { address, topics: [topic0], fromBlock: from, toBlock: to });
        logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
        for (const log of logs) {
          if (log.removed || !dedupe.isNew(log)) continue;
          print(decodeLog(log, token));
          printed++;
          if (maxEvents && printed >= maxEvents) break;
        }
        cursor = to + 1; // only advance once the whole window was handled
        if (maxEvents && printed >= maxEvents) break;
      }
      dedupe.prune(head);
    } catch (err) {
      // A flaky poll must not kill a long-running monitor; retry the same window next tick.
      console.error(`warn: poll failed (${err.message}); retrying`);
    }
    await sleep(intervalMs);
  }
  if (!values.json) console.error(`\nStopped after ${printed} event${printed === 1 ? '' : 's'}; last scanned block ${formatInt(cursor - 1)}.`);
  await client.close();
} catch (err) {
  await client.close();
  fail(err.message);
}
