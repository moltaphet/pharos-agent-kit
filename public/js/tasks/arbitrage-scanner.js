// Arbitrage Scanner: content and a factory panel with a browser-side scan history.
import { esc, store } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { EXPLORER, REPO } from '../consts.js';

const KEY = 'arb-history-v1';
const history = {
  load() {
    try {
      return JSON.parse(store.get(KEY) ?? '[]');
    } catch {
      return [];
    }
  },
  save(h) {
    store.set(KEY, JSON.stringify(h ?? []));
  },
};
const f = (n, d = 5) => (n == null ? 'n/a' : Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(d))));

export const content = {
  tagline: 'Compare one pair on two venues, subtract every cost, and act only when the profit is real.',
  tools: ['chain'],
  skill: true,
  story: [
    'An arbitrage scanner is easy to fool. Two venues disagree on a price, the gap looks huge, and the bot trades into a pool that holds a few cents. This Pharos Skill reads the same token pair from two independent places at the same block (FaroSwap V2 reserves and FaroSwap V3 pool state), simulates buying on the cheaper venue and selling on the dearer one, and subtracts swap fees, price impact and gas before it will call anything profitable.',
    'It searches trade sizes rather than assuming one, because bigger is not better once price impact bites, and it checks that a V3 trade stays inside the pool’s active price range, where the maths is exact. If it cannot trust the estimate it skips and says why. It never sends a transaction: “acting” is a simulated fill.',
    'The honest headline from the live market is a skip. The WPROS/DLP pair shows a gap of almost six million percent, but one pool holds about 0.00007 WPROS and the other’s active range can absorb a few thousandths of a token, so the best achievable net profit is negative after gas. To show the “act” path too, there are two clearly labelled synthetic scenarios that run the same maths.',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number', text: 'Pin both venues to one block so the two prices describe the same moment.' },
    { server: 'chain', tool: 'eth_call → Multicall3', text: 'Read V2 getReserves, V3 slot0 and liquidity in one batched call, plus get_gas_price.' },
    { server: 'local', tool: 'price both venues', text: 'Quote-per-base on V2 from the reserves, on V3 from the square-root price. Pick the cheaper venue to buy on, the dearer to sell on.' },
    { server: 'local', tool: 'simulate the trade', text: 'V2: exact constant-product maths. V3: exact within the active tick range (virtual reserves). Both include the venue’s fee.' },
    { server: 'local', tool: 'search sizes', text: 'Try 49 sizes from 1e-12 × the maximum up to the maximum; keep the best net profit that stays inside the V3 range.' },
    { server: 'local', tool: 'cost + decide', text: 'Gas = 270k units × live gas price, in the quote token. Act (simulated fill) only if net ≥ the threshold; otherwise list every reason with numbers.' },
  ],
  decisions: [
    { title: 'A huge spread is not an opportunity', text: 'On live data the spread is ~5.8 million percent and the best net profit is still negative. The scan reports depth next to the spread so the number cannot mislead.' },
    { title: 'Search the size, do not assume it', text: 'The first version tried one size and called the result “net −0.6 WPROS”, which was meaningless because that trade left the V3 range. Searching sizes found the real answer: nothing is tradable.' },
    { title: 'Refuse to estimate outside the range', text: 'V3 liquidity changes at tick boundaries we do not read. When a trade would cross one, the scan skips instead of guessing.' },
    { title: 'Threshold in tokens, not percent', text: 'The best size changes with the market, so a percentage threshold is ambiguous. The minimum is an absolute net profit in the quote token.' },
    { title: 'Gas must be priceable', text: 'Gas is paid in PROS. If the quote token cannot be converted to it, the scan skips rather than inventing an exchange rate.' },
    { title: 'Synthetic scenarios are labelled', text: 'The “profitable” and “marginal” states exist to demonstrate and test the act path. Every output says it is synthetic, and none is presented as a market observation.' },
  ],
  evidence: [
    'Both venues are read in the same scan at one pinned block: FaroSwap V2 (reserves) and FaroSwap V3 (slot0, liquidity), through one Multicall3 call.',
    'Net profit subtracts each venue’s swap fee, an estimate of price impact (searched across trade sizes) and gas (270k units at the live gas price, in WPROS).',
    'It acts (a simulated fill) only when net profit reaches a configurable minimum; otherwise the scan lists exactly why it skipped, with the numbers.',
    'Every scan records gross spread, costs, net result and decision: the history table below, the run log, and `--log scans.jsonl` in the CLI.',
    'Execution is simulated only: no key, no transaction, no funds at risk.',
  ],
  files: ['skills/pharos-arbitrage-scanner/SKILL.md', 'skills/pharos-arbitrage-scanner/references/arbitrage-scanner.md', 'skills/pharos-arbitrage-scanner/scripts/scan.mjs', 'lib/tasks/arbitrage-scanner.js', 'lib/amm.js', 'lib/multicall.js'],
  run: {
    commands: ['node skills/pharos-arbitrage-scanner/scripts/scan.mjs', 'node skills/pharos-arbitrage-scanner/scripts/scan.mjs --watch 10 --interval 5 --log scans.jsonl', 'node skills/pharos-arbitrage-scanner/scripts/scan.mjs --source profitable --size 50   # synthetic, exit 0'],
    sample: `scan 1/1  WPROS/DLP  block 20918559
  FaroSwap V2 0.000042216 WPROS/DLP   FaroSwap V3 (0.3% tier) 2.4462
  gross spread 5794000%   best size 1.7783e-9 WPROS
  gross 0.00010304 − fees 3.0819e-7 − price impact 3.3514e-7 − gas 0.0027 = net -0.0025976 WPROS
  DECISION SKIP
    skipped because: best net profit -0.002598 WPROS is below the minimum 0.001 WPROS`,
  },
  verify: [
    { title: 'Read the V2 pool yourself', text: 'Reserves of the WPROS/DLP V2 pair: the first is WPROS, about 0.00007 in size.', code: 'cast call 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417 "getReserves()(uint112,uint112,uint32)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Read the V3 pool yourself', text: 'The square-root price (first value), current tick and liquidity of the V3 pool. Price = (sqrtPriceX96 / 2^96)².', code: 'cast call 0xed7359fd2e74ce8d7910307fea4c8b6cb4afd44c "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url https://rpc.pharos.xyz\ncast call 0xed7359fd2e74ce8d7910307fea4c8b6cb4afd44c "liquidity()(uint128)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Check the pools are real FaroSwap contracts', text: 'The V2 pair reports FaroSwap’s V2 factory as its creator, and the V3 factory returns the V3 pool for the same two tokens and the 0.3% tier. Both should print the addresses in the comments.', code: 'cast call 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417 "factory()(address)" --rpc-url https://rpc.pharos.xyz   # 0x18Fab7d7…F09 (V2 factory)\ncast call 0x2c90CcB0b989afA2433F499698451a25744A552b "getPool(address,address,uint24)(address)" 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 0xb98bd05255542404f68821065d2635da6ac80c87 3000 --rpc-url https://rpc.pharos.xyz   # 0xed7359Fd…d44C' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference and the script are in the repository.', link: [`${REPO}/tree/main/skills/pharos-arbitrage-scanner`, 'skills/pharos-arbitrage-scanner'] },
  ],
};

export const mount = makePanel({
  intro: 'Scan the pair once, or pick a labelled synthetic scenario to see the act path. Every scan is added to the history below (kept in your browser).',
  fields: [
    { name: 'pair', label: 'Pair', type: 'select', options: [['WPROS/DLP', 'WPROS / DLP'], ['UNI-V2/PDOG', 'UNI-V2 / PDOG']], value: 'WPROS/DLP' },
    { name: 'source', label: 'Data', type: 'select', options: [['live', 'Live Pharos mainnet'], ['profitable', 'Synthetic: profitable'], ['marginal', 'Synthetic: marginal']], value: 'live' },
    { name: 'size', label: 'Max trade size', type: 'number', value: '1', step: 'any', min: 0, hint: 'in the quote token' },
    { name: 'minNet', label: 'Minimum net profit', type: 'number', value: '0.001', step: 'any', min: 0, hint: 'in the quote token' },
  ],
  button: 'Scan now',
  examples: [
    { label: 'Live market (expect a skip)', values: { pair: 'WPROS/DLP', source: 'live', size: '1', minNet: '0.001' } },
    { label: 'Synthetic profitable (expect an act)', values: { pair: 'WPROS/DLP', source: 'profitable', size: '50', minNet: '0.001' } },
    { label: 'Synthetic marginal (expect a skip)', values: { pair: 'WPROS/DLP', source: 'marginal', size: '50', minNet: '0.001' } },
  ],
  state: history,
  title: (v) => `Scan ${v.pair} (${v.source})`,
  call: (v) => ({ params: { pair: v.pair, source: v.source, size: v.size, minNet: v.minNet } }),
  nextState: (d, prev) => [{ at: new Date().toISOString().slice(11, 19), pair: d.scan.pair, source: d.scan.source, block: d.scan.block, spread: d.scan.grossSpreadPct, net: d.scan.net, decision: d.scan.decision, unit: d.scan.quote }, ...(prev ?? [])].slice(0, 25),
  decode: ({ scan: s }) => [
    { kind: 'decision', title: `Gross spread ${f(s.grossSpreadPct, 4)}% (${s.route.buyOn} → ${s.route.sellOn})`, lines: [['V2 price', `${f(s.sources.v2.price)} ${s.quote}/${s.base}`], ['V3 price', `${f(s.sources.v3.price)} ${s.quote}/${s.base}`], ['depth: V2 quote reserve', `${f(s.depth.v2Quote)} ${s.quote}`], ['depth: V3 range can absorb (selling base)', `${f(s.depth.v3RangeSellBase)} ${s.base}`]] },
    { kind: 'decision', title: `Net ${f(s.net)} ${s.quote} at size ${f(s.size)}`, lines: [['gross edge', f(s.gross)], ['swap fees', f(s.costs.fees)], ['price impact', f(s.costs.priceImpact)], ['gas', f(s.costs.gas)], ['minimum net', f(s.minNet)]] },
    { kind: 'decision', title: `Decision: ${s.decision}`, detail: s.reasons.join(' | ') || 'net profit clears the minimum' },
  ],
  summary: ({ scan: s }) => `${s.decision} · gross ${f(s.grossSpreadPct, 4)}% · net ${f(s.net)} ${s.quote}`,
  render: ({ scan: s }, { state }) => `
    ${s.sourceLabel ? `<p class="check warn"><b>Synthetic data:</b> ${esc(s.sourceLabel)}. This is not a market observation.</p>` : ''}
    <div class="verdict ${s.decision === 'skip' ? 'warn' : 'ok'}">${s.decision === 'skip' ? 'SKIP' : 'EXECUTE (simulated)'}<small>${esc(s.pair)} · ${s.block ? `block ${s.block.toLocaleString('en-US')}` : 'synthetic state'} · ${esc(s.route.buyOn)} → ${esc(s.route.sellOn)}</small></div>
    ${table(['Venue', `Price (${s.quote}/${s.base})`, 'Fee', 'Depth'], [
      [esc(s.sources.v2.venue), `<b>${f(s.sources.v2.price)}</b>`, `${(s.sources.v2.fee * 100).toFixed(1)}%`, `${f(s.depth.v2Quote)} ${s.quote} reserve`],
      [esc(s.sources.v3.venue), `<b>${f(s.sources.v3.price)}</b>`, `${(s.sources.v3.fee * 100).toFixed(2)}%`, `range absorbs ~${f(s.depth.v3RangeSellBase)} ${s.base}`],
    ])}
    <h4 class="list-h">The working, at the best trade size (${f(s.size)} ${esc(s.quote)})</h4>
    ${table(['Gross spread', 'Gross edge', '− Swap fees', '− Price impact', '− Gas', '= Net'], [[`${f(s.grossSpreadPct, 4)}%`, f(s.gross), f(s.costs.fees), f(s.costs.priceImpact), s.costs.gas == null ? '<span class="warn">unpriced</span>' : f(s.costs.gas), s.net == null ? 'n/a' : `<b class="${s.net >= s.minNet ? 'ok' : 'bad'}">${f(s.net)} ${esc(s.quote)}</b>`]])}
    ${s.reasons.length ? `<p class="check warn"><b>Skipped because:</b><br>${s.reasons.map(esc).join('<br>')}</p>` : `<p class="check ok"><b>Simulated fill:</b> spend ${f(s.fill.spend)} ${esc(s.quote)}, receive ${f(s.fill.receive)}; profit ${f(s.fill.profit)}. Nothing was sent.</p>`}
    ${s.thinPool ? '<p class="muted">At least one pool is very thin, so a large spread here says little about real opportunity.</p>' : ''}
    <h4 class="list-h">Net profit by trade size</h4>
    ${table(['Size', 'Net before gas', 'Net after gas', 'Estimate'], s.curve.map((c) => [f(c.size), f(c.netBeforeGas), c.net == null ? 'n/a' : f(c.net), c.inRange ? pill('trusted', 'ok') : pill('outside V3 range', 'warn')]))}
    <h4 class="list-h">Scan history <span class="muted">newest first, kept in this browser</span></h4>
    ${table(['Time (UTC)', 'Pair', 'Data', 'Gross spread', 'Net', 'Decision'], (state ?? []).map((h) => [h.at, esc(h.pair), esc(h.source), `${f(h.spread, 4)}%`, h.net == null ? 'n/a' : `${f(h.net)} ${esc(h.unit)}`, pill(h.decision === 'skip' ? 'skip' : 'execute (sim)', h.decision === 'skip' ? 'warn' : 'ok')]))}`,
});
