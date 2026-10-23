// The recorded run on Pharos Atlantic testnet (reports/testnet-runs.json, written by scripts/testnet-run.mjs), plus a live
// check of it: every transaction in the report is read back from the chain NOW and compared with what was recorded, so a
// visitor is not asked to trust the JSON file.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ATLANTIC } from './rpc-chain.js';
import { rpcCall } from './rpc.js';

export async function loadTestnetReport() {
  const file = fileURLToPath(new URL('../reports/testnet-runs.json', import.meta.url));
  return JSON.parse(await readFile(file, 'utf8'));
}

const hexNum = (h) => Number(BigInt(h));

// Compares one recorded transaction with the chain. `rpc(method, params)` is injectable for tests.
export async function verifyTx(tx, rpc) {
  let receipt = null;
  let fetched = null;
  try {
    [receipt, fetched] = await Promise.all([rpc('eth_getTransactionReceipt', [tx.hash]), rpc('eth_getTransactionByHash', [tx.hash])]);
  } catch (err) {
    return { hash: tx.hash, verified: false, reason: `could not read it from the chain: ${err.message}` };
  }
  if (!receipt) return { hash: tx.hash, verified: false, reason: 'the chain has no receipt for this hash' };
  const chain = { status: receipt.status === '0x1' ? 'success' : 'reverted', gasUsed: hexNum(receipt.gasUsed), blockNumber: hexNum(receipt.blockNumber), from: receipt.from?.toLowerCase(), to: (receipt.to ?? receipt.contractAddress)?.toLowerCase(), value: fetched ? BigInt(fetched.value).toString() : null };
  const want = { status: tx.status, gasUsed: tx.gasUsed, blockNumber: tx.blockNumber, from: tx.from?.toLowerCase(), to: (tx.to ?? tx.contractAddress)?.toLowerCase(), value: tx.valueWei };
  const differs = Object.keys(want).filter((k) => want[k] != null && chain[k] !== want[k]);
  return { hash: tx.hash, verified: differs.length === 0, chain, ...(differs.length && { reason: `the chain disagrees on: ${differs.map((k) => `${k} (recorded ${want[k]}, chain ${chain[k]})`).join('; ')}` }) };
}

const TTL_MS = 60_000;
let cache = null;

// { report, verification: { checkedAt, head, walletBalanceWei, verifiedCount, total, results: { [hash]: {...} } } }
export async function testnetEvidence({ rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `Verify the recorded testnet run (${method})` }), now = () => Date.now(), report } = {}) {
  if (cache && now() - cache.at < TTL_MS && !report) return cache.value;
  const rec = report ?? (await loadTestnetReport());
  const [results, head, balance] = await Promise.all([Promise.all(rec.transactions.map((tx) => verifyTx(tx, rpc))), rpc('eth_blockNumber', []), rpc('eth_getBalance', [rec.wallet, 'latest'])]);
  const value = {
    report: rec,
    verification: {
      checkedAt: new Date(now()).toISOString(),
      head: hexNum(head),
      walletBalanceWei: BigInt(balance).toString(),
      verifiedCount: results.filter((r) => r.verified).length,
      total: results.length,
      results: Object.fromEntries(results.map((r) => [r.hash, r])),
    },
  };
  if (!report) cache = { at: now(), value };
  return value;
}
export const resetTestnetCache = () => (cache = null);
