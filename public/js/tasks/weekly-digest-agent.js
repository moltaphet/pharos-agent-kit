// Task 28: a weekly summary of what changed on Pharos, delivered to a channel and published as a page.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const pct = (v) => (v == null ? '—' : Math.abs(v) >= 10 ? `×${num(Math.round(1 + v))}` : `${v > 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1)}%`);
const money = (v) => (v == null ? 'n/a' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`);
const when = (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export const content = {
  tagline: 'A weekly summary of what changed on Pharos: key numbers against the week before, the three things that stood out, delivered to your channel and published as a page.',
  tools: ['rpc'],
  story: [
    'Once a week (or every N days) the agent reads the chain for the period that just ended and the one before it: the PROS price, the USDC supply, the Morpho Blue syzUSD/USDC market, the four USDC vaults (value locked and the return their share price earned), and how busy the network was. Every number comes with the same number for the previous period and the change.',
    'It then picks the three things that stood out: a liquidation if there was one, the largest supply, borrow or withdrawal with its transaction, a big price move, deposits flowing into or out of a vault, a change in the size of the USDC supply. If the week was quiet it says what was steady instead, so there are always three.',
    'The digest goes to a real channel (Discord, Telegram, ntfy or a webhook) and is published as a page of this site. A schedule runs it: a Vercel cron every Monday at 08:00 UTC, or the CLI with --every. The same digest is never sent to the same channel twice.',
  ],
  how: [
    { server: 'rpc', tool: 'block lookup by date', text: 'The start and end of each period are found from block timestamps, with a few batched header reads.' },
    { server: 'rpc', tool: 'eth_call at sampled blocks', text: 'Price (latestRoundData), USDC totalSupply, Morpho market(), vault totalAssets and convertToAssets, read in JSON-RPC batches at the ends of each period and the price every six hours. The ends are read three times and a value must be agreed by two reads.' },
    { server: 'rpc', tool: 'eth_getLogs (full depth)', text: 'Every Supply, Withdraw, Borrow, Repay and Liquidate event of the Morpho syzUSD/USDC market in both periods, 1,000 blocks per request.' },
    { server: 'local', tool: 'choose three', text: 'Candidates are scored by how large they are against what they are measured against (a price move in percent, a deposit in percent of the market, a liquidation always first); three different kinds are kept, with at least one real event when there was one.' },
    { server: 'local', tool: 'deliver', text: 'Discord, Telegram, ntfy or webhook, once per digest and channel; or published as HTML and Markdown.' },
  ],
  decisions: [
    { title: 'Levels are compared at the end of each period, flows as totals', text: 'The price, the supply and the value locked are what they are at the end of the week; blocks and volumes are totals over it. The report says which is which.' },
    { title: 'Two guards against stale answers', text: 'The public RPC is load-balanced and some nodes answer from older state: a price whose updatedAt goes back is read again, and the first and last sample of each period are read three times and agreed by two. In building this, one such answer produced a false +49% price jump; the guards removed it.' },
    { title: 'No transaction totals', text: 'Pharos traffic comes in bursts: a total estimated from sampled blocks swung by a factor of two between runs. The digest reports the median block instead, and says it is a median of sampled blocks.' },
    { title: 'The scheduled run only reads and sends', text: 'The cron needs the project’s CRON_SECRET and at least one channel in the environment, and does nothing otherwise. Its depth is state-only because a serverless function has a minute; the CLI makes the full digest with the event logs.' },
    { title: 'Quiet weeks still have three', text: 'If nothing stands out, the digest states what stayed steady. An empty digest would not tell the reader whether nothing happened or the agent failed.' },
  ],
  evidence: [
    'The CLI runs on a schedule with --every (7 days by default, 1 to 31 configurable), and a Vercel cron runs it every Monday at 08:00 UTC; a state file stops the same period from being sent twice.',
    'Fourteen metrics are shown with the value for the previous period and the change: price, USDC supply, the Morpho market’s supply, borrow and utilisation, vault value locked and return, blocks, and the Morpho event volumes.',
    'The digest always lists three notable events, chosen by size against what they are measured against, with the transaction link when there is one; quiet weeks say what stayed steady.',
    'Delivery to Discord, Telegram, ntfy and webhook channels is recorded with the exact requests the receivers got, and a second run sent nothing; the digest is also published as a page at /digests/latest.html.',
  ],
  files: ['agents/weekly-digest-agent/pharos-digest.js', 'lib/digest.js', 'lib/digest-delivery.js', 'lib/rpc-batch.js', 'lib/tasks/weekly-digest-agent.js', 'scripts/digest-run.mjs', 'reports/digest-run.json', 'public/digests/latest.html', 'public/digests/latest.md', 'vercel.json'],
  run: {
    commands: [
      'node scripts/digest-run.mjs   # a full seven-day digest of mainnet, delivered twice to local receivers, published to public/digests/',
      'node agents/weekly-digest-agent/pharos-digest.js --days 7 --publish ./digest',
      'DISCORD_WEBHOOK_URL=… node agents/weekly-digest-agent/pharos-digest.js --deliver --every 7 --state digest-state.json   # weekly, to your channel',
    ],
    sampleLabel: 'Output of node scripts/digest-run.mjs:',
    sample: `building the digest (about 1–2 minutes) …
  built in 69 s: 14 metrics, 3 notable
wrote reports/digest-run.json: 14 metrics, 3 notable events; first delivery 3 messages, second 0 (3 skipped as already sent)`,
  },
  verify: [
    { title: 'Read the published digest', text: 'The digest this page records is published as a page of the site.', link: ['/digests/latest.html', 'digests/latest.html'] },
    { title: 'Check a number', text: 'The Run tab re-reads the recorded end-of-period figures and the notable transactions from the chain.', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "totalSupply()(uint256)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Make one now', text: 'The Try tab builds a digest of 1 to 14 days from the chain.' },
    { title: 'Read the tests', text: 'Periods, comparisons, the choice of three, the stale-read guards and the delivery once per channel run against a fake chain.', link: [`${REPO}/blob/main/test/digest.test.js`, 'test/digest.test.js'] },
  ],
};

function render(d, { ver = null } = {}) {
  return `<p class="check ok"><b>${esc(d.headline)}</b> · compared with ${esc(when(d.periods.previous.fromTime))} to ${esc(when(d.periods.previous.toTime))}</p>
    <h4 class="list-h">The three things that stood out</h4><ol>${d.notable.map((n) => `<li>${esc(n.text)} ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">transaction</a>` : ''}</li>`).join('')}</ol>
    <h4 class="list-h">Key numbers</h4>${table(['Metric', 'This period', 'Previous', 'Change'], d.metrics.map((m) => [`${esc(m.label)}${m.note ? `<br><small class="muted">${esc(m.note)}</small>` : ''}`, esc(m.text), esc(m.beforeText), pct(m.change)]))}
    <h4 class="list-h">The USDC vaults</h4>${table(['Vault', 'Value locked', 'Return this period', 'Return before'], d.vaults.map((v) => [esc(v.name), money(v.tvl), v.ret == null ? 'n/a' : `${(v.ret * 100).toFixed(3)}%`, v.retBefore == null ? 'n/a' : `${(v.retBefore * 100).toFixed(3)}%`]))}
    ${ver ? '' : ''}`;
}

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>Make a digest now</h3>
    <p class="muted">Reads Pharos mainnet for the last N days and the N before (state depth: about 20 to 30 seconds).</p>
    <form data-form class="row"><label>Days<input name="days" type="number" min="1" max="14" value="7"></label><button type="submit" class="chip">Make the digest</button></form>
    <div data-out><div class="idle">Press the button.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    out.innerHTML = '<div class="idle">Reading the chain…</div>';
    try { const { data } = await api('run', { slug, digest: 1, days: new FormData(e.target).get('days') }); out.innerHTML = render(data.digest) + `<p class="muted">${esc(data.note)}</p>`; } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded digest, re-read from the chain</h3><div class="idle" data-role="body">Re-reading the figures…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const dl = run.delivery;
    body.innerHTML = `<p class="check ${ver.verifiedCount === ver.total ? 'ok' : 'bad'}">${ver.verifiedCount === ver.total ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} recorded facts match the chain just now:</b> ${ver.checks.map((c) => esc(c.what) + (c.ok ? ' ✓' : ' ✗')).join(' · ')}.</p>
      ${render(run.digest)}
      <h4 class="list-h">Delivery (real HTTP to receivers on 127.0.0.1)</h4>
      ${table(['Run', 'Delivered to', 'Skipped (already sent)'], [['First', esc(dl.first.delivered.map((x) => x.channel).join(', ')), '—'], ['Second, same digest', esc(dl.second.delivered.map((x) => x.channel).join(', ') || 'nobody'), esc(dl.second.skipped.map((x) => x.channel).join(', '))]])}
      ${table(['Channel', 'Request', 'Body (start)'], dl.received.map((r) => [esc(r.channel), esc(`${r.method} ${r.path}`), `<small>${esc(r.body.slice(0, 150))}…</small>`]))}
      <p><a href="/digests/latest.html" target="_blank" rel="noopener">The digest as a published page</a> · schedule: Vercel cron <code>${esc(run.schedule.cron)}</code> (Mondays 08:00 UTC) or <code>${esc(run.schedule.cli)}</code></p>`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
