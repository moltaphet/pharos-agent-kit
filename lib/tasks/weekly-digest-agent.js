// Task: Weekly Digest Agent. The web side of lib/digest.js: the recorded digest (its numbers re-read from the chain on every load), a live digest of any 1 to 14 days (state depth, so it
// answers within the web's minute), and the scheduled run: Vercel calls ?cron=1 every Monday at 08:00 UTC with the project's CRON_SECRET, and the digest goes to the channels set
// in the environment (DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, NTFY_URL, ALERT_WEBHOOK_URL). Without a secret or a channel it does nothing.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { buildDigest } from '../digest.js';
import { deliverDigest } from '../digest-delivery.js';
import { channelsFromEnv } from '../alerts.js';
import { batchRpcStrict } from '../rpc-batch.js';
import { VAULT_LIST } from '../defi.js';
import { selectorOf } from '../keccak.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const SITE = 'https://pharos-agent-kit.vercel.app';

// the recorded end-of-period levels are read again at the recorded block and must equal the recorded figures
async function verify(rec) {
  const block = '0x' + rec.digest.periods.current.toBlock.toString(16);
  const rows = await batchRpcStrict([
    { method: 'eth_call', params: [{ to: '0xc879c018db60520f4355c26ed1a6d572cdac1815', data: selectorOf('totalSupply()') }, block] },
    ...VAULT_LIST.map((v) => ({ method: 'eth_call', params: [{ to: v.address, data: selectorOf('totalAssets()') }, block] })),
  ]);
  const m = (id) => rec.digest.metrics.find((x) => x.id === id);
  const usdc = Number(BigInt(rows[0])) / 1e6;
  const tvl = rows.slice(1).reduce((s, r) => s + Number(BigInt(r)) / 1e6, 0);
  const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-6);
  const checks = [{ what: 'USDC supply at the end of the period', recorded: m('usdc').now, now: usdc, ok: near(usdc, m('usdc').now) }, { what: 'value locked in the four vaults', recorded: m('vault-tvl').now, now: tvl, ok: near(tvl, m('vault-tvl').now) }];
  const txs = await batchRpcStrict(rec.digest.notable.filter((n) => n.link).map((n) => ({ method: 'eth_getTransactionReceipt', params: [n.link.split('/').pop()] })));
  const notable = rec.digest.notable.filter((n) => n.link).map((n, i) => ({ what: `notable transaction ${n.link.split('/').pop().slice(0, 10)}…`, ok: Boolean(txs[i]) && parseInt(txs[i].blockNumber, 16) === n.block }));
  const all = [...checks, ...notable];
  return { checkedAt: new Date().toISOString(), checks: all, total: all.length, verifiedCount: all.filter((c) => c.ok).length };
}

const authorised = (headers) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(headers?.authorization ?? ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
};

export default async function run({ q, headers }) {
  if (q.recorded) { const rec = await json('reports/digest-run.json'); return { run: rec, verification: await verify(rec) }; }
  if (q.digest) {
    const days = Number(q.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 7) throw new UserError('days must be a whole number from 1 to 7 on the web (the CLI makes digests of up to 14 days)');
    return jsonSafe({ digest: await buildDigest({ days, depth: 'state' }), note: 'A live digest at state depth: every number is read from the chain now. The full digest (with the Morpho event logs) takes about a minute and is made by the CLI.' });
  }
  if (q.cron) {
    if (!authorised(headers)) throw new UserError('the scheduled run needs the project’s CRON_SECRET: Vercel sends it as a bearer token');
    const channels = channelsFromEnv();
    const digest = await buildDigest({ days: 7, depth: 'state' });
    if (channels.length === 0) return { delivered: [], note: 'no channel is configured (DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID, NTFY_URL or ALERT_WEBHOOK_URL), so the digest was built and not sent', headline: digest.headline };
    return { ...(await deliverDigest({ digest, channels, state: {}, link: `${SITE}/#/weekly-digest-agent/try` })), headline: digest.headline };
  }
  throw new UserError('use ?recorded=1 or ?digest=1&days=7');
}
