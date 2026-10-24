#!/usr/bin/env node
// Measures what moving USDC between the Pharos vaults REALLY costs and whether the vaults let a wallet do it, by doing it on a throwaway local fork of
// Pharos mainnet (anvil), impersonating a real wallet that holds USDC and vault shares. Nothing touches mainnet and no key is involved.
//   node scripts/yield-fork-run.mjs          writes reports/yield-fork-run.json
// For each vault: approve + deposit (does it let this wallet in? what does it cost? do the shares match previewDeposit?) and redeem (does it let the wallet
// out? what does it cost? does the payout match previewRedeem?). The yield optimizer's gas figures come from this file, not from guesses.
import { writeFileSync } from 'node:fs';
import { startFork, forkIO } from '../lib/saga-fork.js';
import { SEL, VAULT_LIST, enc } from '../lib/defi.js';
import { USDC } from '../lib/protocols.js';
import { selectorOf } from '../lib/keccak.js';

const WALLET = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f'; // a real smart-contract wallet holding USDC, R25 weekly and quarterly shares
const AMOUNT = 1_000n * 10n ** 6n; // 1,000 USDC per measurement
const APPROVE = selectorOf('approve(address,uint256)');
const DEPOSIT = selectorOf('deposit(uint256,address)');
const REDEEM = selectorOf('redeem(uint256,address,address)');
const num = (hex) => BigInt(hex);
const log = (...a) => console.error(...a);

const fork = await startFork({ port: 8622 });
try {
  const io = forkIO(fork.url);
  await io.impersonate(WALLET);
  await io.setBalance(WALLET, 10n ** 18n); // gas money on the fork
  const block = Number(num(await io.rpc('eth_blockNumber')));
  const balance = async (token) => num(await io.call(token, SEL.balanceOf + enc.address(WALLET)));
  const out = { recordedAt: new Date().toISOString(), network: 'local anvil fork of Pharos mainnet (chain 1672)', forkBlock: block, wallet: WALLET, amountUsdc: AMOUNT.toString(), vaults: {} };

  for (const v of VAULT_LIST) {
    const rec = { id: v.id, name: v.name, address: v.address, deposit: null, redeem: null };
    log(`\n${v.name}`);
    // ---- deposit ----
    const predictedShares = await io.call(v.address, SEL.previewDeposit + enc.uint(AMOUNT)).then(num, () => null);
    const usdcBefore = await balance(USDC);
    const sharesBefore = await balance(v.address);
    const approve = await io.receipt(await io.send({ from: WALLET, to: USDC, data: APPROVE + enc.address(v.address) + enc.uint(AMOUNT), gas: 200_000 }));
    const dep = await io.receipt(await io.send({ from: WALLET, to: v.address, data: DEPOSIT + enc.uint(AMOUNT) + enc.address(WALLET) }));
    const sharesAfter = await balance(v.address);
    rec.deposit = dep.status === 'success'
      ? { status: 'success', gasUsed: dep.gasUsed, approveGasUsed: approve.gasUsed, sharesReceived: (sharesAfter - sharesBefore).toString(), predictedShares: predictedShares?.toString() ?? null, usdcSpent: (usdcBefore - (await balance(USDC))).toString() }
      : { status: 'reverted', reason: dep.reason ?? 'reverted with no reason', approveGasUsed: approve.gasUsed };
    log(`  deposit 1,000 USDC: ${rec.deposit.status}${rec.deposit.status === 'success' ? `, gas ${dep.gasUsed.toLocaleString('en-US')}, shares ${rec.deposit.sharesReceived} (preview ${rec.deposit.predictedShares})` : ` (${rec.deposit.reason})`}`);

    // ---- redeem a thousand dollars' worth ----
    const shares = (await io.call(v.address, SEL.convertToAssets + enc.uint(10n ** BigInt(v.shareDecimals))).then(num, () => null));
    const held = await balance(v.address);
    const wanted = shares ? (AMOUNT * 10n ** BigInt(v.shareDecimals)) / shares : null;
    const sharesFor1000 = wanted && held > 0n ? (wanted < held ? wanted : held) : null; // never more than the wallet holds (a vault that just took the deposit holds a hair less than $1,000 of shares)
    if (sharesFor1000) {
      const predicted = await io.call(v.address, SEL.previewRedeem + enc.uint(sharesFor1000)).then(num, () => null);
      const usdcBeforeR = await balance(USDC);
      const red = await io.receipt(await io.send({ from: WALLET, to: v.address, data: REDEEM + enc.uint(sharesFor1000) + enc.address(WALLET) + enc.address(WALLET) }));
      rec.redeem = red.status === 'success'
        ? { status: 'success', gasUsed: red.gasUsed, shares: sharesFor1000.toString(), usdcReceived: ((await balance(USDC)) - usdcBeforeR).toString(), predictedUsdc: predicted?.toString() ?? null }
        : { status: 'reverted', reason: red.reason ?? 'reverted with no reason', shares: sharesFor1000.toString(), previewable: predicted != null };
      log(`  redeem ~1,000 USDC of shares: ${rec.redeem.status}${rec.redeem.status === 'success' ? `, gas ${red.gasUsed.toLocaleString('en-US')}, received ${rec.redeem.usdcReceived} (preview ${rec.redeem.predictedUsdc})` : ` (${rec.redeem.reason})`}`);
    } else {
      rec.redeem = { status: 'not-tried', reason: shares ? 'the wallet holds no shares of this vault (the deposit above did not put any in)' : 'the vault would not price a share' };
      log(`  redeem: ${rec.redeem.reason}`);
    }
    out.vaults[v.id] = rec;
  }
  writeFileSync(new URL('../reports/yield-fork-run.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote reports/yield-fork-run.json at fork block ${block.toLocaleString('en-US')}`);
} finally {
  fork.stop();
}
