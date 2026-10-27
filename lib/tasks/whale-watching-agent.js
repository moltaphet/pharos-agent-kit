// Task: Whale-Watching Agent. The web side of lib/whales.js: the recorded mainnet scan (its moves re-read from the chain on every load) and a live scan of the latest blocks
// over a watchlist the visitor edits. Reads only.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scanWhales, validateConfig, MAX_RANGE, MAX_WATCH } from '../whales.js';
import { publicRpc } from '../onchain.js';
import { UserError } from '../snapshot.js';
import { isAddress } from '../abi.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const TOKENS = { USDC: '0xc879c018db60520f4355c26ed1a6d572cdac1815', WPROS: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0' };
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// the biggest recorded moves are read back: the log at that index is a Transfer of the recorded token, value and parties, in the recorded block
async function verify(run) {
  const moves = [...run.runs[0].moves].sort((a, b) => (BigInt(b.usd ?? 0) > BigInt(a.usd ?? 0) ? 1 : -1)).slice(0, 30);
  const results = {};
  await Promise.all(moves.map(async (m) => {
    try {
      const r = await publicRpc('eth_getTransactionReceipt', [m.txHash]);
      const idx = Number(m.key.split(':')[1]);
      const l = r?.logs.find((x) => Number(BigInt(x.logIndex)) === idx);
      results[m.key] = { verified: Boolean(l) && l.address.toLowerCase() === TOKENS[m.token] && l.topics[0] === TRANSFER && BigInt(l.data).toString() === m.value && '0x' + l.topics[1].slice(26) === m.from && '0x' + l.topics[2].slice(26) === m.to && Number(BigInt(r.blockNumber)) === m.block };
    } catch (err) { results[m.key] = { verified: false, error: err.message }; }
  }));
  return { checkedAt: new Date().toISOString(), total: moves.length, verifiedCount: Object.values(results).filter((r) => r.verified).length, results, head: Number(BigInt(await publicRpc('eth_blockNumber', []))), checked: moves.map((m) => m.key) };
}

export default async function run({ q }) {
  if (q.example) return { config: await json('agents/whale-watching-agent/watchlist.example.json'), maxRange: MAX_RANGE, maxWatch: MAX_WATCH };
  if (q.recorded) { const run = await json('reports/whales-run.json'); return { run, verification: await verify(run) }; }
  if (q.scan) {
    const addresses = String(q.addresses ?? '').split(/[\s,;]+/).filter(Boolean);
    if (addresses.length < 1 || addresses.some((a) => !isAddress(a))) throw new UserError('addresses must be a list of 0x… addresses separated by spaces, commas or new lines');
    const blocks = Math.floor(Number(q.blocks ?? 1000));
    if (!Number.isInteger(blocks) || blocks < 10 || blocks > MAX_RANGE) throw new UserError(`blocks must be a whole number from 10 to ${MAX_RANGE}`);
    const thresholds = {};
    for (const [k, v] of [['USDC', q.usdc], ['WPROS', q.wpros], ['PROS', q.pros]]) if (v != null && v !== '') thresholds[k] = String(v);
    const config = validateConfig({ watch: addresses.map((a, i) => ({ address: a, label: `Wallet ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}` })), thresholds, usdThreshold: q.usd === '' ? undefined : q.usd });
    const tip = Number(BigInt(await publicRpc('eth_blockNumber', []))) - 3; // the RPC's nodes are not always at the same height
    const r = await scanWhales({ rpc: publicRpc, config, from: tip - blocks + 1, to: tip, head: tip });
    return { ...r, moves: r.moves.slice(-60), movesTotal: r.moves.length };
  }
  throw new UserError('use ?example=1, ?recorded=1 or ?scan=1&addresses=0x…,0x…&usdc=1000&wpros=1000&pros=1000&usd=1000&blocks=1000');
}
