// Arbitrage Scanner: content and a factory panel with a browser-side scan history.
import { esc, store } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { mountRealRun } from '../panels/real-run.js';
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
    'The act path is proved on a real EVM, not only simulated. The live pools are far too thin to ever profit, so a local fork of Pharos mainnet re-prices the V2 pair with a real swap, deposits our own liquidity into both venues, makes a real price gap with another swap, lets this scanner decide on that state, and then executes both legs with a helper contract. The recorded run compares what the scanner predicted with what the EVM did: the profit matches to about eight decimal places.',
    'The honest headline from the live market is a skip. When we recorded this, the WPROS/DLP pair showed a gap of almost six million percent, but one pool held about 0.00007 WPROS and the other’s active price range could absorb only a tiny fraction of a token, so the best achievable net profit was negative after gas. Pool balances move, so run a scan to see today’s numbers. There is no synthetic data on this page: the act path is proved by the real run above, on a fork.',
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
    { title: 'A huge spread is not an opportunity', text: 'When recorded, the live spread was about 5.8 million percent and the best net profit was still negative. The scan reports depth next to the spread so the number cannot mislead.' },
    { title: 'Search the size, do not assume it', text: 'The first version tried one size and called the result “net −0.6 WPROS”, which was meaningless because that trade left the V3 range. Searching sizes found the real answer: nothing is tradable.' },
    { title: 'Refuse to estimate outside the range', text: 'V3 liquidity changes at tick boundaries we do not read. When a trade would cross one, the scan skips instead of guessing.' },
    { title: 'Threshold in tokens, not percent', text: 'The best size changes with the market, so a percentage threshold is ambiguous. The minimum is an absolute net profit in the quote token.' },
    { title: 'Gas must be priceable', text: 'Gas is paid in PROS. If the quote token cannot be converted to it, the scan skips rather than inventing an exchange rate.' },
    { title: 'Prove the maths against the real contracts', text: 'A model that agrees with itself proves nothing. On the fork, the profit the scanner predicted for its chosen trade equals what the real FaroSwap contracts paid out (the recorded table shows both, differing by less than a millionth of a percent), and a trade it refused really lost money. The run says plainly that we deposited the liquidity and made the price gap ourselves.' },
    { title: 'Gas is assumed high on purpose', text: 'The scanner assumes 270,000 gas units for the two swaps. The two legs measured about 170,000 inside one atomic helper call. We kept the higher figure: two separate transactions would cost more than the helper, and a scanner that underestimates cost acts when it should not.' },
    { title: 'No synthetic data', text: 'An earlier version offered two made-up pool states to show the act path. They proved the maths agreed with itself, so they were removed from the page. What replaced them is the real run: the same scanner, deciding on real contracts in a real EVM, with the predicted profit compared with what the EVM paid out.' },
  ],
  evidence: [
    'Both venues are read in the same scan at one pinned block: FaroSwap V2 (reserves) and FaroSwap V3 (slot0, liquidity), through one Multicall3 call.',
    'Net profit subtracts each venue’s swap fee, an estimate of price impact (searched across trade sizes) and gas (270k units at the live gas price, in WPROS).',
    'It acts (a simulated fill) only when net profit reaches a configurable minimum; otherwise the scan lists exactly why it skipped, with the numbers.',
    'Every scan records gross spread, costs, net result and decision: the history table below, the run log, and `--log scans.jsonl` in the CLI.',
    'Live scans never send anything: “acting” on live data is a simulated fill, so no key, no transaction and no funds are ever at risk. The act path itself was executed on a local fork of Pharos mainnet (real FaroSwap V2 and V3 contracts, a real EVM, anvil’s unlocked dev accounts), with predicted and actual profit recorded side by side in reports/arbitrage-runs.json.',
  ],
  files: ['scripts/arb-fork-run.mjs', 'contracts/ArbLab.sol', 'lib/arb-fork.js', 'skills/pharos-arbitrage-scanner/SKILL.md', 'skills/pharos-arbitrage-scanner/references/arbitrage-scanner.md', 'skills/pharos-arbitrage-scanner/scripts/scan.mjs', 'lib/tasks/arbitrage-scanner.js', 'lib/amm.js', 'lib/multicall.js'],
  run: {
    commands: ['node skills/pharos-arbitrage-scanner/scripts/scan.mjs', 'node skills/pharos-arbitrage-scanner/scripts/scan.mjs --watch 10 --interval 5 --log scans.jsonl', 'node scripts/arb-fork-run.mjs   # real EVM on a local fork; needs Foundry'],
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
    { title: 'Reproduce the real-EVM run', text: 'Needs Foundry (anvil, forge, cast). It forks Pharos mainnet, builds contracts/ArbLab.sol, runs both scenarios and rewrites the report. Transaction hashes exist only on that local fork. Your numbers will differ slightly because the fork block and gas price differ.', code: 'node scripts/arb-fork-run.mjs --out /tmp/arbitrage-runs.json' },
    { title: 'Read the recorded run and the helper contract', text: 'The recorded report with every step, and the Solidity helper that adds liquidity and runs the two legs.', link: [`${REPO}/blob/main/reports/arbitrage-runs.json`, 'reports/arbitrage-runs.json'] },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference and the script are in the repository.', link: [`${REPO}/tree/main/skills/pharos-arbitrage-scanner`, 'skills/pharos-arbitrage-scanner'] },
  ],
};

const scanView = {
  decode: ({ scan: s }) => [
    { kind: 'decision', title: `Gross spread ${f(s.grossSpreadPct, 4)}% (${s.route.buyOn} → ${s.route.sellOn})`, lines: [['V2 price', `${f(s.sources.v2.price)} ${s.quote}/${s.base}`], ['V3 price', `${f(s.sources.v3.price)} ${s.quote}/${s.base}`], ['depth: V2 quote reserve', `${f(s.depth.v2Quote)} ${s.quote}`], ['depth: V3 range can absorb (selling base)', `${f(s.depth.v3RangeSellBase)} ${s.base}`]] },
    { kind: 'decision', title: `Net ${f(s.net)} ${s.quote} at size ${f(s.size)}`, lines: [['gross edge', f(s.gross)], ['swap fees', f(s.costs.fees)], ['price impact', f(s.costs.priceImpact)], ['gas', f(s.costs.gas)], ['minimum net', f(s.minNet)]] },
    { kind: 'decision', title: `Decision: ${s.decision}`, detail: s.reasons.join(' | ') || 'net profit clears the minimum' },
  ],
  summary: ({ scan: s }) => `${s.decision} · gross ${f(s.grossSpreadPct, 4)}% · net ${f(s.net)} ${s.quote}`,
  render: ({ scan: s }, { state }) => `
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
};

const fx = (n, d = 6) => (n == null ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));
const sgn = (n, d = 6) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${fx(n, d)}`);

const recordedView = {
  decode: (r) => r.scenarios.map((s) => ({ kind: 'decision', ok: s.scan.decision !== 'skip' || s.execution.actualNet < 0, title: `${s.title}`, detail: `scanner: ${s.scan.decision}; real execution: ${s.execution.status}, ${s.execution.actualGrossProfit == null ? 'reverted' : `${sgn(s.execution.actualGrossProfit)} WPROS before gas (predicted ${sgn(s.execution.predictedGrossProfit)})`}; scan after the trade: ${s.rescan.decision}` })),
  summary: (r) => `${r.scenarios.length} recorded fork scenarios · predicted vs actual profit within ${fx(Math.max(...r.scenarios.map((s) => s.execution.predictionErrorPct ?? 0)), 6)}%`,
  render: (r) => `
    <p class="check warn"><b>How to read this.</b> ${r.honesty.map(esc).join(' ')}</p>
    <p class="muted">Recorded ${esc(r.recordedAt)} on a ${esc(r.network.name)}. Transaction hashes exist only on that fork.</p>
    ${r.scenarios.map((s) => `
      <div class="card" style="margin-bottom:14px">
        <div class="verdict ${s.scan.decision === 'skip' ? 'warn' : 'ok'}">${s.scan.decision === 'skip' ? 'SCANNER SKIPPED' : 'SCANNER ACTED'}<small>${esc(s.title)}</small></div>
        <p class="muted">${esc(s.note)} Fork block ${s.forkBlock.toLocaleString('en-US')}.</p>
        <ol class="steps-list">${s.steps.map((st, i) => `<li><span class="si ok">${i + 1}</span><div><b>${esc(st.what)}</b>${st.decision ? ' ' + pill(st.decision === 'skip' ? 'skip' : 'act', st.decision === 'skip' ? 'warn' : 'ok') : ''}<p class="muted">${esc(st.detail)}</p></div></li>`).join('')}</ol>
        <h4 class="list-h">Predicted by the scanner vs what the EVM did</h4>
        ${table(['', 'Scanner’s model', 'Real EVM', 'Difference'], [
          [s.execution.forced ? 'Profit before gas (forced 5 WPROS trade)' : 'Profit before gas', sgn(s.execution.predictedGrossProfit), s.execution.actualGrossProfit == null ? `reverted (${esc(s.execution.revertReason ?? '')})` : sgn(s.execution.actualGrossProfit), s.execution.predictionErrorPct == null ? 'n/a' : `${fx(s.execution.predictionErrorPct, 8)}%`],
          ['Gas units, both legs', fx(s.execution.predictedGasUnits, 0) + ' (assumed)', fx(s.execution.gasUsed, 0), `${fx((1 - s.execution.gasUsed / s.execution.predictedGasUnits) * 100, 0)}% below the assumption`],
          ['Net after gas', '', `<b class="${s.execution.actualNet >= 0 ? 'ok' : 'bad'}">${sgn(s.execution.actualNet)} WPROS</b>`, `gas ${fx(s.execution.gasCostWpros, 6)} WPROS at ${fx(s.execution.gasPriceGwei, 2)} gwei`],
        ])}
        <p class="check ${s.scan.decision === 'skip' && s.execution.actualNet < 0 ? 'ok' : s.scan.decision !== 'skip' && s.execution.actualNet > 0 ? 'ok' : 'bad'}">${s.scan.decision === 'skip' ? (s.execution.actualNet < 0 ? '✓ The scanner was right to skip: the trade it refused really lost money.' : '✗ The scanner skipped a trade that would have profited.') : (s.execution.actualNet > 0 ? '✓ The scanner was right to act: the trade really made money after gas.' : '✗ The scanner acted on a trade that lost money.')}</p>
      </div>`).join('')}`,
};

const scanPanel = makePanel({
  intro: 'Scan the real pools once: the live prices on both venues, every cost, and the decision. Every scan is added to the history below (kept in your browser). Nothing is sent.',
  fields: [
    { name: 'pair', label: 'Pair', type: 'select', options: [['WPROS/DLP', 'WPROS / DLP'], ['UNI-V2/PDOG', 'UNI-V2 / PDOG']], value: 'WPROS/DLP' },
    { name: 'size', label: 'Max trade size', type: 'number', value: '1', step: 'any', min: 0, hint: 'in the quote token' },
    { name: 'minNet', label: 'Minimum net profit', type: 'number', value: '0.001', step: 'any', min: 0, hint: 'in the quote token' },
  ],
  button: 'Scan now',
  examples: [
    { label: 'WPROS / DLP, today', values: { pair: 'WPROS/DLP', size: '1', minNet: '0.001' } },
    { label: 'UNI-V2 / PDOG, today', values: { pair: 'UNI-V2/PDOG', size: '1', minNet: '0.001' } },
  ],
  state: history,
  title: (v) => `Scan ${v.pair}`,
  call: (v) => ({ params: { pair: v.pair, source: 'live', size: v.size, minNet: v.minNet } }),
  nextState: (d, prev) => ([{ at: new Date().toISOString().slice(11, 19), pair: d.scan.pair, source: d.scan.source, block: d.scan.block, spread: d.scan.grossSpreadPct, net: d.scan.net, decision: d.scan.decision, unit: d.scan.quote }, ...(prev ?? [])].slice(0, 25)),
  decode: (d) => scanView.decode(d),
  summary: (d) => scanView.summary(d),
  render: (d, ctx) => scanView.render(d, ctx),
});

// Two panels: a scan of the real pools (a decision, nothing sent), and the act path executed for real on a fork.
export function mount(root, ctx) {
  root.innerHTML = '<h4 class="list-h">1. Scan the real pools</h4><div data-slot="scan"></div><h4 class="list-h" style="margin-top:28px">2. Run the act path for real</h4><div data-slot="real"></div>';
  const stopScan = scanPanel(root.querySelector('[data-slot=scan]'), ctx);
  const stopReal = mountRealRun(root.querySelector('[data-slot=real]'), {
    slug: ctx.slug,
    intro: 'The live pools hold less than one swap’s gas, so no live trade can profit. This starts a fresh machine that forks Pharos mainnet, re-prices the V2 pair and adds liquidity to both venues with real swaps and mints, makes a price gap with another real swap, lets the scanner above decide, and executes both legs on the real FaroSwap contracts. The liquidity and the gap are ours, and the page says so.',
    button: 'Run for real',
    scenarios: Object.entries({ profitable: 'A real 6% price gap: the scanner acts, both legs execute', marginal: 'A 0.3% price gap: the scanner skips, and forcing the trade loses' }),
    eventHead: ['Time', 'Step', 'Detail'],
    eventRow: (e) => `<tr><td class="num">${(e.t / 1000).toFixed(1)} s</td><td>${esc(e.what)}${e.decision ? ' ' + pill(e.decision === 'skip' ? 'skip' : 'act', e.decision === 'skip' ? 'warn' : 'ok') : ''}</td><td class="muted">${esc(e.detail ?? '')}</td></tr>`,
    resultHtml: (rec) => recordedView.render(rec),
    verdict: (rec) => (rec.scenarios.every((x) => (x.scan.decision === 'skip') === (x.execution.actualNet < 0)) ? 'ok' : 'error'),
    summary: (rec) => rec.scenarios.map((x) => `${x.id}: scanner ${x.scan.decision === 'skip' ? 'skipped' : 'acted'}, real net ${f(x.execution.actualNet)} WPROS`).join(' · '),
    recorded: { label: 'Show the recorded run', params: { source: 'fork-recorded' }, html: (d) => recordedView.render(d.recorded) },
  });
  return () => { stopScan?.(); stopReal?.(); };
}
