// Task 30: one interface over several Pharos protocols; queries and actions routed to the best venue, with the reasons.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const short = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export const content = {
  tagline: 'One interface over R25, Morpho Vault V2 and Morpho Blue: ask about rates and positions, or deposit and withdraw, and it picks the best venue and explains why.',
  tools: ['rpc'],
  story: [
    'Pharos has several places to put USDC to work: three R25 vaults, the RockawayX vault of Morpho Vault V2, and the Morpho Blue lending market. Each has its own contract, its own way of reporting a return, and its own rules about who can get in and how much can come out.',
    'The aggregator puts all five behind one interface. Ask for the rates and it reads them all, measured the same way. Ask where a wallet’s money is and it finds it in every protocol. Ask to deposit or withdraw and it routes the request: it asks each venue whether it would accept it, picks the best one, and lists every other venue with the reason it was passed over. The result is unsigned transactions (an approval and a deposit, or a withdrawal) with a simulation of the last one. It never signs.',
    'If a protocol cannot be read, the answer says so and the others carry on. The recorded run takes protocols down one after another, ending with all of them, and every request still gets a clear answer.',
  ],
  how: [
    { server: 'rpc', tool: 'snapshot', text: 'Every venue read in parallel, each in its own try with its own timeout and endpoint, in JSON-RPC batches pinned to one block; every venue’s reads are made twice and must agree.' },
    { server: 'rpc', tool: 'adapter: ERC-4626 vault', text: 'Share price now and two days ago (the return), total assets, the wallet’s shares.' },
    { server: 'rpc', tool: 'adapter: Morpho Blue market', text: 'market(), idToMarketParams(), the interest-rate model’s borrowRateView, the wallet’s position(); free liquidity is supply minus borrow.' },
    { server: 'rpc', tool: 'probe', text: 'The exact request simulated from the wallet (a deposit as if it held and had approved the USDC): the venue’s own answer decides eligibility.' },
    { server: 'local', tool: 'route + prepare', text: 'Best return for a deposit; lowest return that can pay for a withdrawal; split if needed; unsigned approve + deposit/withdraw calldata.' },
  ],
  decisions: [
    { title: 'Adapters, not special cases', text: 'A venue is three functions behind one interface. The router, the outage handling and the exports know nothing about vaults or markets; a new protocol is a new adapter. The architecture write-up has the diagram.', link: [`${REPO}/blob/main/docs/architecture-multi-protocol-aggregator.md`, 'docs/architecture-multi-protocol-aggregator.md'] },
    { title: 'The venue decides who can get in', text: 'The R25 vaults are permissioned: they refuse some wallets with no message, and Morpho Vault V2 reports zero for maxDeposit and maxWithdraw by design. So eligibility is the venue’s own answer to the exact request, simulated from the wallet, not a guess from those functions.' },
    { title: 'Withdraw from the lowest return that can pay', text: 'Taking the money out where it earns least leaves the rest earning more. A lending market can only pay out what is not lent, so its free liquidity limits it; if no single venue can pay, the request is split from the lowest return up.' },
    { title: 'An outage is an answer, not an error', text: 'A venue that cannot be read comes back as unavailable with the reason, is shown in the answer, and is left out of the choice. If every venue is down, the answer says no venue can take the request right now.' },
    { title: 'Reads must agree', text: 'The public RPC is load-balanced and a node sometimes answers from other state: the same venue’s return came out 5.46% and 5.88% at one block. Each venue’s reads are made twice and must agree; a third breaks a tie; otherwise the venue is unavailable.' },
  ],
  evidence: [
    'Five venues of three protocols (R25 ×3, Morpho Vault V2, Morpho Blue) sit behind one interface, read the same way and measured the same way.',
    'Queries (rates, value locked, free liquidity, a wallet’s positions) and actions (deposit and withdraw, prepared as unsigned approve + deposit/withdraw transactions with a simulation) go through the same interface; nothing is signed.',
    'Each request is routed to a venue and the answer says why: the best measured return among the venues that accept it, with every other venue listed with its reason; withdrawals come from the lowest return that can pay.',
    'The recorded run takes down R25, then Morpho Vault V2, then both, then everything: each time the others carry on, and with all down the answer is a clear “no venue can take this right now”.',
    'The architecture write-up is in docs/architecture-multi-protocol-aggregator.md; the Try tab and the CLI show the same requests step by step.',
  ],
  files: ['agents/multi-protocol-aggregator/pharos-aggregate.js', 'lib/aggregator.js', 'lib/rpc-batch.js', 'lib/tasks/multi-protocol-aggregator.js', 'docs/architecture-multi-protocol-aggregator.md', 'scripts/aggregator-run.mjs', 'reports/aggregator-run.json'],
  run: {
    commands: [
      'node scripts/aggregator-run.mjs   # five venues, three real wallets, eight routed requests (four with an outage); writes reports/aggregator-run.json',
      'node agents/multi-protocol-aggregator/pharos-aggregate.js rates',
      'node agents/multi-protocol-aggregator/pharos-aggregate.js deposit 0x… 2500 --down R25',
    ],
    sampleLabel: 'Output of node scripts/aggregator-run.mjs:',
    sample: `deposit-small: Deposit 500 USDC in RockawayX USDC (Morpho Vault V2): the best measured return (5.46%) among the 3 venues that can take it; the next best is Morpho Blue syzUSD/USDC market (supply) at 5.39%.
withdraw: Withdraw 1,000 USDC from RockawayX USDC (Morpho Vault V2): it is the only venue where this wallet has money that can be paid out now (it earns 5.46%).
outage-best-venue: Deposit 2,500 USDC in Morpho Blue syzUSD/USDC market (supply): the best measured return (5.39%) among the 2 venues that can take it; the next best is R25 VRPC Weekly at 4.71%.
outage-all: No venue can take 500 USDC right now.`,
  },
  verify: [
    { title: 'Compare a rate yourself', text: 'A vault’s return is its share price over two days.', code: 'cast call 0x047cD0a91E9B92ED979189a6C8A120bf280f02E5 "convertToAssets(uint256)(uint256)" 1000000000000000000 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Route your own request', text: 'The Try tab takes any wallet, an action and an amount, with a protocol optionally down.' },
    { title: 'Read the architecture', text: 'The adapter interface, the routing rules and the outage handling.', link: [`${REPO}/blob/main/docs/architecture-multi-protocol-aggregator.md`, 'architecture write-up'] },
    { title: 'Read the tests', text: 'Each adapter, the routing, the outage handling and the disagreeing-read guard run against a fake chain.', link: [`${REPO}/blob/main/test/aggregator.test.js`, 'test/aggregator.test.js'] },
  ],
};

const venueRows = (rows) => table(['Venue', 'Protocol', 'Return', 'Value locked', 'Free liquidity', 'This wallet'], rows.map((r) => (r.status === 'ok' ? [esc(r.name), esc(r.protocol), esc(r.apyText), esc(r.tvlText), esc(r.liquidityText), r.positionText ? `<b>${esc(r.positionText)}</b>` : '—'] : [esc(r.name), esc(r.protocol), pill('unavailable', 'bad'), `<small>${esc(r.error)}</small>`, '', ''])));
const renderRoute = (d) => `<p class="check ${d.routed.legs.length ? 'ok' : 'warn'}"><b>${esc(d.routed.why)}</b>${d.routed.unavailableNote ? `<br><small>${esc(d.routed.unavailableNote)}</small>` : ''}</p>
  ${table(['Venue', 'Chosen / eligible', 'Why'], d.routed.considered.map((c) => [esc(c.name), d.routed.legs.some((l) => l.id === c.id) ? pill('chosen', 'ok') : c.eligible ? pill('eligible', 'warn') : pill('passed over', c.unavailable ? 'bad' : 'warn'), `<small>${esc(c.reason)}</small>`]))}
  ${d.prepared ? `<h4 class="list-h">Unsigned transactions, in order <small class="muted">${esc(d.prepared.signing)}</small></h4>${d.prepared.legs.map((l) => `<p><b>${esc(l.venue)}</b> ${l.simulation ? pill(l.simulation.ok ? 'simulation ok' : 'simulation failed', l.simulation.ok ? 'ok' : 'bad') : ''} <small class="muted">${esc(l.simulation?.note ?? '')}</small></p>${table(['Step', 'To', 'Data'], l.transactions.map((t) => [esc(t.label), `<code>${esc(short(t.to))}</code>`, `<code>${esc(t.data.slice(0, 40))}…</code>`]))}`).join('')}` : ''}`;

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>Query and route</h3>
    <p class="muted">Reads Pharos mainnet now. Nothing is signed. Take a protocol down to see the others carry on.</p>
    <form data-form><div class="row"><label style="flex:1">Wallet<input name="wallet" style="width:100%" value="0xbe2174ff12a71b6deeca5b9aaf4c2931e8c62ae5"></label>
      <label>Request<select name="action"><option value="positions">Show positions and rates</option><option value="deposit">Deposit</option><option value="withdraw">Withdraw</option></select></label>
      <label>Amount (USDC)<input name="amount" value="2500" size="8"></label>
      <label>Protocol down<select name="down"><option value="">none</option><option>R25</option><option>Morpho Vault V2</option><option>Morpho Blue</option></select></label>
      <button type="submit" class="chip">Go</button></div></form>
    <div data-out><div class="idle">Press Go.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    out.innerHTML = '<div class="idle">Reading the protocols…</div>';
    try {
      if (f.action === 'positions') { const { data } = await api('run', { slug, query: 1, wallet: f.wallet, down: f.down }); out.innerHTML = `<p class="check ok"><b>${esc(data.summary.text)}</b></p>${venueRows(data.summary.rows)}`; }
      else { const { data } = await api('run', { slug, route: 1, wallet: f.wallet, action: f.action, amount: f.amount, down: f.down }); out.innerHTML = renderRoute(data) + `<h4 class="list-h">The venues</h4>${venueRows(data.venues)}`; }
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded run, replayed on its block</h3><div class="idle" data-role="body">Replaying the recorded block…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    body.innerHTML = `<p class="check ${ver.verifiedCount === ver.total ? 'ok' : 'bad'}">${ver.verifiedCount === ver.total ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} recorded figures come out the same when the block ${num(run.block)} is read again.</b></p>
      <h4 class="list-h">Rates and size of the five venues</h4>${venueRows(run.rates.rows)}
      <h4 class="list-h">One query, three wallets</h4>${table(['Wallet', 'What it holds'], run.queries.map((q) => [`${esc(q.title)}<br><small><code>${esc(short(q.address))}</code></small>`, esc(q.summary.text)]))}
      ${run.scenarios.map((s) => `<details ${s.down.length ? 'open' : ''}><summary><b>${esc(s.title)}</b> · ${esc(s.action)} ${esc(s.amount)} USDC${s.down.length ? ` · ${pill(`${s.down.join(', ')} down`, 'bad')}` : ''}</summary>${renderRoute(s)}</details>`).join('')}
      <p class="muted">${esc(run.network)}</p>`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
