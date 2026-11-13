// The ONLY place in this repository that signs and sends transactions, for the scripts that make real Atlantic testnet
// transactions (scripts/testnet-run.mjs, scripts/testnet-guardian.mjs). Both go through here so the guards live in one spot:
//   - it refuses to send unless the chain it is talking to has id 688689 (Pharos Atlantic testnet), so it cannot reach mainnet;
//   - it stops once the run has spent more than its budget;
//   - the key is read from the git-ignored .wallet/ file, passed to `cast` only for the second a send takes, and never printed.
// `cast` can only take a raw key as `--private-key` (it has no environment variable for one); that argument is visible to other
// users of this machine for that second, which is acceptable for a throwaway key that only ever holds test tokens.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATLANTIC } from './rpc-chain.js';
import { rpcCall } from './rpc.js';

export const WALLET_FILE = fileURLToPath(new URL('../.wallet/atlantic-testnet.json', import.meta.url));
export const phrs = (w) => `${(Number(w) / 1e18).toFixed(9)} PHRS`;

export function makeSigner({ rpcUrl, budgetWei = 10n ** 16n, log = () => {}, walletFile = WALLET_FILE, startedAt = new Date().toISOString() }) {
  const wallet = JSON.parse(readFileSync(walletFile, 'utf8'));
  const rpc = (method, params = []) => rpcCall(method, params, { url: rpcUrl, why: method });
  const cast = (args, { signed = false } = {}) => execFileSync('cast', signed ? [args[0], '--private-key', wallet.privateKey, ...args.slice(1)] : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const txs = [];
  let spent = 0n;

  async function send({ label, to, data = '0x', value = 0n, gas, create = null, fees = null }) {
    if (BigInt(await rpc('eth_chainId')) !== BigInt(ATLANTIC.chainId)) throw new Error(`refusing to send: this is not Pharos Atlantic testnet (${ATLANTIC.chainId})`);
    if (spent > budgetWei) throw new Error(`stopping: spent ${phrs(spent)}, over the ${phrs(budgetWei)} budget`);
    const args = ['send', '--json', '--rpc-url', rpcUrl, '--gas-limit', String(gas), ...(fees?.legacy ? ['--legacy', '--gas-price', String(fees.gasPrice)] : fees ? ['--gas-price', String(fees.maxFeePerGas), ...(fees.maxPriorityFeePerGas != null ? ['--priority-gas-price', String(fees.maxPriorityFeePerGas)] : [])] : []), ...(value > 0n ? ['--value', value.toString()] : []), ...(create ? ['--create', create] : [to, ...(data !== '0x' ? [data] : [])])];
    let hash;
    try {
      hash = JSON.parse(cast(args, { signed: true })).transactionHash;
    } catch (err) {
      // cast exits non-zero on a reverted transaction but still mined it: recover the hash from its message
      const m = `${err.stdout ?? ''}${err.stderr ?? ''}`.match(/0x[0-9a-fA-F]{64}/);
      if (!m) throw new Error(`cast send failed: ${String(err.stderr ?? '').split('\n')[0].replaceAll(wallet.privateKey, '[key]')}`);
      hash = m[0];
    }
    let r = null;
    for (let i = 0; i < 60 && !r; i++) { r = await rpc('eth_getTransactionReceipt', [hash]); if (!r) await new Promise((x) => setTimeout(x, 1000)); }
    if (!r) throw new Error(`no receipt for ${hash}`);
    const gasUsed = Number(BigInt(r.gasUsed));
    const price = BigInt(r.effectiveGasPrice);
    const cost = BigInt(gasUsed) * price;
    spent += cost + (r.status === '0x1' ? value : 0n);
    const tx = { label, hash, blockNumber: Number(BigInt(r.blockNumber)), status: r.status === '0x1' ? 'success' : 'reverted', gasUsed, gasLimit: gas, gasPriceGwei: Number(price) / 1e9, costWei: cost.toString(), from: r.from, to: r.to, valueWei: value.toString() };
    if (r.contractAddress) tx.contractAddress = r.contractAddress;
    txs.push(tx);
    log(`  tx ${label}: ${tx.status}, gas ${gasUsed.toLocaleString('en-US')}, ${hash.slice(0, 12)}…`);
    return tx;
  }

  return {
    wallet: { address: wallet.address },
    from: wallet.address.toLowerCase(),
    rpc,
    send,
    txs,
    spent: () => spent,
    balance: async (a = wallet.address) => BigInt(await rpc('eth_getBalance', [a, 'latest'])),
    // A fresh address per label and run, so every recipient is a brand new account.
    fresh: (label) => '0x' + cast(['keccak', `pharos-agent-kit:${wallet.address}:${startedAt}:${label}`]).trim().slice(-40),
  };
}
