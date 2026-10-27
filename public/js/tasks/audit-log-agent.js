// Task 26: a plain-language activity report for a wallet, ready for an accountant.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const usd = (v) => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const when = (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19);
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const content = {
  tagline: 'Turns a wallet’s on-chain activity over a date range into a report an accountant or compliance officer can read.',
  tools: ['rpc'],
  story: [
    'Give the agent a wallet and a start and end date. It finds the blocks that cover the period, reads the wallet’s token transfers and approvals from the chain, looks at every transaction behind them, and sorts what happened into four groups: transfers in and out, swaps, approvals, and contract interactions.',
    'The report states, in sentences and tables, how many events there were in each group and what they were worth in dollars where a price exists, lists the notable transactions (the largest movements, unlimited approvals, tokens outside the registry, failed transactions) each with an explorer link, and says what it could not see. It exports as Markdown, CSV and PDF.',
    'The node has one per-address index: token logs filtered on the wallet. Plain PROS transfers and calls that touch none of the wallet’s tokens are not in it. The report counts them from the wallet’s transaction counter and says so, instead of pretending to a complete list.',
  ],
  how: [
    { server: 'rpc', tool: 'eth_getBlockByNumber (binary search)', text: 'Turns the start and end of the date range into block numbers by searching block timestamps.' },
    { server: 'rpc', tool: 'eth_getLogs in batches', text: 'Transfer (from the wallet, to the wallet) and Approval (by the wallet) logs, one window of 1,000 blocks per request, sent 40 requests to a batch.' },
    { server: 'rpc', tool: 'transaction and receipt', text: 'Every distinct transaction: who sent it, to what, which method, what it cost, whether it failed, and its logs.' },
    { server: 'local', tool: 'classify', text: 'A swap is a transaction in which the wallet gives one token and receives another (or that carries a swap event); an approval is an Approval log; a call the wallet sent to a non-token contract is a contract interaction; the rest are transfers.' },
    { server: 'rpc', tool: 'balances and counters', text: 'PROS balance and transaction count at both ends, the PROS/USD feed at the end, for the fee total and the list of what could not be seen.' },
  ],
  decisions: [
    { title: 'Only what the node can index is listed, and the rest is counted', text: 'A plain PROS transfer leaves no log. The wallet’s nonce says how many transactions it sent; the report lists those that touched its tokens and states how many others there were.' },
    { title: 'Dollar values use two prices', text: 'USDC is one dollar. PROS and WPROS use the PROS/USD feed at the end of the period. Every other token is shown without a price rather than with a guess.' },
    { title: 'Reports for a few days, not a year', text: 'The node returns 1,000 blocks per log request, so a day is about 95 windows. The CLI covers up to 7 days; the web covers 12 hours because it must answer within a minute.' },
    { title: 'The CSV cannot run code', text: 'A cell that begins with =, +, - or @ is prefixed so a spreadsheet shows it instead of evaluating it.' },
    { title: 'The PDF is made by hand', text: 'A plain text PDF written by the repository itself, with no library, checked for a valid cross-reference table. It is for reading and filing; the CSV is for working with the numbers.' },
  ],
  evidence: [
    'The report takes any wallet address and a start and end date or time (UTC); the recorded reports cover one whole day, and the Try tab takes any range up to 12 hours.',
    'Events are grouped into transfers in, transfers out, swaps, approvals and contract interactions; across the three recorded wallets all of them occur.',
    'Each report has totals per category (counts and dollar values), per-token transfer totals, and notable transactions with explorer links that are re-read from mainnet when this page loads.',
    'Each report is exported as Markdown, CSV and PDF; the downloads on this page are generated from the same data.',
  ],
  files: ['agents/audit-log-agent/pharos-audit.js', 'lib/auditlog.js', 'lib/rpc-batch.js', 'lib/tasks/audit-log-agent.js', 'scripts/auditlog-run.mjs', 'reports/auditlog-run.json', 'reports/auditlog/wallet-a.md', 'reports/auditlog/wallet-a.csv', 'reports/auditlog/wallet-a.pdf'],
  run: {
    commands: [
      'node scripts/auditlog-run.mjs 2026-10-26   # three real wallets, one whole UTC day, writes the reports in reports/auditlog/',
      'node agents/audit-log-agent/pharos-audit.js 0x16797a0f3f0dbbf3a9d2dfb66c9c4a5a61e9cb76 --from 2026-10-26 --to 2026-10-26 --format pdf --out report.pdf',
    ],
    sampleLabel: 'Output of node scripts/auditlog-run.mjs 2026-10-26:',
    sample: `period 2026-10-26 00:00:00 UTC – 2026-10-26 23:59:59 UTC: blocks 21261543–21355420 (93,878)
  transfer 2 · swap 33 · approval 17 · contract interaction 0
  transfer 1 · swap 0 · approval 0 · contract interaction 0
  transfer 0 · swap 5 · approval 5 · contract interaction 1`,
  },
  verify: [
    { title: 'Open a notable transaction', text: 'Each report links its notable transactions to the explorer; the amounts and the wallet are in the logs.' },
    { title: 'Download the files', text: 'On the Run tab, each recorded wallet has its Markdown, CSV and PDF.' },
    { title: 'Run it for your wallet', text: 'The CLI covers up to 7 days.', code: 'node agents/audit-log-agent/pharos-audit.js 0x… --from 2026-10-20 --to 2026-10-26 --format md' },
    { title: 'Read the tests', text: 'Dates, classification, totals, the CSV’s formula guard and the PDF’s structure run against a fake chain.', link: [`${REPO}/blob/main/test/auditlog.test.js`, 'test/auditlog.test.js'] },
  ],
};

function download(name, mime, data, base64) {
  const bytes = base64 ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderReport(r, { ver = null, slug, id = null, wallet = null, range = null } = {}) {
  const t = r.totals;
  const notable = r.notable.map((n) => [esc(n.summary), `<small>${esc(n.why)}</small>`, when(n.time), ver ? (ver.results.find((x) => x.hash === n.hash)?.verified ? pill('on-chain', 'ok') : '') : '', `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(short(n.hash))}</a>`]);
  const cat = (name, key) => { const e = r.events.filter((x) => x.category === key); return e.length ? `<h4 class="list-h">${name} (${e.length})</h4>${table(['Time (UTC)', 'What happened', 'Value', ''], e.slice(0, 40).map((x) => [when(x.time), esc(x.summary + (x.failed ? ' (FAILED)' : '')), usd(x.usd), `<a href="${esc(x.link)}" target="_blank" rel="noopener">tx</a>`]))}${e.length > 40 ? `<p class="muted">First 40 of ${e.length}; the exports have all of them.</p>` : ''}` : ''; };
  return `<p class="check ok"><b>${esc(r.walletLabel ?? short(r.wallet))}</b> · blocks ${num(r.fromBlock)}–${num(r.toBlock)} · ${esc(when(r.fromTime))} to ${esc(when(r.toTime))} UTC</p>
    ${table(['Category', 'Events', 'Value'], [['Transfers in', t.transfer.in.count, usd(t.transfer.in.usd)], ['Transfers out', t.transfer.out.count, usd(t.transfer.out.usd)], ['Swaps', t.swap.count, usd(t.swap.usd)], ['Approvals', t.approval.count, `${t.approval.unlimited} unlimited, ${t.approval.revoked} revoked`], ['Contract interactions', t['contract interaction'].count, '']])}
    <p class="muted">PROS balance ${num(Number(BigInt(r.native.balanceStart)) / 1e18)} → ${num(Number(BigInt(r.native.balanceEnd)) / 1e18)} · ${r.native.sentTransactions} transactions sent, ${r.native.sentWithTokenActivity} of them involving its tokens · fees on those: ${(Number(BigInt(r.native.feesPaidWei)) / 1e18).toFixed(6)} PROS</p>
    ${notable.length ? `<h4 class="list-h">Notable transactions</h4>${table(['What', 'Why it is notable', 'When', '', 'Link'], notable)}` : ''}
    ${cat('Transfers', 'transfer')}${cat('Swaps', 'swap')}${cat('Approvals', 'approval')}${cat('Contract interactions', 'contract interaction')}
    ${r.notes.map((n) => `<p class="muted">• ${esc(n)}</p>`).join('')}
    <p>${['md', 'csv', 'pdf'].map((f) => `<button type="button" class="chip" data-dl="${f}" ${id ? `data-id="${esc(id)}"` : ''}>Download ${f.toUpperCase()}</button>`).join(' ')}</p>`;
}

// `live` holds the exports that came with a live report; a recorded report's files are fetched by id
function wireDownloads(el, slug, live = null) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    b.disabled = true;
    try {
      const x = live?.() ? live()[b.dataset.dl] : (await api('run', { slug, id: b.dataset.id, export: b.dataset.dl })).data;
      download(x.filename, x.mime, x.text ?? x.base64, Boolean(x.base64));
    } catch (err) { b.insertAdjacentHTML('afterend', ` <span class="error">${esc(err.message)}</span>`); } finally { b.disabled = false; }
  });
}

function mountTry(el, slug) {
  const day = new Date(Date.now() - 18 * 3600e3).toISOString().slice(0, 10);
  el.innerHTML = `<section class="card tn"><h3>Report for any wallet</h3>
    <p class="muted">Reads Pharos mainnet now. Dates are UTC; the web covers up to 12 hours (the CLI up to 7 days). It takes up to a minute.</p>
    <form data-form><div class="row"><label style="flex:1">Wallet<input name="wallet" style="width:100%" value="0x1159105d91825b0615c9fbe23c2055676676f96d"></label>
      <label>From (UTC)<input name="from" value="${day}T06:00"></label><label>To (UTC)<input name="to" value="${day}T18:00"></label><button type="submit" class="chip">Create report</button></div></form>
    <div data-out><div class="idle">Press Create report.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  let exports = null;
  wireDownloads(out, slug, () => exports);
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    exports = null;
    out.innerHTML = '<div class="idle">Reading the chain…</div>';
    try { const { data } = await api('run', { slug, report: 1, ...f }); exports = data.exports; out.innerHTML = renderReport(data.report, { slug }) + `<p class="muted">${esc(data.note)}</p>`; } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded reports: three real wallets, one whole day</h3><div class="idle" data-role="body">Re-reading the notable transactions from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    body.innerHTML = `<p class="check ${ver.verifiedCount === ver.total ? 'ok' : 'bad'}">${ver.verifiedCount === ver.total ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} notable transactions match mainnet just now.</b> Period ${esc(run.range.requested.from)} to ${esc(run.range.requested.to)} (${num(run.range.blocks)} blocks).</p>` +
      run.wallets.map((w) => `<details open><summary><b>${esc(w.title)}</b> · <code>${esc(short(w.address))}</code></summary><div data-w="${esc(w.id)}">${renderReport(w.report, { ver, slug, id: w.id })}</div></details>`).join('');
    wireDownloads(body, slug);
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
