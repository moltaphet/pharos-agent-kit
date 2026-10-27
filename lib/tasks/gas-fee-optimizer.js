// Task: Gas Fee Optimizer. The web side of lib/gas.js: the gas history of Pharos mainnet and Atlantic, what the optimizer would do right now for a ceiling and a deadline,
// and the recorded real run (four transactions on Atlantic, each read back from the chain). The web never sends a transaction.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decide, effectivePrice, feesFor, gasHistory, sampleGas } from '../gas.js';
import { rpcCall } from '../rpc.js';
import { ATLANTIC } from '../rpc-chain.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const CHAINS = { mainnet: { name: 'Pharos mainnet (1672)', url: 'https://rpc.pharos.xyz', explorer: 'https://www.pharosscan.xyz' }, atlantic: { name: 'Pharos Atlantic testnet (688689)', url: ATLANTIC.rpc, explorer: 'https://atlantic.pharosscan.xyz' } };
const rpcOf = (chain) => (m, p = []) => rpcCall(m, p, { url: chain.url, why: `gas optimizer: ${m}` });
const ser = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

// every recorded transaction is read back: mined, successful, and it paid exactly the recorded gas and price
async function verify(run) {
  const rpc = rpcOf(CHAINS.atlantic);
  const txs = run.scenarios.map((s) => ({ id: s.id, tx: s.tx }));
  const results = {};
  await Promise.all(txs.map(async ({ id, tx }) => {
    try {
      const r = await rpc('eth_getTransactionReceipt', [tx.hash]);
      results[id] = { verified: Boolean(r) && r.status === '0x1' && String(BigInt(r.gasUsed)) === String(tx.gasUsed) && String(BigInt(r.effectiveGasPrice)) === String(tx.effectiveGasPrice) && Number(BigInt(r.blockNumber)) === tx.block };
    } catch (err) { results[id] = { verified: false, error: err.message }; }
  }));
  return { checkedAt: new Date().toISOString(), total: txs.length, verifiedCount: Object.values(results).filter((r) => r.verified).length, results, head: Number(BigInt(await rpc('eth_blockNumber'))) };
}

export default async function run({ q }) {
  if (q.recorded) { const run = await json('reports/gas-run.json'); return { run, verification: await verify(run) }; }
  if (q.history) {
    const chain = Object.hasOwn(CHAINS, q.chain ?? 'mainnet') ? CHAINS[q.chain ?? 'mainnet'] : null;
    if (!chain) throw new UserError('chain must be mainnet or atlantic');
    const rpc = rpcOf(chain);
    const span = Math.floor(Number(q.span ?? 3000));
    const history = await gasHistory(rpc, { span, points: 30 });
    const now = await sampleGas(rpc);
    let maxPrice = null;
    if (q.maxGwei != null && q.maxGwei !== '') {
      if (!/^\d{1,6}(\.\d{1,9})?$/.test(String(q.maxGwei))) throw new UserError('maxGwei must be a plain number like 0.5 or 12');
      const [w, f = ''] = String(q.maxGwei).split('.');
      maxPrice = BigInt(w) * 10n ** 9n + BigInt(f.padEnd(9, '0'));
      if (maxPrice === 0n) throw new UserError('maxGwei must be above zero: a ceiling of nothing can never be met');
    }
    const deadlineSec = Math.floor(Number(q.deadlineSec ?? 120));
    if (!Number.isInteger(deadlineSec) || deadlineSec < 5 || deadlineSec > 86_400) throw new UserError('deadlineSec must be 5 to 86,400');
    const gas = Math.floor(Number(q.gas ?? 21_000));
    if (!Number.isInteger(gas) || gas < 21_000 || gas > 30_000_000) throw new UserError('gas must be 21,000 to 30,000,000');
    const d = decide({ sample: now, maxPrice, history });
    const fees = feesFor(now);
    return ser({ chain: chain.name, history, now: { ...now, effective: effectivePrice(now) }, decision: { ...d, action: d.favorable ? 'submit now' : `hold, re-check every few seconds, and submit by the deadline (${deadlineSec}s) whatever the price` , deadlineSec },
      cost: { gas, optimizedWei: effectivePrice(now) * BigInt(gas), naiveWei: now.gasPrice * BigInt(gas), fees },
      note: 'Prices are read live. The web never sends a transaction; the CLI sends on Atlantic testnet with a throwaway key and only prepares for mainnet.' });
  }
  throw new UserError('use ?history=1&chain=mainnet&maxGwei=12&deadlineSec=120&gas=21000 or ?recorded=1');
}
