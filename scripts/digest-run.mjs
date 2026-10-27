#!/usr/bin/env node
// The Weekly Digest Agent, run on Pharos MAINNET (read-only): a full digest of the last seven days against the seven before (state at sampled blocks plus every Morpho Blue event log
// of both periods), delivered over real HTTP to Discord-style, ntfy and webhook receivers on 127.0.0.1 (the receivers record the requests), twice, to show that the same digest is
// not sent twice; and published as a page of this site (public/digests/). A scheduled run is the cron entry in vercel.json or `pharos-digest.js --every 7`.
//
//   node scripts/digest-run.mjs        writes reports/digest-run.json, public/digests/latest.html and .md

import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { buildDigest, publishPage } from '../lib/digest.js';
import { makeChannel } from '../lib/alerts.js';
import { deliverDigest } from '../lib/digest-delivery.js';

const say = (s) => process.stderr.write(s + '\n');
const received = [];
const server = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const channel = req.url.startsWith('/discord') ? 'discord' : req.url.startsWith('/ntfy') ? 'ntfy' : 'webhook'; received.push({ channel, method: req.method, path: req.url, contentType: req.headers['content-type'] ?? null, title: req.headers.title ?? null, bytes: b.length, body: b.slice(0, 1500) }); res.writeHead(channel === 'discord' ? 204 : 200).end(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  say('building the digest (about 1–2 minutes) …');
  const t0 = Date.now();
  const d = await buildDigest({ days: 7, depth: 'full' });
  say(`  built in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${d.metrics.length} metrics, ${d.notable.length} notable`);
  const channels = [makeChannel({ type: 'discord', webhookUrl: `${base}/discord/webhook` }), makeChannel({ type: 'ntfy', url: `${base}/ntfy/pharos-digest` }), makeChannel({ type: 'webhook', url: `${base}/webhook` })];
  const state = { sent: {} };
  const link = 'https://pharos-agent-kit.vercel.app/digests/latest.html';
  const first = await deliverDigest({ digest: d, channels, state, link });
  const second = await deliverDigest({ digest: d, channels, state, link });
  writeFileSync(new URL('../public/digests/latest.html', import.meta.url), publishPage(d));
  writeFileSync(new URL('../public/digests/latest.md', import.meta.url), d.markdown);
  const report = {
    recordedAt: new Date().toISOString(), network: 'Pharos mainnet (1672), read-only; delivery over real HTTP to receivers on 127.0.0.1 started by this script', digest: JSON.parse(JSON.stringify(d, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
    delivery: { first, second, received }, published: { page: '/digests/latest.html', markdown: '/digests/latest.md' },
    schedule: { cron: '0 8 * * 1', path: '/api/run?slug=weekly-digest-agent&cron=1', cli: 'node agents/weekly-digest-agent/pharos-digest.js --every 7 --state digest-state.json' },
    summary: { metrics: d.metrics.length, notable: d.notable.length, deliveredFirst: first.delivered.length, deliveredSecond: second.delivered.length, skippedSecond: second.skipped.length },
  };
  writeFileSync(new URL('../reports/digest-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/digest-run.json: ${report.summary.metrics} metrics, ${report.summary.notable} notable events; first delivery ${report.summary.deliveredFirst} messages, second ${report.summary.deliveredSecond} (${report.summary.skippedSecond} skipped as already sent)`);
  process.exitCode = report.summary.deliveredFirst === channels.length && report.summary.deliveredSecond === 0 ? 0 : 1;
} finally { server.close(); }
