// Live demo panels for the tasks we've built. Each panel is render(root) -> cleanup().

import { EXPLORER_TX } from './meta.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const num = (n) => Number(n).toLocaleString('en-US');
const utc = (t) => new Date(t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

async function api(path, params) {
  const res = await fetch(`/api/${path}?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const PRESETS = [
  ['USDC', '0xc879c018db60520f4355c26ed1a6d572cdac1815'],
  ['WPROS', '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0'],
  ['LINK', '0x51e2a24742db77604b881d6781ee16b5b8fcbe29'],
  ['WETH', '0x1f4b7011ee3d53969bb67f59428a9ec0477856e9'],
];
const presetOptions = PRESETS.map(([n, a]) => `<option value="${a}">${n} · ${short(a)}</option>`).join('');

// ---------------------------------------------------------------- Read Contract State
function readPanel(root) {
  root.innerHTML = `
    <form class="row" id="f">
      <label>Contract
        <select id="preset">${presetOptions}<option value="">Custom address…</option></select>
      </label>
      <label class="grow">Address <input id="addr" spellcheck="false" value="${PRESETS[0][1]}"></label>
      <label class="grow">Holder to check <span class="opt">optional</span>
        <input id="holder" spellcheck="false" placeholder="0x… wallet whose balance to show">
      </label>
      <button class="primary" id="go">Read state</button>
    </form>
    <div id="out" class="out" aria-live="polite"></div>
    <p class="cli">CLI: <code>node bin/pharos-read.js ${PRESETS[0][1]}</code></p>`;
  const addr = $('#addr', root);
  $('#preset', root).onchange = (e) => e.target.value && (addr.value = e.target.value);

  $('#f', root).onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#out', root);
    const go = $('#go', root);
    go.disabled = true;
    out.innerHTML = '<p class="muted">Reading from Pharos through Chain MCP…</p>';
    try {
      const s = await api('read', { address: addr.value.trim(), holder: $('#holder', root).value.trim() });
      const unit = s.symbol ? ` ${esc(s.symbol)}` : '';
      const who = (a) => `${esc(a.description)} <code>${short(a.address)}</code>`;
      const rows = [
        ['name', esc(s.name ?? 'n/a')],
        ['symbol', esc(s.symbol ?? 'n/a')],
        ['decimals', s.decimals ?? 'n/a'],
        ['totalSupply', s.totalSupply ? `<b>${esc(s.totalSupply.formatted)}${unit}</b> <span class="muted">raw ${esc(s.totalSupply.raw)}</span>` : 'n/a'],
        ['owner', s.owner ? who(s.owner) : '<span class="muted">n/a (contract has no owner())</span>'],
        ...s.balances.map((b) => ['balanceOf', b.raw == null ? `${who(b)} → n/a` : `${who(b)} → <b>${esc(b.formatted)}${unit}</b>`]),
      ];
      out.innerHTML = `
        <div class="card">
          <div class="kv"><span>Contract</span><b>${esc([s.name, s.symbol && s.symbol !== s.name ? `(${s.symbol})` : ''].filter(Boolean).join(' ') || 'unnamed')}</b>
            <span>Address</span><code>${esc(s.contract)}</code>
            <span>Network</span><span>${esc(s.network.name)} · chain ${s.network.chainId}</span>
            <span>Read at</span><span>block <b>${num(s.block.number)}</b> · ${utc(s.block.timestamp)}</span>
            <span>Code size</span><span>${num(s.codeBytes)} bytes</span></div>
          <h4>Values read via Chain MCP <span class="muted">eth_call, all at that block</span></h4>
          <table class="tbl">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
        </div>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      go.disabled = false;
    }
  };
  $('#f', root).requestSubmit();
  return () => {};
}

// ---------------------------------------------------------------- Event / Log Monitor
function watchPanel(root) {
  root.innerHTML = `
    <form class="row" id="f">
      <label>Contract <select id="preset">${presetOptions}</select></label>
      <label>Event
        <select id="event"><option>Transfer</option><option>Approval</option><option>Deposit</option><option>Withdrawal</option></select>
      </label>
      <label>Start from
        <select id="start"><option value="0">Now (new events only)</option><option value="300">Last ~300 blocks</option></select>
      </label>
      <button class="primary" id="toggle">Start watching</button>
    </form>
    <p id="status" class="muted" aria-live="polite">Idle. Pick a contract and press start.</p>
    <div id="events" class="events"></div>
    <p class="cli">CLI: <code>node bin/pharos-watch.js --event Transfer</code></p>`;

  const POLL_MS = 4000;
  const MAX_ROWS = 120;
  let timer = null;
  let run = 0; // bumps on every start/stop so stale polls can't write after a stop
  const seen = new Set();
  let total = 0;

  const status = (msg, cls = '') => {
    const el = $('#status', root);
    el.textContent = msg;
    el.className = cls || 'muted';
  };
  const stop = () => {
    run++;
    clearTimeout(timer);
    timer = null;
    $('#toggle', root).textContent = 'Start watching';
  };

  function addEvents(events, labels) {
    const list = $('#events', root);
    const name = (a) => (labels[a] ? `${esc(labels[a])} <code>${short(a)}</code>` : `<code>${short(a)}</code>`);
    for (const ev of events) {
      const key = `${ev.txHash}:${ev.logIndex}`;
      if (seen.has(key)) continue; // never show the same log twice
      seen.add(key);
      total++;
      const amt = ev.amount ? `<b>${esc(ev.amount.formatted)}${ev.amount.symbol ? ' ' + esc(ev.amount.symbol) : ''}</b>` : ev.tokenId ? `tokenId ${esc(ev.tokenId)}` : '';
      const parties = ev.owner
        ? `${name(ev.owner)} → ${name(ev.spender)}`
        : [ev.from && name(ev.from), ev.to && name(ev.to)].filter(Boolean).join(' → ');
      const row = document.createElement('div');
      row.className = 'ev';
      row.innerHTML = `<span class="tag">${esc(ev.event)}</span><span class="who">${parties}</span><span class="amt">${amt}</span>
        <span class="meta">block ${num(ev.block)} · ${ev.timestamp ? utc(ev.timestamp).slice(11) : ''} · <a href="${EXPLORER_TX}${esc(ev.txHash)}" target="_blank" rel="noopener">${short(ev.txHash)} ↗</a> · log #${ev.logIndex}</span>`;
      list.prepend(row);
    }
    while (list.children.length > MAX_ROWS) list.lastChild.remove();
  }

  $('#f', root).onsubmit = async (e) => {
    e.preventDefault();
    if (timer) return stop(), status(`Stopped after ${total} event${total === 1 ? '' : 's'}.`);

    const me = ++run;
    const address = $('#preset', root).value;
    const event = $('#event', root).value;
    seen.clear();
    total = 0;
    $('#events', root).innerHTML = '';
    $('#toggle', root).textContent = 'Stop';
    timer = true;
    status('Connecting to Chain MCP…');

    let cursor;
    const tick = async () => {
      if (me !== run) return;
      try {
        const first = cursor == null; // the first request only learns the chain head
        const r = await api('logs', { address, event, ...(!first && { from: cursor }) });
        if (me !== run) return;
        if (first) cursor = Math.max(0, r.head + 1 - Number($('#start', root).value));
        else {
          addEvents(r.events, r.labels);
          cursor = r.nextFrom;
        }
        const sym = r.token?.symbol ?? 'contract';
        status(`Watching ${event} on ${sym} · chain head ${num(r.head)} · next block to scan ${num(cursor)} · ${total} event${total === 1 ? '' : 's'} so far`, 'ok');
        timer = setTimeout(tick, first ? 0 : POLL_MS);
      } catch (err) {
        if (me !== run) return;
        status(`${err.message} Retrying…`, 'error');
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    tick();
  };
  return stop;
}

// ---------------------------------------------------------------- Doc-Search
// Tiny, safe markdown: everything is escaped first, then a few constructs are re-enabled.
function md(src) {
  const blocks = [];
  let t = esc(src).replace(/```(\w*)\n([\s\S]*?)```/g, (_, __, code) => `\u0000${blocks.push(`<pre><code>${code.trim()}</code></pre>`) - 1}\u0000`);
  t = t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  for (const line of t.split('\n')) {
    const item = line.match(/^\s*(?:[*-]|\d+\.)\s+(.*)/);
    if (item) {
      list ??= [];
      list.push(`<li>${item[1]}</li>`);
      continue;
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`), (list = null);
    if (line.trim()) out.push(line.startsWith('\u0000') ? line : `<p>${line}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function docsPanel(root) {
  const examples = ['How do I deploy a contract?', 'What are the chain ID and RPC URL for Pharos mainnet?', 'How do I get testnet gas tokens?', 'What is the airspeed velocity of an unladen swallow?'];
  root.innerHTML = `
    <form class="row" id="f">
      <label class="grow">Question <input id="q" maxlength="300" placeholder="How do I deploy a contract?" autocomplete="off"></label>
      <button class="primary" id="go">Ask the docs</button>
    </form>
    <div class="chips">${examples.map((x) => `<button type="button" class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div id="out" class="out" aria-live="polite"></div>
    <p class="cli">CLI: <code>node bin/pharos-docs.js "how do I deploy a contract?"</code></p>`;

  async function ask(question) {
    const out = $('#out', root);
    const go = $('#go', root);
    go.disabled = true;
    out.innerHTML = '<p class="muted">Asking Developer Docs MCP…</p>';
    try {
      const r = await api('docs', { q: question });
      if (r.found) {
        out.innerHTML = `<div class="card answer">${md(r.answer)}<h4>Sources</h4><ol class="sources">${r.sources
          .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><span>${esc(s.url)}</span></li>`)
          .join('')}</ol></div>`;
      } else {
        out.innerHTML = `<div class="card none"><h4>No good answer found in the Pharos docs</h4>
          <p>Nothing in the docs answers “${esc(question)}”. Try rephrasing with a product, tool or network name.</p>
          ${r.related.length ? `<p class="muted">Closest pages (related, not an answer):</p><ul>${r.related.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>` : ''}</div>`;
      }
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      go.disabled = false;
    }
  }
  $('#f', root).onsubmit = (e) => {
    e.preventDefault();
    const q = $('#q', root).value.trim();
    if (q) ask(q);
  };
  root.querySelectorAll('.chip').forEach((b) => (b.onclick = () => (($('#q', root).value = b.dataset.q), ask(b.dataset.q))));
  return () => {};
}

export const PANELS = {
  'read-contract-state': readPanel,
  'event-log-monitor': watchPanel,
  'doc-search-cli': docsPanel,
};
