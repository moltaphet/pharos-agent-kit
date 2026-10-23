// Real-EVM execution without real funds: a local anvil fork of Pharos mainnet.
// Contracts, balances and logic are the live ones; transactions only change the fork.
// Accounts are anvil's unlocked dev accounts and an impersonated holder, so no private
// key is read, stored or needed.

import { spawn } from 'node:child_process';
import { PHAROS_RPC } from './rpc.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KNOWN_ERRORS = { '0xd92e233d': 'ZeroAddress', '0xe450d38c': 'ERC20InsufficientBalance', '0xec442f05': 'ERC20InvalidReceiver' };

// Starts anvil forked from Pharos. The public RPC sometimes refuses the burst of requests a fresh fork makes ("cu limit exceeded"),
// and anvil then exits or never answers; so: throttle anvil's own request rate, notice at once if it exits (and keep what it said),
// and try again after a pause instead of failing the whole run on the first refusal.
export async function startFork({ port = 8590, forkUrl = PHAROS_RPC, forkBlock, attempts = 3, backoffMs = 3000, readyTries = 120, command = 'anvil' } = {}) {
  const url = `http://127.0.0.1:${port}`;
  let lastError = 'no output';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const args = ['--fork-url', forkUrl, '--port', String(port), '--compute-units-per-second', '100', '--retries', '8', '--timeout', '30000', ...(forkBlock ? ['--fork-block-number', String(forkBlock)] : [])];
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let said = '';
    let exited = null;
    proc.stderr.on('data', (d) => (said = (said + d).slice(-2000)));
    proc.on('exit', (code) => (exited = code ?? 'signal'));
    proc.on('error', (err) => { exited = 'error'; said += ` ${err.message}`; });
    for (let i = 0; i < readyTries && exited === null; i++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
        if (r.ok) return { url, stop: () => proc.kill(), attempt };
      } catch {
        // not up yet
      }
      await sleep(500);
    }
    proc.kill();
    lastError = said.trim().split('\n').filter(Boolean).slice(-2).join(' ').replace(/\s+/g, ' ') || (exited === null ? 'it never answered' : `it exited with ${exited}`);
    if (attempt < attempts) await sleep(backoffMs * attempt);
  }
  throw new Error(`anvil did not start after ${attempts} attempts (${lastError}). Is Foundry installed, and is the fork RPC reachable?`);
}

export function forkIO(url) {
  let id = 0;
  const rpc = async (method, params = []) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const body = await res.json();
    if (body.error) {
      const hex = body.error.message.match(/custom error (0x[0-9a-f]{8})/)?.[1];
      const reason = hex ? KNOWN_ERRORS[hex] ?? hex : body.error.message.replace(/^.*execution reverted:?\s*/, '');
      throw Object.assign(new Error(`execution reverted: ${reason}`), { reason });
    }
    return body.result;
  };
  return {
    rpc,
    accounts: () => rpc('eth_accounts'),
    setBalance: (who, wei) => rpc('anvil_setBalance', [who, '0x' + BigInt(wei).toString(16)]),
    impersonate: (who) => rpc('anvil_impersonateAccount', [who]),
    call: (to, data) => rpc('eth_call', [{ to, data }, 'latest']),
    // Like a wallet, estimate the gas and add 30% headroom. Without it a nested call (a vault withdrawing from
    // a lending market) can run out of gas on a limit that was estimated exactly, and revert with no reason.
    async send(tx) {
      let gas = tx.gas;
      if (!gas) {
        const value = tx.value ? (typeof tx.value === 'string' && tx.value.startsWith('0x') ? tx.value : '0x' + BigInt(tx.value).toString(16)) : undefined;
        try {
          gas = (BigInt(await rpc('eth_estimateGas', [{ from: tx.from, to: tx.to, data: tx.data, ...(value && { value }) }])) * 130n) / 100n;
        } catch {
          gas = 3_000_000n; // the call reverts: send it anyway so the revert is mined and reported, as a real failure would be
        }
      }
      return rpc('eth_sendTransaction', [{ from: tx.from, to: tx.to, data: tx.data, gas: '0x' + BigInt(gas).toString(16), ...(tx.value ? { value: typeof tx.value === 'string' && tx.value.startsWith('0x') ? tx.value : '0x' + BigInt(tx.value).toString(16) } : {}) }]);
    },
    async receipt(hash) {
      for (let i = 0; i < 1200; i++) {
        const r = await rpc('eth_getTransactionReceipt', [hash]);
        if (r) {
          const base = { hash, blockNumber: Number(BigInt(r.blockNumber)), gasUsed: Number(BigInt(r.gasUsed)) };
          if (r.status === '0x1') return { ...base, status: 'success' };
          // Replay the failed transaction one block earlier to learn why it reverted.
          const tx = await rpc('eth_getTransactionByHash', [hash]);
          let reason = await rpc('eth_call', [{ from: tx.from, to: tx.to, data: tx.input }, '0x' + (base.blockNumber - 1).toString(16)]).then(() => undefined, (e) => e.reason);
          // Reverted on-chain but a plain call succeeds, and it used its whole gas limit: it ran out of gas.
          const limit = Number(BigInt(tx.gas));
          if (!reason && base.gasUsed >= limit * 0.995) reason = `out of gas (used ${base.gasUsed.toLocaleString('en-US')} of a ${limit.toLocaleString('en-US')} limit)`;
          return { ...base, status: 'reverted', reason };
        }
        await sleep(100);
      }
      throw new Error('timed out waiting for the receipt');
    },
  };
}
