// The concrete saga used by the Saga Executor task: put USDC to work in a real Pharos vault.
//   1. approve   USDC -> vault
//   2. deposit   USDC -> vault shares            (needs step 1)
//   3. transfer  shares -> a treasury address    (needs step 2)
// Each step is verified from chain state before the next starts, and each has a
// compensation (revoke approval, redeem shares, bring the shares back).
// The target vault is RockawayX USDC (a real Morpho Vault V2 on Pharos mainnet).

import { SELECTORS, decodeUint, encodeAddress } from './abi.js';
import { USDC, VAULTS } from './protocols.js';

export const VAULT = VAULTS.find((v) => v.name.startsWith('RockawayX')).address;
export const ZERO = '0x0000000000000000000000000000000000000000';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
// Selectors are written out so no hashing library is needed (checked with `cast sig`).
export const SEL = {
  approve: '0x095ea7b3',
  transfer: '0xa9059cbb',
  allowance: '0xdd62ed3e',
  deposit: '0x6e553f65', // deposit(uint256,address)
  redeem: '0xba087652', // redeem(uint256,address,address)
};

const call = (to, data) => ({ to, data });

// io = { send, receipt, call(to,data) -> hex }. `ctx` carries values learned along the way.
// `usdc` / `vault` default to the mainnet contracts, so the fork runner and the
// web demo are unchanged. The Atlantic runner (scripts/testnet-vault-saga.mjs)
// passes the TestUSDC and TestVault it just deployed on Atlantic instead: the
// steps, their order, their state checks and their compensations are identical,
// only the addresses change.
export function vaultSaga({ io, account, treasury, amount, failStep3 = false, usdc = USDC, vault = VAULT }) {
  const ctx = { shares: 0n, usdcBefore: null };
  const usdcOf = async (who) => decodeUint(await io.call(usdc, SELECTORS.balanceOf + encodeAddress(who)));
  const sharesOf = async (who) => decodeUint(await io.call(vault, SELECTORS.balanceOf + encodeAddress(who)));
  const allowance = async () => decodeUint(await io.call(usdc, SEL.allowance + encodeAddress(account) + encodeAddress(vault)));

  return {
    ctx,
    steps: [
      {
        id: 'approve',
        title: `Approve the vault to take ${Number(amount) / 1e6} USDC`,
        tx: () => ({ from: account, ...call(usdc, SEL.approve + encodeAddress(vault) + word(amount)) }),
        async verify() {
          ctx.usdcBefore ??= await usdcOf(account);
          const a = await allowance();
          return a === amount ? true : `allowance is ${a}, expected ${amount}`;
        },
        compensate: {
          title: 'Revoke the approval (set it to 0)',
          tx: () => ({ from: account, ...call(usdc, SEL.approve + encodeAddress(vault) + word(0)) }),
          async verify() {
            const a = await allowance();
            return a === 0n ? true : `allowance still ${a}`;
          },
        },
      },
      {
        id: 'deposit',
        title: `Deposit ${Number(amount) / 1e6} USDC into the vault for shares`,
        tx: () => ({ from: account, ...call(vault, SEL.deposit + word(amount) + encodeAddress(account)) }),
        async verify() {
          ctx.shares = await sharesOf(account);
          return ctx.shares > 0n ? true : 'no shares were issued';
        },
        compensate: {
          title: 'Redeem the shares back into USDC',
          tx: () => ({ from: account, ...call(vault, SEL.redeem + word(ctx.shares) + encodeAddress(account) + encodeAddress(account)) }),
          async verify() {
            const left = await sharesOf(account);
            return left === 0n ? true : `${left} shares still held`;
          },
        },
      },
      {
        id: 'transfer',
        title: failStep3 ? 'Send the shares to the zero address (will fail on purpose)' : 'Send the shares to the treasury',
        tx: () => ({ from: account, ...call(vault, SEL.transfer + encodeAddress(failStep3 ? ZERO : treasury) + word(ctx.shares)) }),
        async verify() {
          const got = await sharesOf(treasury);
          return got >= ctx.shares ? true : `treasury holds ${got}, expected ${ctx.shares}`;
        },
        compensate: {
          title: 'Bring the shares back from the treasury',
          tx: () => ({ from: treasury, ...call(vault, SEL.transfer + encodeAddress(account) + word(ctx.shares)) }),
        },
      },
    ],
    // What must be true at the end. After a rollback nothing may be left behind; after a
    // completed run the USDC is gone from the account and the shares sit with the treasury.
    async finalCheck(status) {
      const [usdc, shares, allow, tShares] = await Promise.all([usdcOf(account), sharesOf(account), allowance(), sharesOf(treasury)]);
      const spent = ctx.usdcBefore == null ? 0n : ctx.usdcBefore - usdc; // positive = USDC left the account
      const near = (a, b) => a - b >= -2n && a - b <= 2n; // the vault rounds by a unit or two
      const clean = status === 'completed' ? near(spent, amount) && shares === 0n && allow === 0n && tShares > 0n : near(spent, 0n) && shares === 0n && allow === 0n && tShares === 0n;
      return { expected: status === 'completed' ? 'USDC moved into vault shares held by the treasury' : 'everything undone, nothing left behind', usdc, usdcBefore: ctx.usdcBefore, spent, accountShares: shares, allowance: allow, treasuryShares: tShares, clean };
    },
  };
}
