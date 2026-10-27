// Task: Wallet Risk Checker. The web side of lib/risk.js: a live check of any address on Pharos mainnet or Atlantic testnet, and the recorded examples (clean, middle, risky)
// with the Atlantic setup transactions re-read from the chain on every load.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CHAINS, chainRpc, checkAddress } from '../risk.js';
import { UserError } from '../snapshot.js';
import { isAddress } from '../abi.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));

async function verify(run) {
  const rpc = chainRpc(CHAINS.atlantic);
  const d = run.demo;
  const txs = { 'Deploy the risky token': d.deployTx, 'Fund the fresh wallet': d.fundTx, 'Unlimited approval from the fresh wallet': d.approveTx };
  const rows = await Promise.all(Object.entries(txs).map(async ([label, hash]) => { const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null); return { label, hash, ok: Boolean(r) && r.status === '0x1', block: r ? Number(BigInt(r.blockNumber)) : null }; }));
  const code = await rpc('eth_getCode', [d.riskyToken, 'latest']);
  return { checkedAt: new Date().toISOString(), txs: rows, riskyTokenHasCode: code !== '0x', total: rows.length + 1, verifiedCount: rows.filter((r) => r.ok).length + (code !== '0x' ? 1 : 0) };
}

export default async function run({ q }) {
  if (q.recorded) { const run = await json('reports/risk-run.json'); return { run, verification: await verify(run) }; }
  if (q.check) {
    const chain = CHAINS[q.chain ?? 'mainnet'];
    if (!chain) throw new UserError('chain must be mainnet or atlantic');
    if (!isAddress(q.address)) throw new UserError('address must be a 0x… address of 40 hex digits');
    const flagged = String(q.flagged ?? '').split(/[\s,;]+/).filter(Boolean).slice(0, 50);
    return { result: await checkAddress({ chain, address: q.address, flagged, window: 20_000 }) };
  }
  if (q.example) { const run = await json('reports/risk-run.json'); return { examples: run.examples.map((e) => ({ id: e.id, chain: e.chain, address: e.address, title: e.title })) }; }
  throw new UserError('use ?check=1&chain=mainnet&address=0x…, ?recorded=1 or ?example=1');
}
