#!/usr/bin/env node
// Task 22: watch Pharos mainnet for the conditions in a config file and deliver alerts to Discord, Telegram, ntfy or a webhook (channels come from the environment).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { channelsFromEnv, makeChannel, newState, runCycle, validateConditions } from '../../lib/alerts.js';

const usage = `Usage: pharos-alerts --config <alerts.json> [--state <file>] [--once | --interval <seconds>] [--lookback <blocks>] [--dry-run]
Channels (environment): DISCORD_WEBHOOK_URL · TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID · NTFY_URL · ALERT_WEBHOOK_URL. --dry-run prints alerts to the console instead.`;
const { values } = parseCli({ usage, allowPositionals: false, options: {
  config: { type: 'string' }, state: { type: 'string' }, once: { type: 'boolean' }, interval: { type: 'string' }, lookback: { type: 'string' }, 'dry-run': { type: 'boolean' },
} });
if (!values.config) fail('provide --config', usage);

try {
  const text = readFileSync(resolve(values.config), 'utf8');
  if (text.length > 64 * 1024) throw new Error('config is larger than 64 KiB');
  const config = JSON.parse(text);
  const conditions = validateConditions(config.conditions);
  const channels = values['dry-run'] ? [makeChannel({ type: 'console' })] : channelsFromEnv();
  if (channels.length === 0) throw new Error('no channel configured: set DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, NTFY_URL or ALERT_WEBHOOK_URL (or use --dry-run)');
  const lookback = values.lookback ? Number(values.lookback) : 300;
  const interval = values.interval ? Number(values.interval) : null;
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 5000) throw new Error('--lookback must be a whole number from 1 to 5000');
  if (interval != null && !(interval >= 5 && interval <= 3600)) throw new Error('--interval must be 5 to 3600 seconds');
  const statePath = values.state ? resolve(values.state) : null;
  const state = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : newState();
  const cycle = async () => {
    const r = await runCycle({ conditions, channels, state, lookback, labels: config.labels ?? {} });
    if (statePath) writeFileSync(statePath, JSON.stringify(state));
    console.error(`blocks ${r.from}–${r.to}: ${r.found} event(s), ${r.delivered.length} delivered, ${r.duplicates} already sent${r.failed.length ? `, ${r.failed.length} FAILED (will be retried): ${r.failed[0].error}` : ''}`);
    return r;
  };
  if (interval == null || values.once) { const r = await cycle(); if (r.failed.length) process.exitCode = 2; }
  else for (;;) { try { await cycle(); } catch (err) { console.error(`cycle failed: ${err.message}`); } await new Promise((res) => setTimeout(res, interval * 1000)); }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
