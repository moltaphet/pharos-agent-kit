// Task 23: a watchlist agent that explains the big moves of the addresses it follows.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const usd = (micro) => (micro == null ? '' : `$${(Number(BigInt(micro)) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const WATCH = ['0x912c9ade24d44d8922f0866d8dcb079f1363f647', '0x1f3546a29eec2102c8d52e21a45114124014c85c', '0x14f06fe99a1264825c99fb1c8e05a90036e89d0a', '0x3fa4fbe561f6d5996ca69b4fb82e61a01d3ae558', '0x768b959191ce5876cabbbc014a08d72615bdde54', '0x936564245b69f5a293b42cbd752e0ee3bb68b470'];

export const content = {
  tagline: 'Follows a list of addresses on Pharos mainnet and explains each significant move: what, how much, to whom, and why it matters.',
  tools: ['rpc'],
  story: [
    'You give the agent a watchlist (as many addresses as you like, at least five make a useful picture) and what “significant” means: an amount per token, and optionally a value in dollars. It scans a range of blocks and reports every token transfer that touches a watched address and crosses the line.',
    'Each report says what moved, how much (with a dollar value when the token has a price feed), from whom to whom with labels for watched wallets and known protocols, and why it matters: how big it is against what the wallet held, whether it stayed inside the watchlist, whether the other side is a protocol, a burn or an unlabelled contract.',
    'Besides transfers, the agent compares each address’s balances at the start and the end of the range and reports new positions, exits, and bigger or smaller holdings. A summary across all addresses shows who was active, what came in and went out in dollars, and the biggest move.',
  ],
  how: [
    { server: 'rpc', tool: 'eth_getLogs', text: 'ERC-20 Transfer logs where a watched address is sender or receiver, per token, in windows of at most 1,000 blocks.' },
    { server: 'rpc', tool: 'Multicall3 aggregate3', text: 'Token balances and native PROS (getEthBalance) of every watched address at the first and last block, each snapshot read twice and compared.' },
    { server: 'rpc', tool: 'latestAnswer', text: 'The PROS/USD Chainlink-style feed prices WPROS and PROS; USDC counts as one dollar.' },
    { server: 'rpc', tool: 'eth_getCode', text: 'Tells a counterparty that is a smart contract from an ordinary wallet when no label is known.' },
    { server: 'local', tool: 'explain and summarize', text: 'Rule-based reasons for each move and a per-wallet summary. No model is guessing: every sentence is derived from the data.' },
  ],
  decisions: [
    { title: 'Significant is a setting, in two ways', text: 'A per-token amount, and optionally a dollar value. A move is reported if either is crossed. The recorded run scans the same blocks with default and stricter thresholds and gets 205 and 3 moves.' },
    { title: 'The watchlist was fixed before the scan', text: 'The recorded list is the eight busiest addresses by transfer count in the 5,000 blocks before the scan window, so it is not chosen with hindsight. Names are generic (Wallet B, Contract C): the agent does not invent identities. Add your own labels in the config.' },
    { title: 'Native PROS is a net balance change', text: 'Native transfers are not events. The agent reports the change of the balance over the range, which includes gas, and says so.' },
    { title: 'Balances are read twice', text: 'The public RPC is load-balanced and some nodes lag. A snapshot that two reads disagree about is read again, then refused.' },
    { title: 'Reasons come from data, not guesses', text: 'Share of holdings, internal move within the watchlist, mint or burn, known protocol, unlabelled contract or wallet. Anything the data cannot say is left out.' },
  ],
  evidence: [
    'The recorded run watches eight addresses on Pharos mainnet; the CLI and the Try tab accept any list.',
    'Thresholds are set per token (USDC, WPROS, PROS) and in dollars; the same blocks give 205 moves at 100 and 3 moves at 1,000 per token.',
    'Every report line names what moved, the amount and dollar value, and the counterparty with its label or kind, plus reasons; the biggest moves are re-read from mainnet when this page loads.',
    'The summary view lists, for every watched address, its significant moves, dollars in and out, position changes, and the overall biggest move.',
  ],
  files: ['agents/whale-watching-agent/pharos-whales.js', 'agents/whale-watching-agent/watchlist.example.json', 'lib/whales.js', 'lib/tasks/whale-watching-agent.js', 'scripts/whales-run.mjs', 'reports/whales-run.json'],
  run: {
    commands: [
      'node scripts/whales-run.mjs   # a pinned mainnet window, two threshold sets, writes reports/whales-run.json',
      'node agents/whale-watching-agent/pharos-whales.js --config agents/whale-watching-agent/watchlist.example.json --blocks 1000',
    ],
    sampleLabel: 'Output of node scripts/whales-run.mjs (Pharos mainnet, read-only):',
    sample: `window 21379547–21381546 (pinned; chain head was 21384546)
  default: 205 significant move(s), 5 position change(s), 6 of 8 wallets active
  strict: 3 significant move(s), 4 position change(s), 2 of 8 wallets active
wrote reports/whales-run.json: 205 moves at default thresholds, 3 at strict`,
  },
  verify: [
    { title: 'Open a move', text: 'The Run tab lists the biggest moves with their transaction links; each was just re-read from mainnet (token, amount, sender, receiver, block).' },
    { title: 'Watch your own list', text: 'On the Try tab, paste addresses, set thresholds and scan the latest blocks.' },
    { title: 'Run it', text: 'The CLI prints the explained report and the summary.', code: 'node agents/whale-watching-agent/pharos-whales.js --config agents/whale-watching-agent/watchlist.example.json --blocks 1000' },
    { title: 'Read the tests', text: 'Thresholds, explanations, position classification, summary and input validation run against a fake chain.', link: [`${REPO}/blob/main/test/whales.test.js`, 'test/whales.test.js'] },
  ],
};

const moveRow = (m, ver) => [esc(m.what), `<small>${esc(m.why.join(' ') || '—')}</small>`, num(m.block), ver ? (ver.results[m.key] ? (ver.results[m.key].verified ? pill('on-chain', 'ok') : pill('mismatch', 'bad')) : '') : '', `<a href="${esc(m.link)}" target="_blank" rel="noopener">tx</a>`];
const posRows = (positions) => positions.filter((p) => p.significant).map((p) => [esc(p.what), p.pct == null ? 'new' : `${p.pct > 0 ? '+' : ''}${p.pct}%`, p.note ? `<small>${esc(p.note)}</small>` : '']);
const walletRows = (s) => s.perWallet.map((w) => [esc(w.label), w.significantMoves, usd(w.inUsd), usd(w.outUsd), esc(w.positionChanges.join(', ') || '—'), w.active ? pill('active', 'ok') : pill('quiet', 'warn')]);

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>Watch your own list</h3>
    <p class="muted">Reads Pharos mainnet now (the newest blocks). Paste any addresses; thresholds are in whole tokens, the value rule is in dollars; leave one empty to ignore it.</p>
    <form data-form>
      <label>Addresses (one per line)<textarea name="addresses" rows="6" style="width:100%">${WATCH.join('\n')}</textarea></label>
      <div class="row"><label>USDC ≥<input name="usdc" value="100"></label><label>WPROS ≥<input name="wpros" value="100"></label><label>PROS (net) ≥<input name="pros" value="100"></label><label>or worth ≥ $<input name="usd" value="100"></label><label>Blocks<input name="blocks" type="number" min="10" max="2000" step="10" value="1000"></label>
      <button type="submit" class="chip">Scan</button></div></form>
    <div data-out><div class="idle">Press Scan.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    f.addresses = f.addresses.split(/\s+/).filter(Boolean).join(',');
    out.innerHTML = '<div class="idle">Scanning (several seconds)…</div>';
    try {
      const { data } = await api('run', { slug, scan: 1, ...f });
      const s = data.summary;
      out.innerHTML = `<p class="check ok"><b>${s.significantMoves} significant move(s)</b> and ${s.positionChanges} position change(s) in blocks ${num(s.window[0])}–${num(s.window[1])}; ${s.walletsActive} of ${s.watched} wallets active.${s.biggest ? ` Biggest: ${esc(s.biggest.what)}` : ''}</p>
        <h4 class="list-h">Summary by wallet</h4>${table(['Wallet', 'Moves', 'In', 'Out', 'Position changes', ''], walletRows(s))}
        ${data.moves.length ? `<h4 class="list-h">Moves (latest ${data.moves.length}${data.movesTotal > data.moves.length ? ` of ${data.movesTotal}` : ''})</h4>${table(['What', 'Why it matters', 'Block', '', ''], data.moves.map((m) => moveRow(m, null)))}` : ''}
        ${posRows(data.positions).length ? `<h4 class="list-h">Position changes</h4>${table(['Change', 'Size', ''], posRows(data.positions))}` : ''}`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded scan of Pharos mainnet, re-read from the chain</h3><div class="idle" data-role="body">Re-reading the biggest moves from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const [d, st] = run.runs;
    const top = [...d.moves].sort((a, b) => (BigInt(b.usd ?? 0) > BigInt(a.usd ?? 0) ? 1 : -1)).slice(0, 30);
    const ok = ver.verifiedCount === ver.total;
    body.innerHTML = `<p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} of the biggest moves match mainnet just now</b> (block ${num(ver.head)}). Blocks ${num(run.window[0])}–${num(run.window[1])}, recorded ${esc(run.recordedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
      <p class="muted">${esc(run.watchlistBasis)}.</p>
      <h4 class="list-h">“Significant” is a setting</h4>
      ${table(['Thresholds', 'Moves', 'Position changes', 'Wallets active'], [d, st].map((r) => [esc(r.title), r.summary.significantMoves, r.summary.positionChanges, `${r.summary.walletsActive} of ${r.summary.watched}`]))}
      <h4 class="list-h">Summary by wallet (default thresholds)</h4>${table(['Wallet', 'Moves', 'In', 'Out', 'Position changes', ''], walletRows(d.summary))}
      ${d.summary.biggest ? `<p class="muted">Biggest move: ${esc(d.summary.biggest.what)} · <a href="${esc(d.summary.biggest.link)}" target="_blank" rel="noopener">transaction</a></p>` : ''}
      <h4 class="list-h">The ${top.length} biggest moves, explained</h4>${table(['What', 'Why it matters', 'Block', 'Check', ''], top.map((m) => moveRow(m, ver)))}
      <h4 class="list-h">Position changes</h4>${table(['Change', 'Size', ''], posRows(d.positions))}`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
