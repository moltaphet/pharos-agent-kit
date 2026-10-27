// Task 22: an alert bot for Pharos mainnet that never sends the same event twice and never loses one.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const content = {
  tagline: 'Watches Pharos mainnet for the conditions you set and tells your channel once, with the value and a link.',
  tools: ['rpc'],
  story: [
    'You describe what matters in a small config file: a price crossing a threshold on a Chainlink-style feed, an ERC-20 transfer above an amount, an event emitted by a contract, or a call to a contract. The bot reads new blocks, finds the matching events and sends each one to Discord, Telegram, ntfy or a webhook.',
    'Every alert says what happened, the value and a Pharos explorer link. The same event is never sent to the same channel twice: each event has a key (transaction and log index), the bot remembers what it sent to which channel, and a price alert fires when the price crosses the threshold, not on every look while it stays there.',
    'If a channel is down, nothing is lost and nothing is spammed. The bot does not move past the blocks it could not deliver, tries again on the next poll, and sends only what that channel missed.',
  ],
  how: [
    { server: 'rpc', tool: 'eth_getLogs', text: 'ERC-20 Transfer logs and contract events, in windows of at most 1,000 blocks (the RPC limit).' },
    { server: 'rpc', tool: 'eth_call latestRoundData', text: 'The PROS/USD feed, sampled along the window. A reading older than an earlier sample is a stale node and is read again.' },
    { server: 'rpc', tool: 'eth_getBlockByNumber', text: 'For call conditions: the transactions of each block, filtered by target contract and method.' },
    { server: 'local', tool: 'dedup ledger', text: 'Event key + channel, saved to a state file, so a restart does not repeat anything.' },
    { server: 'local', tool: 'channel delivery', text: 'Discord webhook, Telegram Bot API, ntfy or a JSON webhook. Retries on 429 and 5xx; secrets never appear in logs or errors.' },
  ],
  decisions: [
    { title: 'Prices alert on a crossing', text: 'A price above 0.60 stays above 0.60 for hours. One alert when it becomes true; another only after it went back and crossed again.' },
    { title: 'The cursor moves only after every delivery succeeded', text: 'A failed delivery leaves the window open. The next poll scans it again and the ledger suppresses what already went out.' },
    { title: 'The public RPC can answer from a stale node', text: 'During this work one read of the feed returned an old round. A reading whose updatedAt is older than an earlier sample is re-read and skipped if still old; a change of side needs two agreeing reads.' },
    { title: 'Call conditions read whole blocks', text: 'The RPC cannot filter transactions by method, so a call condition costs one request per block and is limited to 300 blocks a cycle. Transfers and events use log filters and can cover 5,000.' },
    { title: 'Delivery proof is real HTTP; Discord itself needs your webhook', text: 'The recorded run delivers over real HTTP to Discord-style, ntfy and webhook endpoints on 127.0.0.1 and records each request. Sending to your Discord or Telegram needs your own webhook URL or bot token; none is stored in this repository.' },
  ],
  evidence: [
    'Four condition types (price crossing, large transfer, contract event, contract call) are configured from JSON; the recorded run uses five conditions on Pharos mainnet.',
    'The bot delivers by HTTP to Discord, Telegram, ntfy and webhook channels; the recorded run shows the exact requests received by Discord-style, ntfy and webhook endpoints.',
    'Each message carries what happened, the value, the block and an explorer link; the recorded alerts are re-read from mainnet when this page loads.',
    'Rescanning the same blocks, and restarting from the saved state, sent nothing twice; during a channel outage nothing was lost and the recovered channel got only what it missed.',
  ],
  files: ['agents/on-chain-alert-bot/pharos-alerts.js', 'agents/on-chain-alert-bot/alerts.example.json', 'lib/alerts.js', 'lib/tasks/on-chain-alert-bot.js', 'scripts/alerts-run.mjs', 'reports/alerts-run.json'],
  run: {
    commands: [
      'node scripts/alerts-run.mjs   # a pinned mainnet window, delivery over real HTTP to local receivers, five scenarios, writes reports/alerts-run.json',
      'node agents/on-chain-alert-bot/pharos-alerts.js --config agents/on-chain-alert-bot/alerts.example.json --dry-run --once --lookback 200',
      'DISCORD_WEBHOOK_URL=… node agents/on-chain-alert-bot/pharos-alerts.js --config alerts.json --state .alerts-state.json --interval 30',
    ],
    sampleLabel: 'Output of node scripts/alerts-run.mjs (Pharos mainnet, read-only):',
    sample: `  first-cycle: found 29 · delivered 87 · duplicates suppressed 0 · failed 0
  same-window-again: found 28 · delivered 0 · duplicates suppressed 84 · failed 0
  restart-from-state-file: found 28 · delivered 0 · duplicates suppressed 84 · failed 0
  channel-outage: found 25 · delivered 50 · duplicates suppressed 0 · failed 25
  channel-recovered: found 25 · delivered 25 · duplicates suppressed 50 · failed 0
  call-condition: found 3 · delivered 9 · duplicates suppressed 0 · failed 0`,
  },
  verify: [
    { title: 'Open an alert’s transaction', text: 'Every alert on the Run tab links to its transaction on pharosscan.xyz; the amount and the block are in the transaction’s logs.' },
    { title: 'Scan the latest blocks', text: 'Use the Try tab: it reads the newest blocks of mainnet with your threshold and shows the exact message, then scans again to show nothing would be sent twice.' },
    { title: 'Run it with your channel', text: 'Put your webhook in the environment and start the bot with a state file.', code: 'DISCORD_WEBHOOK_URL=… node agents/on-chain-alert-bot/pharos-alerts.js --config agents/on-chain-alert-bot/alerts.example.json --state .alerts-state.json --once' },
    { title: 'Read the tests', text: 'Conditions, scanning, formatting, dedup, outage and secret handling are covered with a fake chain and fake channels.', link: [`${REPO}/blob/main/test/alerts.test.js`, 'test/alerts.test.js'] },
  ],
};

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>Scan the latest blocks</h3>
    <p class="muted">Reads Pharos mainnet now. Shows the messages the bot would send, then scans the same blocks again to show that nothing would be repeated. Nothing is delivered from the web.</p>
    <form class="row" data-form>
      <label>Token<select name="token"><option>USDC</option><option>WPROS</option><option>LINK</option><option>WETH</option></select></label>
      <label>Transfer of at least<input name="min" value="1000" inputmode="decimal"></label>
      <label>PROS/USD above<input name="threshold" value="0.60" inputmode="decimal"></label>
      <label>Blocks to scan<input name="blocks" type="number" min="10" max="2000" step="10" value="500"></label>
      <button type="submit" class="chip">Scan</button></form>
    <div data-out><div class="idle">Press Scan.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    out.innerHTML = '<div class="idle">Reading blocks…</div>';
    try {
      const { data } = await api('run', { slug, scan: 1, ...f });
      out.innerHTML = `<p class="check ok"><b>${data.total} alert(s)</b> in blocks ${num(data.window[0])}–${num(data.window[1])}. Scanning the same blocks again: ${data.secondPass.found} found, <b>${data.secondPass.sent} sent</b>, ${data.secondPass.suppressed} suppressed as already sent.</p>` +
        (data.alerts.length ? data.alerts.map((a) => `<pre class="plain">${esc(a.text)}</pre>`).join('') : '<p class="muted">Nothing matched. Lower the amount or widen the window.</p>') +
        `<p class="muted">${esc(data.note)}</p>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded run on Pharos mainnet, re-read from the chain</h3><div class="idle" data-role="body">Re-reading every alert from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const ok = ver.verifiedCount === ver.total;
    const alertRows = [...run.alerts.sample, ...run.alerts.callSample].slice(0, 30).map((a) => {
      const hash = /^0x[0-9a-f]{64}/.exec(a.key)?.[0];
      return [esc(a.condition), esc(a.what), esc(a.value), num(a.block), hash ? (ver.results[a.key]?.verified ? pill('on-chain', 'ok') : pill('?', 'bad')) : pill('feed', 'warn'), `<a href="${esc(a.link)}" target="_blank" rel="noopener">link</a>`];
    });
    body.innerHTML = `<p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} alerted transactions found on mainnet just now</b> (block ${num(ver.head)}). Recorded ${esc(run.recordedAt.slice(0, 16).replace('T', ' '))} UTC at pinned block ${num(run.pinnedHead)}.</p>
      <h4 class="list-h">Five scenarios</h4>
      ${table(['Scenario', 'Blocks', 'Found', 'Delivered', 'Suppressed', 'Failed'], run.scenarios.map((s) => [esc(s.title), `${num(s.window[0])}–${num(s.window[1])}`, s.eventsFound, s.delivered, s.suppressedDuplicates, s.failed]))}
      <p class="check ${run.summary.duplicatesSentOnRescan === 0 && run.summary.outageLostNothing ? 'ok' : 'bad'}">${run.summary.duplicatesSentOnRescan} repeats on rescan and restart · outage lost nothing: ${run.summary.outageLostNothing ? 'yes' : 'NO'}</p>
      <h4 class="list-h">Alerts (first ${alertRows.length})</h4>
      ${table(['Condition', 'What', 'Value', 'Block', 'Check', 'Explorer'], alertRows)}
      <h4 class="list-h">What the receivers got (real HTTP)</h4>
      ${table(['Channel', 'Request', 'Answered', 'Body'], run.received.slice(0, 6).map((r) => [esc(r.channel), esc(`${r.method} ${r.path}`), r.answered, `<small>${esc((r.body ?? r.note ?? '').slice(0, 140))}</small>`]))}`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
