// Live panel: Event/Log Monitor. The browser polls /api/logs; the server does the
// MCP work and returns a trace, which this panel files into the run log.
import { $, api, clock, copyText, esc, num, shareUrl, short, utc } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';
import { EXPLORER } from '../content.js';
import { PRESETS } from './read.js';

const POLL_MS = 4000;
const OVERLAP = 2; // re-read this many blocks each poll; de-duplication makes it harmless
const MAX_ROWS = 150;

export default function mount(root, { slug, params }) {
  root.innerHTML = `
    <form class="form" id="f" autocomplete="off">
      <label>Contract
        <select id="preset">${PRESETS.map(([n, a]) => `<option value="${a}">${n} · ${short(a)}</option>`).join('')}<option value="">Custom address…</option></select>
      </label>
      <label class="grow">Contract address <input id="addr" spellcheck="false" required pattern="0x[0-9a-fA-F]{40}"></label>
      <label>Event
        <select id="event"><option>Transfer</option><option>Approval</option><option>Deposit</option><option>Withdrawal</option></select>
      </label>
      <label>Start from
        <select id="start"><option value="0">Now (new events only)</option><option value="300">The last ~300 blocks</option></select>
      </label>
      <div class="actions">
        <button class="primary" id="toggle">${ICONS.play} Start watching</button>
        <button class="ghost" type="button" id="share">${ICONS.link} Copy link</button>
      </div>
    </form>
    <div class="statstrip" id="stats" aria-live="polite">
      <div><b data-k="polls">0</b><span>polls</span></div>
      <div><b data-k="events">0</b><span>new events</span></div>
      <div><b data-k="dupes">0</b><span>duplicates suppressed</span></div>
      <div><b data-k="head">–</b><span>chain head</span></div>
      <div><b data-k="cursor">–</b><span>next block to scan</span></div>
      <div><b data-k="last">–</b><span>last poll</span></div>
    </div>
    <p id="status" class="status muted" aria-live="polite">Idle. Choose a contract and press start.</p>
    <h4 class="list-h">Events <span class="muted">newest first</span></h4>
    <div id="events" class="events"><div class="idle">Nothing yet.</div></div>
    <div id="log"></div>`;

  const addrEl = $('#addr', root);
  const presetEl = $('#preset', root);
  const eventEl = $('#event', root);
  const startEl = $('#start', root);
  const toggle = $('#toggle', root);
  const log = createRunLog($('#log', root), { task: slug });

  addrEl.value = params.address || PRESETS[0][1];
  presetEl.value = PRESETS.some(([, a]) => a === addrEl.value) ? addrEl.value : '';
  if (params.event && [...eventEl.options].some((o) => o.value === params.event)) eventEl.value = params.event;
  if (params.back === '300') startEl.value = '300';
  presetEl.onchange = () => presetEl.value && (addrEl.value = presetEl.value);
  addrEl.oninput = () => (presetEl.value = PRESETS.some(([, a]) => a === addrEl.value.trim().toLowerCase()) ? addrEl.value.trim().toLowerCase() : '');
  $('#share', root).onclick = () => copyText(shareUrl(slug, { address: addrEl.value.trim().toLowerCase(), event: eventEl.value, back: startEl.value }), 'Link copied. It starts this watch when opened');

  // ---- state for the current watch
  let session = 0; // bumps on start and stop so a late response can't write after a stop
  let timer = null;
  let cursor = null;
  let floor = 0;
  let sym = 'contract';
  const stats = { polls: 0, events: 0, dupes: 0, head: null, last: null };
  const seen = new Set();
  const setStat = (k, v) => ($(`[data-k=${k}]`, root).textContent = v);
  const refreshStats = () => {
    setStat('polls', stats.polls);
    setStat('events', stats.events);
    setStat('dupes', stats.dupes);
    setStat('head', stats.head == null ? '–' : num(stats.head));
    setStat('cursor', cursor == null ? '–' : num(cursor));
    setStat('last', stats.last == null ? '–' : `${stats.last} ms`);
  };
  const status = (msg, cls = 'muted') => {
    const el = $('#status', root);
    el.textContent = msg;
    el.className = `status ${cls}`;
  };

  const eventsEl = $('#events', root);
  function addRow(ev, labels) {
    const name = (a) => (labels[a] ? `${esc(labels[a])} <code>${short(a)}</code>` : `<code>${short(a)}</code>`);
    const amt = ev.amount ? `<b>${esc(ev.amount.formatted)}${ev.amount.symbol ? ' ' + esc(ev.amount.symbol) : ''}</b>` : ev.tokenId ? `tokenId ${esc(ev.tokenId)}` : '';
    const parties = ev.owner ? `${name(ev.owner)} → ${name(ev.spender)}` : [ev.from && name(ev.from), ev.to && name(ev.to)].filter(Boolean).join(' → ');
    const row = document.createElement('div');
    row.className = 'ev';
    row.innerHTML = `<span class="tag">${esc(ev.event)}</span><span class="who">${parties}</span><span class="amt">${amt}</span>
      <span class="meta">block ${num(ev.block)} · ${ev.timestamp ? utc(ev.timestamp).slice(11) : ''} · log #${ev.logIndex} · <a href="${EXPLORER}/tx/${esc(ev.txHash)}" target="_blank" rel="noopener">${short(ev.txHash)} ↗</a></span>`;
    if (!eventsEl.querySelector('.ev')) eventsEl.innerHTML = '';
    eventsEl.prepend(row);
    while (eventsEl.children.length > MAX_ROWS) eventsEl.lastChild.remove();
  }
  const describe = (ev, labels) => {
    const n = (a) => labels[a] ?? short(a);
    const amt = ev.amount ? `${ev.amount.formatted}${ev.amount.symbol ? ' ' + ev.amount.symbol : ''}` : ev.tokenId ? `tokenId ${ev.tokenId}` : '';
    return `${ev.event} ${ev.owner ? `${n(ev.owner)} → ${n(ev.spender)}` : [ev.from && n(ev.from), ev.to && n(ev.to)].filter(Boolean).join(' → ')} ${amt}`.trim();
  };

  function stop(why = 'Stopped.') {
    if (!timer) return;
    session++;
    clearTimeout(timer);
    timer = null;
    toggle.innerHTML = `${ICONS.play} Start watching`;
    status(`${why} ${stats.events} event${stats.events === 1 ? '' : 's'} shown, ${stats.dupes} duplicate${stats.dupes === 1 ? '' : 's'} suppressed.`);
    const r = log.run('Stopped by you', { open: false });
    r.add({ kind: 'ui', title: 'Watching stopped', lines: [['polls made', stats.polls], ['new events shown', stats.events], ['duplicates suppressed', stats.dupes], ['last block scanned', cursor == null ? 'n/a' : num(cursor - 1)]] });
    r.end({ status: 'ok', summary: `${stats.polls} polls, ${stats.events} events` });
  }

  async function tick(me, address, event) {
    if (me !== session) return;
    const first = cursor == null;
    const r = log.run(first ? `Start: ${event} on ${sym === 'contract' ? short(address) : sym}` : `Poll #${stats.polls + 1}`, { open: first });
    const from = first ? undefined : Math.max(floor, cursor - OVERLAP);
    r.add({ kind: 'ui', title: first ? 'Learn the chain head' : `Scan from block ${num(from)} (cursor ${num(cursor)} minus ${OVERLAP}-block overlap)`, request: { address, event, from } });
    const sent = r.now();
    try {
      const res = await api('logs', { address, event, from });
      if (me !== session) return r.end({ status: 'ok', summary: 'discarded: watch was stopped' });
      const d = res.data;
      r.add({ kind: 'http', title: `GET /api/logs answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
      r.addTrace(res.trace, sent);
      stats.head = d.head;
      stats.last = res.ms;
      sym = d.token?.symbol ?? sym;

      if (first) {
        floor = cursor = Math.max(0, d.head + 1 - Number(startEl.value));
        r.add({
          kind: 'decision',
          at: sent + res.ms,
          title: 'Starting point chosen',
          lines: [['chain head', num(d.head)], ['first block to scan', num(cursor)], ['why', Number(startEl.value) ? `back-fill the last ~${startEl.value} blocks, then keep watching` : 'only events after now']],
        });
        refreshStats();
        status(`Watching ${event} on ${sym}. First block to scan: ${num(cursor)}.`, 'ok');
        r.end({ status: 'ok', summary: `head ${num(d.head)} · will scan from ${num(cursor)}` });
        timer = setTimeout(() => tick(me, address, event), 0);
        return;
      }

      stats.polls++;
      const fresh = [];
      let dupes = 0;
      for (const ev of d.events) {
        const key = `${ev.txHash}:${ev.logIndex}`;
        if (seen.has(key)) dupes++;
        else {
          seen.add(key);
          fresh.push(ev);
        }
      }
      stats.events += fresh.length;
      stats.dupes += dupes;
      fresh.forEach((ev) => addRow(ev, d.labels));
      for (const ev of fresh.slice(0, 12)) {
        r.add({
          kind: 'result',
          at: sent + res.ms,
          title: `New: ${describe(ev, d.labels)}`,
          lines: [['block', num(ev.block)], ['transaction', ev.txHash], ['log index', ev.logIndex], ['time', ev.timestamp ? utc(ev.timestamp) : 'n/a']],
        });
      }
      if (fresh.length > 12) r.add({ kind: 'result', at: sent + res.ms, title: `…and ${fresh.length - 12} more new events (all listed above)` });
      if (dupes) {
        r.add({
          kind: 'decision',
          at: sent + res.ms,
          title: `Suppressed ${dupes} duplicate${dupes === 1 ? '' : 's'}`,
          detail: `These logs fell inside the ${OVERLAP}-block overlap and were already shown. They are recognised by transaction hash + log index and dropped, so each event appears once.`,
        });
      }
      if (d.clamped) r.add({ kind: 'decision', at: sent + res.ms, title: 'Fell too far behind; skipped ahead', detail: `The scan start was moved forward to ${num(d.scanned.from)}: one request never reads more than 5,000 blocks.` });
      cursor = d.nextFrom;
      refreshStats();
      status(`Watching ${event} on ${sym} · chain head ${num(d.head)} · ${stats.events} new event${stats.events === 1 ? '' : 's'} so far`, 'ok');
      r.end({ status: 'ok', summary: `blocks ${num(d.scanned.from)}–${num(d.scanned.to)} · ${fresh.length} new${dupes ? ` · ${dupes} duplicate` : ''}` });
      timer = setTimeout(() => tick(me, address, event), POLL_MS);
    } catch (err) {
      if (me !== session) return r.end({ status: 'ok', summary: 'discarded: watch was stopped' });
      if (err.trace) r.addTrace(err.trace, sent);
      r.add({ kind: 'error', title: err.message, error: err.detail ?? err.message, at: sent + (err.ms ?? 0) });
      r.end({ status: 'error', summary: `${err.message}; retrying the same blocks` });
      status(`${err.message} Retrying…`, 'bad');
      timer = setTimeout(() => tick(me, address, event), POLL_MS * 2); // cursor untouched: nothing is skipped
    }
  }

  function start() {
    const address = addrEl.value.trim().toLowerCase();
    const event = eventEl.value;
    stop('Restarting.');
    session++;
    const me = session;
    cursor = null;
    floor = 0;
    sym = PRESETS.find(([, a]) => a === address)?.[0] ?? 'contract';
    Object.assign(stats, { polls: 0, events: 0, dupes: 0, head: null, last: null });
    seen.clear();
    eventsEl.innerHTML = '<div class="idle">Waiting for the first event…</div>';
    refreshStats();
    toggle.innerHTML = `${ICONS.check} Stop`;
    status('Connecting to Chain MCP…');
    timer = setTimeout(() => tick(me, address, event), 0);
  }

  $('#f', root).onsubmit = (e) => {
    e.preventDefault();
    if (timer) stop();
    else start();
  };
  if (params.run === '1') start();
  return () => {
    session++;
    clearTimeout(timer);
    timer = null;
  };
}
