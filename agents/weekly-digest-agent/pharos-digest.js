#!/usr/bin/env node
// Task 28: a digest of what changed on Pharos in a period, against the period before, with the three notable things; printed, published as a page, delivered to your channel, on a schedule.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { buildDigest, publishPage } from '../../lib/digest.js';
import { deliverDigest } from '../../lib/digest-delivery.js';
import { channelsFromEnv } from '../../lib/alerts.js';

const usage = `Usage: pharos-digest [--days <1-14, default 7>] [--depth full|state] [--publish <dir>] [--deliver] [--every <days>] [--state <file>]
  --publish   writes <dir>/latest.html and latest.md        --deliver  sends it to the channels in the environment (DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, NTFY_URL, ALERT_WEBHOOK_URL)
  --every N   keeps running and makes a digest every N days (7 = weekly); with --state the same period is never sent twice`;
const { values } = parseCli({ usage, allowPositionals: false, options: { days: { type: 'string' }, depth: { type: 'string' }, publish: { type: 'string' }, deliver: { type: 'boolean' }, every: { type: 'string' }, state: { type: 'string' } } });
const days = values.days ? Number(values.days) : 7;
const depth = values.depth ?? 'full';
if (!Number.isInteger(days) || days < 1 || days > 14) fail('--days must be a whole number from 1 to 14', usage);
if (!['full', 'state'].includes(depth)) fail('--depth must be full or state', usage);
const every = values.every ? Number(values.every) : null;
if (every != null && !(every >= 0.01 && every <= 31)) fail('--every must be a number of days from 0.01 to 31', usage);
const statePath = values.state ? resolve(values.state) : null;
const state = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { sent: {} };

async function once() {
  const d = await buildDigest({ days, depth });
  console.log(d.markdown);
  if (values.publish) { const dir = resolve(values.publish); mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/latest.html`, publishPage(d)); writeFileSync(`${dir}/latest.md`, d.markdown); console.error(`published to ${dir}`); }
  if (values.deliver) {
    const channels = channelsFromEnv();
    if (!channels.length) throw new Error('no channel configured: set DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, NTFY_URL or ALERT_WEBHOOK_URL');
    const r = await deliverDigest({ digest: d, channels, state, link: values.publish ? `file://${resolve(values.publish)}/latest.html` : 'https://pharos-agent-kit.vercel.app/#/weekly-digest-agent/try' });
    if (statePath) writeFileSync(statePath, JSON.stringify(state));
    console.error(`delivered to ${r.delivered.map((x) => x.channel).join(', ') || 'nobody'}; ${r.skipped.length} already had it${r.failed.length ? `; FAILED: ${r.failed.map((f) => `${f.channel} (${f.error})`).join(', ')}` : ''}`);
    if (r.failed.length) process.exitCode = 2;
  }
}
try {
  await once();
  if (every != null) for (;;) { await new Promise((r) => setTimeout(r, every * 86_400_000)); try { await once(); } catch (err) { console.error(`digest failed: ${err.message}`); } }
} catch (err) { console.error(`error: ${err.message}`); process.exitCode = 1; }
