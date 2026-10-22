// Real-EVM execution without real funds: a local anvil fork of Pharos mainnet.
// Contracts, balances and logic are the live ones; transactions only change the fork.
// Accounts are anvil's unlocked dev accounts and an impersonated holder, so no private
// key is read, stored or needed.

import { spawn } from 'node:child_process';
import { PHAROS_RPC } from './rpc.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KNOWN_ERRORS = { '0xd92e233d': 'ZeroAddress', '0xe450d38c': 'ERC20InsufficientBalance', '0xec442f05': 'ERC20InvalidReceiver' };

export async function startFork({ port = 8590, forkUrl = PHAROS_RPC } = {}) {
  const proc = spawn('anvil', ['--fork-url', forkUrl, '--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return { url, stop: () => proc.kill() };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  proc.kill();
  throw new Error('anvil did not start (is Foundry installed, and is the fork RPC reachable?)');
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
    async send(tx) {
      return rpc('eth_sendTransaction', [{ from: tx.from, to: tx.to, data: tx.data, ...(tx.value ? { value: '0x' + BigInt(tx.value).toString(16) } : {}) }]);
    },
    async receipt(hash) {
      for (let i = 0; i < 40; i++) {
        const r = await rpc('eth_getTransactionReceipt', [hash]);
        if (r) {
          const base = { hash, blockNumber: Number(BigInt(r.blockNumber)), gasUsed: Number(BigInt(r.gasUsed)) };
          if (r.status === '0x1') return { ...base, status: 'success' };
          // Replay the failed transaction one block earlier to learn why it reverted.
          const tx = await rpc('eth_getTransactionByHash', [hash]);
          const reason = await rpc('eth_call', [{ from: tx.from, to: tx.to, data: tx.input }, '0x' + (base.blockNumber - 1).toString(16)]).then(() => undefined, (e) => e.reason);
          return { ...base, status: 'reverted', reason };
        }
        await sleep(100);
      }
      throw new Error('timed out waiting for the receipt');
    },
  };
}
