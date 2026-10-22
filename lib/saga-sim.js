// An in-memory model of the three contracts the vault saga touches (USDC, the vault's
// share token, allowances), speaking the same `io` interface as the fork executor. It is a
// SIMULATION of their semantics for the interactive demo, not the EVM; the real-EVM
// evidence is the recorded anvil-fork run. Same engine, same steps.

import { SEL, VAULT, ZERO } from './saga-scenario.js';
import { USDC } from './protocols.js';

const addr = (hexWord) => '0x' + hexWord.slice(24).toLowerCase();
const uint = (hexWord) => BigInt('0x' + hexWord);
const words = (data) => data.slice(10).match(/.{64}/g) ?? [];
const enc = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const SHARES_PER_USDC_UNIT = 10n ** 12n; // 6-decimal assets -> 18-decimal shares

export function simIO({ account, treasury, usdc = 1_000_000_000n }) {
  const bal = new Map([[`${USDC}:${account}`, usdc]]);
  const shares = new Map();
  const allow = new Map();
  const receipts = new Map();
  let block = 20_900_000;
  let nonce = 0;
  const get = (m, k) => m.get(k) ?? 0n;

  function execute(tx) {
    const from = tx.from.toLowerCase();
    const w = words(tx.data);
    const sel = tx.data.slice(0, 10);
    if (tx.to.toLowerCase() === USDC && sel === SEL.approve) {
      allow.set(`${from}:${addr(w[0])}`, uint(w[1]));
    } else if (tx.to.toLowerCase() === VAULT.toLowerCase() && sel === SEL.deposit) {
      const amount = uint(w[0]);
      const spender = VAULT.toLowerCase();
      if (get(allow, `${from}:${spender}`) < amount) throw Object.assign(new Error('execution reverted: ERC20InsufficientAllowance'), { reason: 'ERC20InsufficientAllowance' });
      if (get(bal, `${USDC}:${from}`) < amount) throw Object.assign(new Error('execution reverted: ERC20InsufficientBalance'), { reason: 'ERC20InsufficientBalance' });
      allow.set(`${from}:${spender}`, get(allow, `${from}:${spender}`) - amount);
      bal.set(`${USDC}:${from}`, get(bal, `${USDC}:${from}`) - amount);
      shares.set(addr(w[1]), get(shares, addr(w[1])) + amount * SHARES_PER_USDC_UNIT);
    } else if (tx.to.toLowerCase() === VAULT.toLowerCase() && sel === SEL.transfer) {
      const to = addr(w[0]);
      const amount = uint(w[1]);
      if (to === ZERO) throw Object.assign(new Error('execution reverted: ZeroAddress'), { reason: 'ZeroAddress' });
      if (get(shares, from) < amount) throw Object.assign(new Error('execution reverted: ERC20InsufficientBalance'), { reason: 'ERC20InsufficientBalance' });
      shares.set(from, get(shares, from) - amount);
      shares.set(to, get(shares, to) + amount);
    } else if (tx.to.toLowerCase() === VAULT.toLowerCase() && sel === SEL.redeem) {
      const amount = uint(w[0]);
      if (get(shares, from) < amount) throw Object.assign(new Error('execution reverted: ERC20InsufficientBalance'), { reason: 'ERC20InsufficientBalance' });
      shares.set(from, get(shares, from) - amount);
      bal.set(`${USDC}:${addr(w[1])}`, get(bal, `${USDC}:${addr(w[1])}`) + amount / SHARES_PER_USDC_UNIT);
    } else throw new Error('execution reverted: unknown call in the simulator');
  }

  return {
    async send(tx) {
      const hash = '0x' + (++nonce).toString(16).padStart(8, '0').repeat(8);
      try {
        execute(tx);
        receipts.set(hash, { hash, status: 'success', blockNumber: ++block, gasUsed: 90_000 });
      } catch (err) {
        receipts.set(hash, { hash, status: 'reverted', reason: err.reason ?? err.message, blockNumber: ++block, gasUsed: 30_000 });
      }
      return hash;
    },
    async receipt(hash) {
      return receipts.get(hash);
    },
    async call(to, data) {
      const w = words(data);
      const sel = data.slice(0, 10);
      if (sel === '0x70a08231') return enc(to.toLowerCase() === USDC ? get(bal, `${USDC}:${addr(w[0])}`) : get(shares, addr(w[0])));
      if (sel === SEL.allowance) return enc(get(allow, `${addr(w[0])}:${addr(w[1])}`));
      throw new Error('unsupported simulated call');
    },
  };
}
