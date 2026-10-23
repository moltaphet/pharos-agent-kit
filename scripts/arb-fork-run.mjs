#!/usr/bin/env node
// Records the Arbitrage Scanner's act path on a local anvil fork of Pharos mainnet.
// Usage: node scripts/arb-fork-run.mjs [--scenario profitable|marginal] [--out reports/arbitrage-runs.json] [--stream]
//   no --scenario: both scenarios, written to the report. --stream prints one JSON object per line as the run happens
//   ({type:'phase'|'event'|'result'|'error'}), which is how the website's live demo reads it from a Vercel Sandbox.
// Needs Foundry (anvil, forge, cast). No private key is used: anvil's dev accounts are unlocked.

import { writeFileSync } from 'node:fs';
import { startFork, forkIO } from '../lib/saga-fork.js';
import { scanPair } from '../lib/tasks/arbitrage-scanner.js';
import { ARB_PAIRS, WPROS } from '../lib/protocols.js';
import { PHAROS_RPC } from '../lib/rpc.js';
import { SELECTORS, addr, balanceOf, bool, calldata, forkChain, int, labBytecode, priceFromSqrtX96, setTokenBalance, uint, v2InputToReach } from '../lib/arb-fork.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const out = arg('out', 'reports/arbitrage-runs.json');
const stream = process.argv.includes('--stream');
const only = arg('scenario');
if (only && !['profitable', 'marginal'].includes(only)) { console.error('error: --scenario must be profitable or marginal'); process.exit(2); }
const basePort = Number(arg('port', 8601));
const emit = (o) => stream && console.log(JSON.stringify(o));
const PAIR = 'WPROS/DLP';
const pair = ARB_PAIRS[PAIR];
const [WP, DLP] = pair.tokens.map((t) => t.address);
const E18 = 10n ** 18n;
const words = (hex) => hex.slice(2).match(/.{64}/g) ?? [];
const human = (wei) => Number(wei) / 1e18;
const log = (...a) => !stream && console.error(...a);
const t0 = Date.now();

const trimScan = (s) => ({
  decision: s.decision, block: s.block, route: s.route, size: s.size, grossSpreadPct: s.grossSpreadPct,
  gross: s.gross, netBeforeGas: s.netBeforeGas, net: s.net, costs: s.costs, reasons: s.reasons,
  prices: { v2: s.sources.v2.price, v3: s.sources.v3.price }, depth: s.depth, inRange: s.curve?.[0]?.inRange,
});

async function scenario({ id, title, port, skewWpros, note }) {
  log(`\n== ${title}`);
  emit({ type: 'phase', message: 'Starting a local fork of Pharos mainnet (anvil)…' });
  const fork = await startFork({ port, forkUrl: PHAROS_RPC });
  try {
    const io = forkIO(fork.url);
    const chain = forkChain(io);
    const [deployer] = await io.accounts();
    const forkBlock = Number(BigInt(await io.rpc('eth_blockNumber')));
    emit({ type: 'phase', message: `Fork ready at mainnet block ${forkBlock.toLocaleString('en-US')}. Running the scenario: every swap below is a real transaction on the real FaroSwap contracts.`, forkBlock });
    const steps = [];
    const step = (what, detail) => { steps.push({ what, ...detail }); log(' -', what); emit({ type: 'event', event: { t: Date.now() - t0, event: 'step', what, ...detail } }); };
    const send = async (to, data, gas = 2_000_000) => {
      const hash = await io.send({ from: deployer, to, data, gas });
      const r = await io.receipt(hash);
      if (r.status !== 'success') throw new Error(`transaction reverted: ${r.reason ?? 'unknown'} (${data.slice(0, 10)})`);
      return r;
    };
    // The scanner pins its reads to two blocks behind the head, like every task, and a fork mines one block per transaction:
    // without these blocks it would read the state from before our own swaps.
    const settle = () => io.rpc('anvil_mine', ['0x3']);
    const readPools = async () => {
      const [r0, r1] = words(await io.call(pair.v2, '0x0902f1ac')).map((w) => BigInt('0x' + w));
      const s0 = words(await io.call(pair.v3, '0x3850c7bd'));
      const tick = Number(BigInt.asIntN(24, BigInt('0x' + s0[1])));
      return { r0, r1, sqrtX96: BigInt('0x' + s0[0]), tick, L: BigInt(await io.call(pair.v3, '0x1a686502')) };
    };

    // 0. Deploy and fund the helper (anvil dev account; dust balances set directly on the fork).
    const hash = await io.send({ from: deployer, data: '0x' + labBytecode().replace(/^0x/, ''), gas: 4_000_000 });
    const deployed = await io.receipt(hash);
    if (deployed.status !== 'success') throw new Error('the ArbLab deployment reverted');
    const lab = (await io.rpc('eth_getTransactionReceipt', [hash])).contractAddress;
    await io.setBalance(lab, 10n ** 24n);
    await send(lab, calldata('wrap', addr(WPROS), uint(300_000n * E18)));
    const slotHow = await setTokenBalance(io, DLP, lab, 300_000n * E18);
    step('Deployed the ArbLab helper and funded it', { contract: lab, detail: `300,000 WPROS (wrapped from fork PROS) and 300,000 DLP (balance slot found: ${slotHow})` });

    // 1. The live state, for the record.
    const live = await readPools();
    step('Live pools at the fork block', { detail: `V2 holds ${human(live.r0)} WPROS and ${human(live.r1)} DLP; V3 liquidity ${live.L}. That is less than the gas for a single swap, so no live trade can profit.`, v2Price: Number(live.r1) / Number(live.r0), v3Price: priceFromSqrtX96(live.sqrtX96) });

    // 2. Re-price the dust V2 pair to the V3 price with a real swap.
    const p3 = priceFromSqrtX96(live.sqrtX96); // DLP per WPROS
    const p2 = Number(live.r1) / Number(live.r0);
    const sellWpros = p2 > p3;
    const amountIn = sellWpros ? v2InputToReach(live.r0, live.r1, p3) : v2InputToReach(live.r1, live.r0, 1 / p3);
    const r = await send(lab, calldata('v2Swap', addr(pair.v2), addr(sellWpros ? WP : DLP), uint(amountIn)));
    const afterReprice = await readPools();
    step('Re-priced the V2 pair to the V3 price (real swap)', { gasUsed: r.gasUsed, detail: `swapped ${human(amountIn)} ${sellWpros ? 'WPROS' : 'DLP'} into V2; V2 price now ${Number(afterReprice.r1) / Number(afterReprice.r0)} DLP per WPROS, V3 ${p3}` });

    // 3. Deposit our own liquidity into both venues with real mint calls.
    const a0 = 5000n * E18;
    const a1 = (a0 * afterReprice.r1) / afterReprice.r0 + 1n;
    await send(lab, calldata('v2AddLiquidity', addr(pair.v2), uint(a0), uint(a1)));
    const base = Math.floor(live.tick / 60) * 60;
    await send(lab, calldata('v3AddLiquidity', addr(pair.v3), int(base - 600), int(base + 660), uint(10n ** 23n)));
    const deep = await readPools();
    step('Deposited liquidity into both venues (real mint calls)', { detail: `V2 now holds ${human(deep.r0).toFixed(1)} WPROS and ${human(deep.r1).toFixed(1)} DLP; V3 liquidity ${deep.L} over ticks ${base - 600}..${base + 660}` });

    const cfg = { size: 200, minNet: 0.5 };
    // 4. Baseline: both venues agree, so the scanner must not act.
    await settle();
    const baseline = await scanPair({ chain }, PAIR, cfg);
    step('Scan with both venues at the same price', { decision: baseline.decision, detail: `spread ${baseline.grossSpreadPct.toFixed(4)}% (V2 ${baseline.sources.v2.price.toFixed(6)}, V3 ${baseline.sources.v3.price.toFixed(6)} WPROS per DLP): ${baseline.decision}` });

    // 5. Skew the V2 price with a real swap, then let the scanner decide.
    const sk = await send(lab, calldata('v2Swap', addr(pair.v2), addr(WP), uint(BigInt(Math.round(skewWpros * 1e6)) * 10n ** 12n)));
    await settle();
    const scan = await scanPair({ chain }, PAIR, cfg);
    step(`Moved V2's price with a real ${skewWpros} WPROS swap, then scanned`, { gasUsed: sk.gasUsed, decision: scan.decision, detail: `spread ${scan.grossSpreadPct.toFixed(3)}% → ${scan.decision}${scan.decision === 'skip' ? ` (${scan.reasons[0]})` : ` at size ${scan.size.toFixed(2)} WPROS, predicted net ${scan.net.toFixed(4)} WPROS`}` });

    // 6. Execute a trade for real. If the scanner acted, its own best trade (the helper reverts unless it
    //    profits). If it skipped, a fixed 5 WPROS trade WITHOUT the profit requirement, so the real
    //    outcome of the trade it refused can be measured. Either way the model's prediction is
    //    recorded next to what the EVM did.
    const acted = scan.decision !== 'skip';
    const forcedScan = acted ? null : await scanPair({ chain }, PAIR, { ...cfg, size: 5 });
    const tradeSize = acted ? scan.size : 5;
    const predicted = acted ? scan.netBeforeGas : forcedScan.curve.at(-1).netBeforeGas; // the ladder's last rung is the full `size`
    const buyOnV3 = scan.route.buyOn.includes('V3');
    const quoteIn = BigInt(Math.round(tradeSize * 1e6)) * 10n ** 12n;
    const before = await balanceOf(io, WP, lab);
    const hashArb = await io.send({ from: deployer, to: lab, data: calldata('arb', addr(pair.v2), addr(pair.v3), addr(WP), uint(quoteIn), bool(buyOnV3), bool(acted)), gas: 1_500_000 });
    const rec = await io.receipt(hashArb);
    const after = await balanceOf(io, WP, lab);
    const gasPriceWei = BigInt(await io.rpc('eth_gasPrice'));
    const profit = Number(after - before) / 1e18;
    const gasCost = Number(BigInt(rec.gasUsed) * gasPriceWei) / 1e18;
    const execution = {
      forced: !acted, route: scan.route, quoteIn: human(quoteIn), status: rec.status, revertReason: rec.reason ?? null, gasUsed: rec.gasUsed,
      predictedGrossProfit: predicted, actualGrossProfit: rec.status === 'success' ? profit : null,
      predictedGasUnits: 110_000 + 160_000, gasPriceGwei: Number(gasPriceWei) / 1e9, gasCostWpros: gasCost,
      actualNet: rec.status === 'success' ? profit - gasCost : -gasCost,
    };
    execution.predictionErrorPct = rec.status === 'success' && predicted ? (Math.abs(profit - predicted) / Math.abs(predicted)) * 100 : null;
    const gasNote = `gas ${rec.gasUsed.toLocaleString('en-US')} units (the scanner assumes ${execution.predictedGasUnits.toLocaleString('en-US')}) = ${gasCost.toFixed(6)} WPROS at ${execution.gasPriceGwei.toFixed(2)} gwei`;
    step(acted ? 'Executed both legs on the fork (real swaps)' : 'Forced a 5 WPROS trade anyway, to check the skip', {
      gasUsed: rec.gasUsed,
      detail: rec.status === 'success'
        ? `${profit >= 0 ? 'profit' : 'LOSS'} ${profit.toFixed(6)} WPROS before gas (the scanner's model said ${predicted.toFixed(6)}); ${gasNote}; net ${execution.actualNet.toFixed(6)} WPROS${acted ? '' : ', so skipping was right'}`
        : `the helper reverted (${rec.reason ?? 'unknown'}); ${gasNote}`,
    });

    // 7. Scan again: if the trade closed the gap the scanner must now skip.
    await settle();
    const rescan = await scanPair({ chain }, PAIR, cfg);
    step('Scanned again after the trade', { decision: rescan.decision, detail: `spread ${rescan.grossSpreadPct.toFixed(4)}% → ${rescan.decision}${rescan.reasons[0] ? ` (${rescan.reasons[0]})` : ''}` });

    return { id, title, note, forkBlock, helper: lab, steps, baseline: trimScan(baseline), scan: trimScan(scan), execution, rescan: trimScan(rescan) };
  } finally {
    fork.stop();
  }
}

const result = {
  recordedAt: new Date().toISOString(),
  network: { name: 'Pharos mainnet fork (local anvil)', chainId: 1672, forkRpc: PHAROS_RPC },
  pair: PAIR,
  contracts: { v2: pair.v2, v3: pair.v3, tokens: pair.tokens.map((t) => ({ symbol: t.symbol, address: t.address })) },
  honesty: [
    'The pools are the live FaroSwap V2 pair and V3 pool, and the swaps run on their real code in a real EVM.',
    'Their real liquidity is dust (under 0.0001 WPROS in V2), so we re-priced the V2 pair with a real swap and deposited our own liquidity into both venues with real mint calls.',
    'The price skew is a real swap we made ourselves. It is not a market opportunity, and nothing was sent to any real network.',
  ],
  scenarios: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFS = {
  profitable: { id: 'profitable', title: 'A real 6% price gap: the scanner acts, both legs execute', port: basePort, skewWpros: 150, note: 'We sold 150 WPROS into V2 so DLP is dearer there than on V3.' },
  marginal: { id: 'marginal', title: 'A 0.3% price gap: the scanner skips, and forcing the trade loses', port: basePort + 1, skewWpros: 8, note: 'We sold only 8 WPROS into V2. The gap is smaller than the 0.6% of swap fees.' },
};
try {
  const order = only ? [only] : ['profitable', 'marginal'];
  for (const [i, id] of order.entries()) {
    if (i > 0) await sleep(5000); // let the public RPC recover before forking it again
    result.scenarios.push(await scenario(DEFS[id]));
  }
  if (!only) writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  log(`\nwrote ${out}`);
  emit({ type: 'result', record: result });
  if (!stream) for (const s of result.scenarios) console.log(`${s.id}: scan=${s.scan.decision} executed=${s.execution.status} predicted=${s.execution.predictedGrossProfit?.toFixed(6)} actual=${s.execution.actualGrossProfit?.toFixed(6)} err=${s.execution.predictionErrorPct?.toFixed(3)}% gas=${s.execution.gasUsed} rescan=${s.rescan.decision}`);
} catch (err) {
  emit({ type: 'error', message: err.message });
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
