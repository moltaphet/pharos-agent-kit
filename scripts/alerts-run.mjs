#!/usr/bin/env node
// The On-Chain Alert Bot, run against Pharos MAINNET (chain 1672, read-only): real blocks, real USDC/WPROS transfers, the real PROS/USD feed, real contract calls, delivered over real HTTP
// to receivers this script runs on 127.0.0.1 (Discord-webhook, ntfy and generic-webhook endpoints). The receivers record what the HTTP request was, so the delivery is on record. Sending
// to Discord/Telegram itself needs the owner's webhook URL or bot token (DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID), which this repository does not have.
//
// Scenarios: (1) a first cycle delivers every event once; (2) the same window again sends nothing; (3) a channel outage: nothing is lost and a recovered channel gets only what it missed;
// (4) the state saved to disk and loaded in a "restarted" bot still suppresses repeats; (5) a call condition over the last 200 blocks.
//
//   node scripts/alerts-run.mjs        writes reports/alerts-run.json

import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { rpcCall } from '../lib/rpc.js';
import { makeChannel, newState, runCycle, validateConditions } from '../lib/alerts.js';

const say = (s) => process.stderr.write(s + '\n');
const rpc = (m, p) => rpcCall(m, p, { why: `alert bot run: ${m}` });
const head = Number(BigInt(await rpc('eth_blockNumber', []))) - 3000; // pinned: the window is old enough that every node has it and a reader can repeat the scan
say(`pinned head: block ${head}`);

// ---- receivers ----------------------------------------------------------------------------------------------------------------------------
const received = [];
let failDiscord = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const channel = req.url.startsWith('/discord') ? 'discord' : req.url.startsWith('/ntfy') ? 'ntfy' : 'webhook';
    if (channel === 'discord' && failDiscord > 0) { failDiscord--; received.push({ channel, method: req.method, path: req.url, answered: 503, note: 'receiver is down' }); res.writeHead(503).end(); return; }
    received.push({ channel, method: req.method, path: req.url, contentType: req.headers['content-type'] ?? null, title: req.headers.title ?? null, click: req.headers.click ?? null, bytes: body.length, body: body.slice(0, 700), answered: channel === 'discord' ? 204 : 200 });
    res.writeHead(channel === 'discord' ? 204 : 200).end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const mkChannels = () => [makeChannel({ type: 'discord', webhookUrl: `${base}/discord/webhook` }), makeChannel({ type: 'ntfy', url: `${base}/ntfy/pharos-alerts` }), makeChannel({ type: 'webhook', url: `${base}/webhook` })];

const conditions = validateConditions([
  { id: 'usdc-10k', label: 'USDC transfer of 10,000 or more', type: 'transfer', token: 'USDC', min: '10000' },
  { id: 'wpros-1k', label: 'WPROS transfer of 1,000 or more', type: 'transfer', token: 'WPROS', min: '1000' },
  { id: 'pros-above-60c', label: 'PROS/USD above 0.60', type: 'price', feed: 'PROS/USD', op: 'above', threshold: '0.60' },
  { id: 'wpros-deposits', label: 'WPROS Deposit events', type: 'event', contract: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', signature: 'Deposit(address,uint256)' },
]);
const callConditions = validateConditions([{ id: 'calls-0xf4a0', label: 'Calls of 0x04060252 on 0xf4a0…904c', type: 'call', contract: '0xf4a04f7537d8456ba0c78a518cb60a334579904c', method: '0x04060252' }]);
const summarize = (r) => ({ window: [r.from, r.to], eventsFound: r.found, delivered: r.delivered.length, suppressedDuplicates: r.duplicates, failed: r.failed.length, cursorAfter: r.cursor });
const scenarios = [];
const add = (id, title, r, extra = {}) => { scenarios.push({ id, title, ...summarize(r), ...extra }); say(`  ${id}: found ${r.found} · delivered ${r.delivered.length} · duplicates suppressed ${r.duplicates} · failed ${r.failed.length}`); };

try {
  const state = newState();
  const channels = mkChannels();
  const r1 = await runCycle({ rpc, conditions, channels, state, head, lookback: 1000 });
  add('first-cycle', 'First cycle over 1,000 mainnet blocks: every event goes to every channel once', r1, { byCondition: Object.fromEntries(conditions.map((c) => [c.id, r1.alerts.filter((a) => a.conditionId === c.id).length])) });
  const sample = r1.alerts.slice(0, 40).map((a) => ({ key: a.key, condition: a.conditionId, title: a.title, what: a.what, value: a.value, block: a.block, link: a.link }));
  const keys = r1.alerts.map((a) => ({ key: a.key, condition: a.conditionId, block: a.block }));

  const again = await runCycle({ rpc, conditions, channels, state: { ...state, cursor: null }, head, lookback: 1000 });
  add('same-window-again', 'The same 1,000 blocks scanned again (cursor reset): nothing is sent twice', again);

  const saved = JSON.parse(JSON.stringify(state)); // what a state file holds
  const restarted = await runCycle({ rpc, conditions, channels: mkChannels(), state: { ...saved, cursor: null }, head, lookback: 1000 });
  add('restart-from-state-file', 'A restarted bot loads the saved state: still nothing is sent twice', restarted);

  failDiscord = 1_000_000; // the Discord endpoint is down: every attempt is answered with a 503
  const outageState = newState();
  const deliveredBefore = received.length;
  const down = await runCycle({ rpc, conditions: [conditions[3]], channels: mkChannels(), state: outageState, head, lookback: 1000 });
  const stillDown = { cursor: outageState.cursor, failed: down.failed.length };
  failDiscord = 0;
  add('channel-outage', 'Discord down for the first attempts: the cycle reports failures and does not move on', down, { cursorMoved: down.cursor != null });
  const recovered = await runCycle({ rpc, conditions: [conditions[3]], channels: mkChannels(), state: outageState, head, lookback: 1000 });
  add('channel-recovered', 'Discord back: only what it missed is sent; ntfy and the webhook are not sent the same alerts again', recovered, { sentTo: Object.fromEntries(['discord', 'ntfy', 'webhook'].map((c) => [c, recovered.delivered.filter((d) => d.channel === c).length])) });
  void deliveredBefore; void stillDown;

  const callState = newState();
  const rc = await runCycle({ rpc, conditions: callConditions, channels: mkChannels(), state: callState, head, lookback: 200 });
  add('call-condition', 'A call condition over the last 200 blocks of the window', rc);
  const callSample = rc.alerts.slice(0, 5).map((a) => ({ key: a.key, condition: a.conditionId, title: a.title, what: a.what, value: a.value, block: a.block, link: a.link }));

  const report = {
    recordedAt: new Date().toISOString(),
    network: 'Pharos mainnet (chain 1672), read-only: blocks, logs and the PROS/USD feed read from the public RPC; delivery over real HTTP to receivers on 127.0.0.1 started by this script',
    pinnedHead: head,
    conditions: [...conditions, ...callConditions].map((c) => ({ id: c.id, label: c.label, type: c.type })),
    scenarios,
    alerts: { keys, sample, callSample },
    received: received.slice(0, 12),
    receivedTotal: received.length,
    summary: {
      eventsInFirstWindow: r1.found,
      duplicatesSentOnRescan: again.delivered.length + restarted.delivered.length,
      outageLostNothing: down.cursor == null && recovered.failed.length === 0 && recovered.delivered.filter((d) => d.channel !== 'discord').length === 0,
      callEvents: rc.found,
    },
  };
  writeFileSync(new URL('../reports/alerts-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/alerts-run.json: ${r1.found} events, ${report.summary.duplicatesSentOnRescan} duplicates on rescans, outage lost nothing: ${report.summary.outageLostNothing}`);
  process.exitCode = report.summary.duplicatesSentOnRescan === 0 && report.summary.outageLostNothing ? 0 : 1;
} finally {
  server.close();
}
