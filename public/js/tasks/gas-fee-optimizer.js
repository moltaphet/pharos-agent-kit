// Task 24: pays the efficient price for a transaction that can wait, and never waits past its deadline.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const gwei = (wei) => { const g = Number(BigInt(wei)) / 1e9; return `${g.toLocaleString('en-US', { maximumFractionDigits: 9 })} gwei`; };
const phrs = (wei) => `${(Number(BigInt(wei)) / 1e18).toFixed(9)}`;
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const clock = (t) => new Date(t * 1000).toISOString().slice(11, 19);

export const content = {
  tagline: 'Holds a transaction that can wait until gas is cheap, submits it by the deadline whatever the price, and shows what it really paid.',
  tools: ['rpc'],
  story: [
    'You hand the agent a transaction and a deadline. It reads the network’s price, base fee and suggested tip, and compares what the transaction would cost now with a target: your own ceiling in gwei, or by default the cheap quarter of the recent price history. If the price is at or under the target it submits at once; otherwise it holds, looks again every few seconds, and submits the moment the price is favourable.',
    'The deadline is a promise. When it arrives, the transaction goes out at whatever the price is. The agent keeps its last good reading in case the RPC stumbles at the worst moment, and tries the submission up to three times.',
    'It prices the transaction with EIP-1559 fields (a maxFee with headroom so a rising base fee cannot strand it, and the network’s minimal tip), so what is paid is the base fee plus the tip. On Atlantic that is 1 gwei, while the price eth_gasPrice quotes, and a naive wallet signs, is 10 gwei: the recorded run pays a tenth. Every run reports the gas actually paid next to the price at request time.',
  ],
  how: [
    { server: 'rpc', tool: 'eth_getBlockByNumber / eth_gasPrice / eth_maxPriorityFeePerGas', text: 'The base fee of the latest block, the quoted gas price and the suggested tip: one sample.' },
    { server: 'rpc', tool: 'block headers over time', text: 'Thirty samples across the last blocks give the price history, its minimum, quartiles and maximum.' },
    { server: 'local', tool: 'decide', text: 'Price now (base fee + tip) against the target: the user’s ceiling or the history’s 25th percentile.' },
    { server: 'local', tool: 'hold loop', text: 'Re-sample every few seconds until favourable or until the deadline minus a short lead; then submit regardless. Time is injected, so the loop is tested with scripted prices.' },
    { server: 'rpc', tool: 'submit and read back', text: 'A type-2 transaction on Atlantic with a throwaway key; the receipt’s gasUsed and effectiveGasPrice are the “actual gas paid”.' },
  ],
  decisions: [
    { title: 'Pharos gas is flat, and that is a finding', text: 'The base fee is 10 gwei on mainnet and 1 gwei on Atlantic, the same in every block sampled over the last 6 million blocks, with empty blocks. A price that never moves cannot be timed, so the saving here comes from pricing the transaction correctly. The hold-and-release loop is proven with scripted prices in tests and its deadline path on the real chain.' },
    { title: 'The deadline is the latest submission, not inclusion', text: 'The agent submits at the deadline minus a 4-second lead and with a maxFee of three times the base fee, so the transaction is not stranded by a rise. Inclusion then takes a block or two; the report says when the transaction was submitted and mined.' },
    { title: 'The baseline is what a wallet would sign', text: '“Price at request time” is eth_gasPrice. A wallet that signs a legacy transaction at that price pays it in full (10 gwei on Atlantic). The recorded run sends that transaction for real, as the baseline, rather than computing it.' },
    { title: 'Mainnet is prepared, never sent', text: 'On Pharos mainnet the agent only reads the history and prepares the unsigned fields. Sending happens on Atlantic testnet with a throwaway key and a spending budget.' },
    { title: 'Failure is reported, not hidden', text: 'If the RPC cannot be read the loop still reaches the deadline and uses the last reading; if the submission fails three times the error is raised with the full hold log. It never claims a submission it did not make.' },
  ],
  evidence: [
    'The history of both networks is sampled over 3,000 blocks (30 readings) with minimum, quartiles and maximum; the Try tab shows it live for mainnet or Atlantic.',
    'The recorded run holds a transaction with an unreachable ceiling, re-checks seven times, then submits at the deadline; the favourable-now and automatic-target runs submit within a second.',
    'Each recorded transaction reports gas used, price paid and cost beside the request-time quote: 0.000021 PHRS against 0.00021 PHRS for the naive wallet’s identical transfer.',
    'All three optimized transactions were submitted before their deadlines (36.6 s of a 40 s deadline for the held one); a scripted-price test proves the deadline submission when the price never drops, and that a drop releases the hold.',
  ],
  files: ['agents/gas-fee-optimizer/pharos-gas.js', 'lib/gas.js', 'lib/tasks/gas-fee-optimizer.js', 'scripts/gas-run.mjs', 'reports/gas-run.json'],
  run: {
    commands: [
      'node scripts/gas-run.mjs   # reads both networks, sends four real transfers on Atlantic testnet, writes reports/gas-run.json',
      'node agents/gas-fee-optimizer/pharos-gas.js history --chain mainnet',
      'node agents/gas-fee-optimizer/pharos-gas.js send --to 0x… --value 1 --deadline 60 --max-gwei 0.5   # Atlantic testnet only',
    ],
    sampleLabel: 'Output of node scripts/gas-run.mjs (Atlantic testnet):',
    sample: `  mainnet: base fee 10 gwei, eth_gasPrice 10 gwei; Atlantic: base fee 1 gwei, eth_gasPrice 10 gwei
  naive legacy at eth_gasPrice: success, gas 21,000
  favorable-now → favorable: submitted after 0.7s, before the deadline; paid 1 gwei
  hold-to-deadline → deadline: submitted after 36.6s, before the deadline; paid 1 gwei
  auto-target → favorable: submitted after 0.7s, before the deadline; paid 1 gwei`,
  },
  verify: [
    { title: 'Open the transactions', text: 'The Run tab links the four Atlantic transactions; the explorer shows the gas price each paid (10 gwei naive, 1 gwei optimized).' },
    { title: 'Read the price yourself', text: 'The quoted price and the base fee differ on Atlantic.', code: 'cast gas-price --rpc-url https://atlantic.dplabs-internal.com && cast base-fee --rpc-url https://atlantic.dplabs-internal.com' },
    { title: 'Ask the optimizer now', text: 'On the Try tab set a ceiling and a deadline and see the decision, the history and the cost.' },
    { title: 'Read the tests', text: 'The hold loop runs against scripted price series: release on a drop, submission at the deadline when the price never drops, RPC failures, retries.', link: [`${REPO}/blob/main/test/gas.test.js`, 'test/gas.test.js'] },
  ],
};

function spark(rows) {
  const v = rows.filter((r) => r.baseFee != null).map((r) => Number(BigInt(r.baseFee)));
  if (v.length < 2) return '';
  const lo = Math.min(...v); const hi = Math.max(...v);
  const y = (x) => (hi === lo ? 20 : 36 - ((x - lo) / (hi - lo)) * 32);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 300},${y(x)}`).join(' ');
  return `<svg viewBox="0 0 300 40" width="100%" height="48" role="img" aria-label="base fee over the sampled blocks"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>What would the optimizer do now?</h3>
    <p class="muted">Reads the network live. Sends nothing.</p>
    <form class="row" data-form>
      <label>Network<select name="chain"><option value="mainnet">Pharos mainnet</option><option value="atlantic">Atlantic testnet</option></select></label>
      <label>Ceiling (gwei, empty = automatic)<input name="maxGwei" value="" inputmode="decimal" placeholder="e.g. 5"></label>
      <label>Deadline (seconds)<input name="deadlineSec" type="number" min="5" value="120"></label>
      <label>Gas<input name="gas" type="number" min="21000" value="21000"></label>
      <button type="submit" class="chip">Ask</button></form>
    <div data-out><div class="idle">Press Ask.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    out.innerHTML = '<div class="idle">Reading…</div>';
    try {
      const { data } = await api('run', { slug, history: 1, ...f });
      const st = data.history.stats;
      out.innerHTML = `<p class="check ${data.decision.favorable ? 'ok' : 'warn'}"><b>${esc(data.decision.action)}</b> — price now ${esc(gwei(data.decision.price))} vs target ${esc(gwei(data.decision.target))} (${esc(data.decision.targetSource)})</p>
        <p class="muted">${esc(data.chain)} · block ${num(data.now.block)} · base fee ${esc(gwei(data.now.baseFee))} · eth_gasPrice ${esc(gwei(data.now.gasPrice))} · suggested tip ${esc(gwei(data.now.tip))}</p>
        <p>Cost of ${num(data.cost.gas)} gas: <b>${phrs(data.cost.optimizedWei)}</b> priced the efficient way, against <b>${phrs(data.cost.naiveWei)}</b> at the quoted price. Fees to sign: maxFee ${esc(gwei(data.cost.fees.maxFeePerGas))}, tip ${esc(gwei(data.cost.fees.maxPriorityFeePerGas))}.</p>
        <h4 class="list-h">History (${st.samples} samples over ${num(data.history.span)} blocks) ${st.flat ? pill('flat: the price did not move', 'warn') : ''}</h4>
        ${spark(data.history.rows)}
        <p class="muted">min ${esc(gwei(st.min))} · 25th pct ${esc(gwei(st.p25))} · median ${esc(gwei(st.median))} · max ${esc(gwei(st.max))}</p>
        ${table(['Block', 'Time (UTC)', 'Base fee', 'Block fullness'], data.history.rows.slice(-12).map((r) => [num(r.block), clock(r.time), esc(gwei(r.baseFee)), `${(r.fullness * 100).toFixed(2)}%`]))}
        <p class="muted">${esc(data.note)}</p>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded run on Atlantic testnet, re-read from the chain</h3><div class="idle" data-role="body">Re-reading the transactions…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const ok = ver.verifiedCount === ver.total;
    const s = run.scenarios;
    const rows = s.map((x) => {
      const paid = x.id === 'naive' ? x.costWei : x.paid.costWei;
      const price = x.id === 'naive' ? x.tx.effectiveGasPrice : x.paid.effectiveGasPrice;
      return [esc(x.title), x.id === 'naive' ? '—' : esc(x.reason), x.id === 'naive' ? '—' : `${(x.heldMs / 1000).toFixed(1)} s of ${x.deadlineSec} s`, esc(gwei(price)), `${phrs(paid)} PHRS`, `<a href="https://atlantic.pharosscan.xyz/tx/${esc(x.tx.hash)}" target="_blank" rel="noopener"><code>${esc(short(x.tx.hash))}</code></a>`, ver.results[x.id]?.verified ? pill('on-chain', 'ok') : pill('mismatch', 'bad')];
    });
    const held = s.find((x) => x.id === 'hold-to-deadline');
    body.innerHTML = `<p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} transactions match the chain just now</b> (Atlantic block ${num(ver.head)}). Recorded ${esc(run.recordedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
      ${table(['Run', 'Why it went out', 'Held', 'Gas price paid', 'Cost', 'Transaction', ''], rows)}
      <p class="check ${run.summary.allBeforeDeadline ? 'ok' : 'bad'}">${run.summary.allBeforeDeadline ? 'Every optimized transaction was submitted before its deadline.' : 'A deadline was missed.'} The naive wallet paid ${esc(String(run.summary.savedPercent))}% more than needed.</p>
      <h4 class="list-h">The held transaction: ${held.samples} readings, then the deadline</h4>
      ${table(['After', 'Block', 'Price', 'Target', 'Decision'], held.holds.map((h) => [h.error ? '—' : `${(h.t / 1000).toFixed(1)} s`, h.block ? num(h.block) : '', h.price ? esc(gwei(h.price)) : esc(h.error ?? ''), h.target ? esc(gwei(h.target)) : '', h.favorable ? pill('favourable', 'ok') : pill('hold', 'warn')]))}
      <h4 class="list-h">Price history, 3,000 blocks</h4>
      ${['mainnet', 'atlantic'].map((c) => { const h = run.history[c]; return `<p><b>${c === 'mainnet' ? 'Pharos mainnet' : 'Atlantic testnet'}</b>: base fee ${esc(gwei(h.stats.min))} – ${esc(gwei(h.stats.max))} ${h.stats.flat ? pill('flat', 'warn') : ''}</p>${spark(h.rows)}`; }).join('')}`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
