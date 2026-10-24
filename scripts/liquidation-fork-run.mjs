#!/usr/bin/env node
// Checks the Liquidation Watchdog's health factor against the REAL Morpho Blue contract on Pharos mainnet, on a throwaway fork (anvil, fake funds).
//
// The watchdog says a position is liquidatable when its health factor is below 1. Morpho decides the same thing in its own code, when someone calls
// `liquidate`. So: take a real borrower, move the collateral price (on the fork only, by swapping the oracle's code for a one-line contract that returns
// a chosen price) to a point just above and just below the health factor of 1 that the watchdog computes, and really call `liquidate` on the deployed
// Morpho. If the watchdog is right, Morpho refuses ("position is healthy") on the healthy side and executes on the other. It also checks the
// liquidation bonus the watchdog quotes against what Morpho really paid out.
//
//   node scripts/liquidation-fork-run.mjs        writes reports/liquidation-fork-run.json   (needs Foundry: anvil 1.4.0)

import { writeFileSync } from 'node:fs';
import { forkIO, startFork } from '../lib/saga-fork.js';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { MORPHO, USDC } from '../lib/protocols.js';
import { USDC_SLOTS, usdcStateDiff } from '../lib/defi.js';
import { keccak256, selectorOf } from '../lib/keccak.js';
import { ORACLE_PRICE_SCALE, WAD, assess, computeHealth, liquidationIncentiveFactor, readPosition } from '../lib/liquidation.js';

const MARKET = MORPHO.markets['syzUSD/USDC'];
const BORROWER = MORPHO.sampleBorrower;
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const LIQUIDATOR = '0x000000000000000000000000000000000000c0de';
const LIQUIDATE = selectorOf('liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)');
const LIQUIDATE_EVENT = '0x' + keccak256(Buffer.from('Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)'));

// The chain as Chain MCP answers it, served by the fork, so the watchdog's own reader runs unchanged against it.
const forkChain = (rpc) => ({
  async callTool(name, args) {
    if (name === 'get_block_number') return { blockNumber: String(Number(BigInt(await rpc('eth_blockNumber')))) };
    if (name === 'get_block') { const b = await rpc('eth_getBlockByNumber', ['0x' + args.block.toString(16), false]); return { number: b.number, timestamp: b.timestamp, hash: b.hash }; }
    if (name === 'eth_call') return { result: await rpc('eth_call', [args.transaction, '0x' + args.block.toString(16)]) };
    throw new Error(`the fork adapter does not serve ${name}`);
  },
});

const fork = await startFork({ port: 8620 });
try {
  const io = forkIO(fork.url);
  const rpc = io.rpc;
  await rpc('anvil_mine', ['0x8']);
  const chain = forkChain(rpc);
  const read = await readPosition({ chain, rpc: (m, p) => rpc(m, p), marketId: MARKET, borrower: BORROWER });
  const base = assess(read);
  console.error(`fork at block ${read.block.number}: health factor ${base.health.hf.toFixed(6)} (${base.level}), debt ${base.health.borrowed}`);

  // a liquidator with USDC and an allowance for Morpho, set directly in the fork's storage (the slots were found and checked in the Yield Optimizer)
  await io.setBalance(LIQUIDATOR, 10n ** 19n);
  await io.impersonate(LIQUIDATOR);
  for (const [slot, value] of Object.entries(usdcStateDiff({ owner: LIQUIDATOR, spender: MORPHO.address, allowance: 2n ** 255n, balance: 50_000_000_000_000n })[USDC].stateDiff)) await rpc('anvil_setStorageAt', [USDC, slot, value]);
  const usdcOf = async (who) => BigInt(await io.call(USDC, '0x70a08231' + addr(who)));
  const have = await usdcOf(LIQUIDATOR);
  if (have !== 50_000_000_000_000n) throw new Error(`the liquidator's USDC was not set (slot ${USDC_SLOTS.balance}): ${have}`);

  const p = read.params;
  const paramsTuple = [p.loanToken, p.collateralToken, p.oracle, p.irm].map(addr).join('') + word(p.lltv);
  const oracleCode = (price) => '0x7f' + word(price) + '600052' + '60206000f3'; // PUSH32 price; PUSH1 0; MSTORE; PUSH1 32; PUSH1 0; RETURN
  const liquidateData = (seized) => LIQUIDATE + paramsTuple + addr(BORROWER) + word(seized) + word(0) + word(0x120) + word(0);

  const raw0 = { lltv: p.lltv, collateral: read.position.collateral, borrowShares: read.position.borrowShares, price: read.price, market: read.market, borrowRate: read.borrowRate };
  const cases = [];
  // price at which the position's health factor would be `hf`, for the debt at time T
  const priceFor = (hf, T) => {
    const h = computeHealth(raw0, T);
    return (BigInt(Math.round(hf * 1e9)) * h.borrowed * ORACLE_PRICE_SCALE * WAD) / (10n ** 9n * raw0.collateral * p.lltv);
  };
  const SEIZE = 100n * 10n ** 18n; // 100 syzUSD: large enough to read the bonus off the payout

  for (const [label, hf] of [['well above 1 (as it really is now)', null], ['just above 1 (+0.0002%)', 1.000002], ['just below 1 (−0.0002%)', 0.999998], ['clearly below 1 (0.97)', 0.97]]) {
    const snapshot = await rpc('evm_snapshot');
    const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
    const T = Number(BigInt(latest.timestamp)) + 5;
    const price = hf == null ? read.price : priceFor(hf, T);
    if (hf != null) await rpc('anvil_setCode', [p.oracle, oracleCode(price)]);
    // what the watchdog says for that price, at the time the transaction will be mined
    const predicted = computeHealth({ ...raw0, price }, T);
    await rpc('evm_setNextBlockTimestamp', ['0x' + T.toString(16)]);
    const hash = await io.send({ from: LIQUIDATOR, to: MORPHO.address, data: liquidateData(SEIZE) });
    const receipt = await io.receipt(hash);
    const row = { label, collateralPrice: price.toString(), predictedHealthFactor: predicted.hf, predictedHealthy: predicted.healthy, morphoExecutedTheLiquidation: receipt.status === 'success', morphoSaid: receipt.status === 'success' ? 'liquidation executed' : receipt.reason ?? 'reverted', blockTimestamp: T };
    if (receipt.status === 'success') {
      const raw = await rpc('eth_getTransactionReceipt', [hash]);
      const log = raw.logs.find((l) => l.topics[0] === LIQUIDATE_EVENT);
      const [repaidAssets, repaidShares, seizedAssets, badDebtAssets, badDebtShares] = (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w));
      const seizedValue = (seizedAssets * price) / ORACLE_PRICE_SCALE;
      const bonus = Number((seizedValue * WAD) / repaidAssets) / 1e18;
      Object.assign(row, { repaidAssets: repaidAssets.toString(), seizedAssets: seizedAssets.toString(), badDebtAssets: badDebtAssets.toString(), bonusPaidByMorpho: bonus, bonusQuotedByWatchdog: Number(liquidationIncentiveFactor(p.lltv)) / 1e18 });
    }
    row.agrees = row.predictedHealthy === !row.morphoExecutedTheLiquidation;
    console.error(`  ${label}: watchdog ${predicted.healthy ? 'healthy' : 'LIQUIDATABLE'} (HF ${predicted.hf.toFixed(6)}) · Morpho: ${row.morphoSaid} → ${row.agrees ? 'agree' : 'DISAGREE'}`);
    cases.push(row);
    await rpc('evm_revert', [snapshot]);
  }

  const incentive = cases.find((c) => c.bonusPaidByMorpho != null);
  const report = {
    recordedAt: new Date().toISOString(),
    network: 'local anvil fork of Pharos mainnet (chain 1672): the live Morpho Blue, the live market, a real borrower; only the collateral price is moved, by replacing the oracle on the fork',
    forkBlock: read.block.number,
    market: { id: MARKET, pair: `${read.collateral.symbol}/${read.loan.symbol}`, lltv: p.lltv.toString(), oracle: p.oracle },
    borrower: BORROWER,
    healthFactorAtFork: base.health.hf,
    cases,
    summary: { cases: cases.length, agree: cases.filter((c) => c.agrees).length, bonusMatches: incentive ? Math.abs(incentive.bonusPaidByMorpho - incentive.bonusQuotedByWatchdog) < 1e-6 : null },
  };
  writeFileSync(new URL('../reports/liquidation-fork-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/liquidation-fork-run.json: Morpho agreed with the watchdog in ${report.summary.agree} of ${report.summary.cases} cases; liquidation bonus ${incentive ? `${incentive.bonusPaidByMorpho.toFixed(6)} paid vs ${incentive.bonusQuotedByWatchdog.toFixed(6)} quoted` : 'not measured'}`);
  process.exitCode = report.summary.agree === report.summary.cases ? 0 : 1;
} finally {
  fork.stop?.();
}
