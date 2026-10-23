// Task: Arbitrage Scanner (Skill).
//
// One scan reads the price of the same token pair from TWO independent venues (FaroSwap V2
// reserves and FaroSwap V3 pool state) at one pinned block, simulates buying on the cheaper
// one and selling on the dearer one, subtracts swap fees, price impact and gas, and acts only
// if the net profit clears a configurable threshold. "Acting" is a simulated fill: nothing is
// ever sent. Every scan returns its full working so it can be logged.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pinnedBlock } from '../chain.js';
import { multicall } from '../multicall.js';
import { ARB_PAIRS, WPROS } from '../protocols.js';
import { formatUnits } from '../abi.js';
import { int24, sqrtPrice, tickSpacingFor, v2AmountOut, v2Spot, v3AmountOut, v3Spot } from '../amm.js';
import { UserError } from '../snapshot.js';
import { SCENARIOS as ARB_SCENARIOS, runStatus as arbRunStatus, startRun as startArbRun } from '../arb-sandbox.js';

const SEL = { reserves: '0x0902f1ac', slot0: '0x3850c7bd', liquidity: '0x1a686502' };
// `size` is the LARGEST trade considered (in quote tokens); the scanner searches below it for the best one.
export const DEFAULTS = { size: 1, minNet: 0.001, gasUnitsV2: 110_000, gasUnitsV3: 160_000 };

const num = (n, d = 6) => (Math.abs(n) >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : String(Number(n.toPrecision(4))));
const words = (hex) => hex.slice(2).match(/.{64}/g) ?? [];

// quote/base are token indexes. The venue answers in raw units; all maths is raw, display is human.
function venues(pair, st, quote) {
  const base = 1 - quote;
  const [r0, r1] = [st.v2.r0, st.v2.r1];
  const rQ = quote === 0 ? r0 : r1;
  const rB = quote === 0 ? r1 : r0;
  const feeV3 = pair.v3fee / 1_000_000;
  const v3 = { sqrtP: st.v3.sqrtP, L: st.v3.L, feeRate: feeV3, tick: st.v3.tick, tickSpacing: tickSpacingFor(pair.v3fee) };
  // v3 token0->token1 is "zeroForOne". Buying base with quote: if quote is token0 we sell token0.
  const v3Buy = (qIn) => v3AmountOut(v3, quote === 0, qIn);
  const v3Sell = (bIn) => v3AmountOut(v3, quote !== 0, bIn);
  const spotRaw01 = { v2: v2Spot(r0, r1), v3: v3Spot(st.v3.sqrtP) }; // token1 per token0
  const quotePerBase = (v) => (quote === 0 ? 1 / spotRaw01[v] : spotRaw01[v]);
  return {
    base,
    v2: { name: 'FaroSwap V2', feeRate: 0.003, quotePerBase: quotePerBase('v2'), buy: (qIn) => ({ out: Number(v2AmountOut(BigInt(Math.floor(qIn)), rQ, rB)), inRange: true }), sell: (bIn) => ({ out: Number(v2AmountOut(BigInt(Math.floor(bIn)), rB, rQ)), inRange: true }) },
    v3: { name: `FaroSwap V3 (${pair.v3fee / 10000}% tier)`, feeRate: feeV3, quotePerBase: quotePerBase('v3'), buy: v3Buy, sell: v3Sell },
  };
}


// How much can the V3 pool absorb before its price leaves the active tick range?
// (human units of the quote token when we BUY base with quote on V3, of the base token when we SELL base into it)
function v3Capacity(v3, quote, decQuote, decBase) {
  const lower = Math.floor(v3.tick / v3.tickSpacing) * v3.tickSpacing;
  const sqrtLower = 1.0001 ** (lower / 2);
  const sqrtUpper = 1.0001 ** ((lower + v3.tickSpacing) / 2);
  const k = 1 - v3.feeRate;
  const up = (v3.L * (sqrtUpper - v3.sqrtP)) / k; // token1 that can be added before the upper bound
  const down = (v3.L * (1 / sqrtLower - 1 / v3.sqrtP)) / k; // token0 that can be added before the lower bound
  // quote in (buy base): token0 if quote is 0, else token1. base in (sell base): the other one.
  const buyQuote = (quote === 0 ? down : up) / 10 ** decQuote;
  const sellBase = (quote === 0 ? up : down) / 10 ** decBase;
  return { buyQuote, sellBase };
}

// Synthetic pool states, clearly labelled in the output. They exist so the "act" path can be
// demonstrated and tested: on today's real FaroSwap pools there is no profitable trade.
export const FIXTURES = {
  profitable: { label: 'Synthetic: deep pools, V3 prices the base 3% above V2', r0: 10_000n * 10n ** 18n, r1: 5_000n * 10n ** 18n, v3QuotePerBase: 2.06, L: 3e22 },
  marginal: { label: 'Synthetic: deep pools, V3 prices the base only 0.4% above V2 (less than the 0.6% of fees)', r0: 10_000n * 10n ** 18n, r1: 5_000n * 10n ** 18n, v3QuotePerBase: 2.008, L: 3e22 },
};
function fixtureState(name, pair) {
  const f = FIXTURES[name];
  if (!f) throw new UserError(`source must be live or one of ${Object.keys(FIXTURES).join(', ')}`);
  // token1 per token0 on V3 = 1 / (quote per base) when quote is token0
  const price01 = pair.quote === 0 ? 1 / f.v3QuotePerBase : f.v3QuotePerBase;
  const sqrtP = Math.sqrt(price01);
  return { label: f.label, v2: { r0: f.r0, r1: f.r1 }, v3: { sqrtP, tick: Math.round(Math.log(price01) / Math.log(1.0001)), L: f.L } };
}

// One scan of one pair. `cfg` = { size (max), minNet (absolute, in quote tokens), gasUnitsV2, gasUnitsV3 }.
export async function scanPair({ chain }, pairKey, cfgIn = {}, source = 'live') {
  const pair = ARB_PAIRS[pairKey];
  if (!pair) throw new UserError(`pair must be one of ${Object.keys(ARB_PAIRS).join(', ')}`);
  const cfg = { ...DEFAULTS, ...cfgIn };
  for (const k of ['size', 'minNet', 'gasUnitsV2', 'gasUnitsV3']) if (!Number.isFinite(cfg[k])) throw new UserError(`${k} must be a number`);
  if (cfg.size <= 0) throw new UserError('size must be greater than 0');

  let block;
  let st;
  let gas;
  let label = null;
  if (source === 'live') {
    block = await pinnedBlock(chain, 'Pin both venues to one block for this scan (just behind the latest, which every backend node has)');
    const [res, g] = await Promise.all([
      multicall(chain, [{ target: pair.v2, data: SEL.reserves }, { target: pair.v3, data: SEL.slot0 }, { target: pair.v3, data: SEL.liquidity }], { block, why: 'Read both venues: V2 reserves, V3 slot0 and liquidity' }),
      chain.callTool('get_gas_price', {}, { why: 'Gas price, to cost the two swaps' }),
    ]);
    gas = g;
    if (!res.every((r) => r.success && r.data !== '0x')) throw new UserError('a venue did not answer (the pool may have been drained)');
    const [rw0, rw1] = words(res[0].data);
    const s0 = words(res[1].data);
    st = {
      v2: { r0: BigInt('0x' + rw0), r1: BigInt('0x' + rw1) },
      v3: { sqrtP: sqrtPrice(BigInt('0x' + s0[0])), tick: int24(s0[1]), L: Number(BigInt('0x' + res[2].data.slice(2))) },
    };
  } else {
    ({ label, ...st } = fixtureState(source, pair));
    block = null;
    gas = { gasPriceWei: '10000000000', gasPriceGwei: '10' };
  }
  const q = pair.quote;
  const [Q, B] = [pair.tokens[q], pair.tokens[1 - q]];
  const v = venues(pair, st, q);
  const human = (rawQuoteAmount) => rawQuoteAmount / 10 ** Q.decimals;
  const priceHuman = (qpb) => qpb * 10 ** (B.decimals - Q.decimals); // quote per base, human units

  const prices = { v2: priceHuman(v.v2.quotePerBase), v3: priceHuman(v.v3.quotePerBase) };
  const [cheap, dear] = prices.v2 <= prices.v3 ? ['v2', 'v3'] : ['v3', 'v2'];
  const grossPct = (prices[dear] / prices[cheap] - 1) * 100;
  const gasWei = Number(gas.gasPriceWei);
  const gasPros = ((cfg.gasUnitsV2 + cfg.gasUnitsV3) * gasWei) / 1e18;
  const gasInQuote = Q.address.toLowerCase() === WPROS ? gasPros : null; // PROS == WPROS 1:1; other quotes would need a price path

  // Simulate one trade of `size` quote tokens: buy base on the cheap venue, sell it on the dear one.
  const trade = (size) => {
    const inRaw = size * 10 ** Q.decimals;
    const leg1 = v[cheap].buy(inRaw);
    const leg2 = v[dear].sell(leg1.out);
    const outRaw = leg2.out;
    const ideal = inRaw * (prices[dear] / prices[cheap]);
    const feeCost = inRaw * v[cheap].feeRate + (leg1.out * v[cheap].quotePerBase) * v[dear].feeRate * (prices[dear] / prices[cheap]);
    const netBeforeGas = outRaw - inRaw;
    // What is left of the gross edge after fees is price impact; a tiny negative residual is floating-point noise.
    const impact = ideal - inRaw - feeCost - netBeforeGas;
    return { size, outRaw, inRaw, grossEdge: human(ideal - inRaw), fees: human(feeCost), priceImpact: human(Math.max(impact, 0)), netBeforeGas: human(netBeforeGas), inRange: leg1.inRange && leg2.inRange };
  };

  // Depth matters more than the headline spread: a huge "spread" on a nearly empty pool is not money.
  const v3cap = v3Capacity({ sqrtP: st.v3.sqrtP, L: st.v3.L, feeRate: v.v3.feeRate, tick: st.v3.tick, tickSpacing: tickSpacingFor(pair.v3fee) }, q, Q.decimals, B.decimals);
  const depth = {
    v3RangeBuyQuote: v3cap.buyQuote,
    v3RangeSellBase: v3cap.sellBase,
    v2Quote: human(Number(q === 0 ? st.v2.r0 : st.v2.r1)),
    v3Quote: human(q === 0 ? st.v3.L / st.v3.sqrtP : st.v3.L * st.v3.sqrtP), // virtual reserves in the active range
  };
  // Search trade sizes (log-spaced, 1e-6 x size .. size) for the one with the best net profit
  // that stays inside the V3 active range. Bigger is not better once price impact bites.
  const evaluate = (size) => {
    const t = trade(size);
    return { ...t, net: gasInQuote == null ? null : t.netBeforeGas - gasInQuote };
  };
  const ladder = Array.from({ length: 49 }, (_, i) => cfg.size * 10 ** (-12 + (12 * i) / 48)).map(evaluate);
  const valid = ladder.filter((t) => t.inRange);
  const score = (t) => (t.net ?? t.netBeforeGas);
  const best = valid.length ? valid.reduce((a, b) => (score(b) > score(a) ? b : a)) : evaluate(cfg.size);
  const main = best;
  const net = main.net;
  const netPct = net == null ? null : (net / main.size) * 100;
  const curve = [0, 12, 24, 36, 42, 48].map((i) => ladder[i]).map((t) => ({ size: t.size, netBeforeGas: t.netBeforeGas, net: t.net, inRange: t.inRange }));

  const reasons = [];
  if (!valid.length) reasons.push(`no trade size from ${num(ladder[0].size)} to ${num(cfg.size)} ${Q.symbol} keeps the V3 price inside its active tick range (that range can absorb only about ${num(depth.v3RangeSellBase)} ${B.symbol} when selling into it, ${num(depth.v3RangeBuyQuote)} ${Q.symbol} when buying), so no estimate can be trusted`);
  if (gasInQuote == null) reasons.push(`gas is paid in PROS and ${Q.symbol} cannot be converted to it without another price source`);
  if (net != null && net < cfg.minNet) reasons.push(`best net profit ${num(net)} ${Q.symbol} (at size ${num(main.size)}) is below the minimum ${cfg.minNet} ${Q.symbol}: gross edge ${num(main.grossEdge)} − fees ${num(main.fees)} − price impact ${num(main.priceImpact)} − gas ${num(gasInQuote)}`);
  const act = reasons.length === 0;
  const decision = act ? 'execute-simulated' : 'skip';
  const venueRows = (key) => ({ venue: v[key].name, price: prices[key], fee: v[key].feeRate });
  const thin = depth.v2Quote < 1 || depth.v3Quote < 1;

  return {
    pair: pairKey, block, quote: Q.symbol, base: B.symbol, maxSize: cfg.size, size: main.size, minNet: cfg.minNet, depth,
    sources: { v2: { ...venueRows('v2'), reserves: [formatUnits(st.v2.r0, pair.tokens[0].decimals), formatUnits(st.v2.r1, pair.tokens[1].decimals)] }, v3: { ...venueRows('v3'), liquidity: st.v3.L, tick: st.v3.tick } },
    route: { buyOn: v[cheap].name, sellOn: v[dear].name },
    grossSpreadPct: grossPct,
    costs: { fees: main.fees, priceImpact: main.priceImpact, gas: gasInQuote, gasPros, gasPriceGwei: Number(gas.gasPriceGwei) },
    gross: main.grossEdge, netBeforeGas: main.netBeforeGas, net, netPct,
    decision, reasons,
    fill: act ? { simulated: true, spend: main.size, receive: main.size + net, profit: net, unit: Q.symbol } : null,
    curve, thinPool: thin, source, sourceLabel: label,
  };
}

// The act path executed for real on a local fork (scripts/arb-fork-run.mjs writes this file).
async function recorded() {
  const file = fileURLToPath(new URL('../../reports/arbitrage-runs.json', import.meta.url));
  return JSON.parse(await readFile(file, 'utf8'));
}

// The page offers live scans of the real pools, the act path executed for real on a fork (a Sandbox run), and the recorded run.
// Synthetic pool states (FIXTURES) remain only as test inputs for scanPair; they are not reachable from the web API.
export default async function run({ q, chain, ip }) {
  const sources = ['live', 'fork-recorded'];
  if (q.real === 'start') return { started: await startArbRun({ scenario: q.scenario, ip }), scenarios: ARB_SCENARIOS };
  if (q.real === 'status') return { status: await arbRunStatus({ id: q.id, from: Number(q.from) || 0 }) };
  if (q.source === 'fork-recorded') return { recorded: await recorded(), pairs: Object.keys(ARB_PAIRS), sources };
  if (q.source && q.source !== 'live') throw new UserError('synthetic data is not offered any more: scan the live pools (source=live), run the act path for real (real=start&scenario=profitable|marginal) or read the recorded run (source=fork-recorded)');
  const cfg = {};
  for (const [k, p] of [['size', 'size'], ['minNet', 'minNet'], ['gasUnitsV2', 'gasUnitsV2'], ['gasUnitsV3', 'gasUnitsV3']]) if (q[p] !== undefined && q[p] !== '') cfg[k] = Number(q[p]);
  return { scan: await scanPair({ chain }, q.pair ?? 'WPROS/DLP', cfg, 'live'), pairs: Object.keys(ARB_PAIRS), sources };
}
