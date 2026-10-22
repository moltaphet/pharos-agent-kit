// The run log: a precise, expandable record of everything a run did. Server calls
// (MCP and RPC) come straight from the API's trace with tool, arguments, the raw
// response and timing; the page adds its own steps (what you asked, how values were
// decoded, what was decided). Nothing here is invented: each entry is data.

import { $, $$, clock, copyText, dur, esc, toast } from './util.js';
import { ICONS } from './art.js';

const BADGE = { mcp: 'MCP', rpc: 'RPC', session: 'Session', retry: 'Retry', ui: 'You', http: 'HTTP', decode: 'Decode', decision: 'Decision', result: 'Result', error: 'Error' };
const SERVER = { chain: 'Chain MCP', docs: 'Docs MCP' };

const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

// What a reader could paste into a terminal to repeat this exact call.
export function reproduce(e) {
  if (e.kind === 'rpc') {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: e.tool, params: e.args });
    return `curl -s https://${e.server} -H 'content-type: application/json' \\\n  -d '${body.replace(/'/g, `'\\''`)}'`;
  }
  if (e.kind === 'mcp') {
    const url = e.server === 'docs' ? 'PHAROS_DOCS_MCP' : 'PHAROS_CHAIN_MCP';
    return `node --input-type=module <<'EOF'\nimport { McpClient, ${url} } from './lib/mcp.js';\nconst client = new McpClient(${url});\nconsole.log(JSON.stringify(await client.callTool('${e.tool}', ${JSON.stringify(e.args)}), null, 2));\nawait client.close();\nEOF`;
  }
  return null;
}

const block = (label, text, { note, id } = {}) => `
  <div class="blk" ${id ? `data-id="${id}"` : ''}>
    <div class="blk-h"><span>${esc(label)}</span><button type="button" class="mini" data-copy="${esc(text)}">Copy</button></div>
    <pre>${esc(text)}</pre>${note ? `<p class="blk-note">${esc(note)}</p>` : ''}
  </div>`;

function titleOf(e) {
  if (e.kind === 'mcp') return `${SERVER[e.server] ?? e.server} · ${e.tool}`;
  if (e.kind === 'rpc') return `${e.server} · ${e.tool}`;
  if (e.kind === 'session') return `${SERVER[e.server] ?? e.server} session: ${e.action}`;
  return e.title ?? e.kind;
}

function bodyOf(e) {
  const parts = [];
  if (e.why) parts.push(`<p class="why">${esc(e.why)}</p>`);
  if (e.detail) parts.push(`<p>${esc(e.detail)}</p>`);
  if (e.lines?.length) parts.push(`<dl class="lines">${e.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
  if (e.kind === 'mcp' || e.kind === 'rpc') {
    parts.push(block('Request', pretty(e.kind === 'mcp' ? { server: SERVER[e.server] ?? e.server, tool: e.tool, arguments: e.args } : { method: e.tool, params: e.args })));
    if (e.error) parts.push(block('Error', e.error));
    else if (e.result) parts.push(block('Response', e.result.text, { note: e.result.truncated ? `Shown truncated: ${e.result.size.toLocaleString('en-US')} characters in total.` : undefined }));
    const repro = reproduce(e);
    if (repro) parts.push(block('Reproduce', repro));
  }
  if (e.request) parts.push(block('Request', pretty(e.request)));
  if (e.response) parts.push(block('Response', pretty(e.response)));
  if (e.kind === 'error' && e.error) parts.push(block('Error', e.error));
  return parts.join('') || '<p class="muted">No further detail.</p>';
}

export function createRunLog(root, { task }) {
  const runs = [];
  root.classList.add('log');
  root.innerHTML = `
    <div class="log-head">
      <div><h3>Run log</h3><p class="log-sub">Every step of every run, in order. Expand a row for the exact request and the raw response.</p></div>
      <div class="log-tools">
        <label class="sr-only" for="lf-${task}">Filter log entries</label>
        <select id="lf-${task}" data-role="filter">
          <option value="all">All steps</option><option value="calls">Server calls only</option><option value="errors">Errors only</option>
        </select>
        <button type="button" class="mini" data-role="expand">Expand all</button>
        <button type="button" class="mini" data-role="collapse">Collapse all</button>
        <button type="button" class="mini" data-role="copy">Copy JSON</button>
        <button type="button" class="mini" data-role="download">${ICONS.download} Download</button>
        <button type="button" class="mini" data-role="clear">Clear</button>
      </div>
    </div>
    <p class="log-stats" data-role="stats" aria-live="polite"></p>
    <p class="log-empty" data-role="empty">Nothing yet. Run the task above and every step will appear here.</p>
    <ol class="runs" data-filter="all"></ol>`;
  const list = $('.runs', root);

  const counts = () => {
    let calls = 0;
    let errors = 0;
    for (const r of runs) {
      for (const e of r.entries) {
        if (e.kind === 'mcp' || e.kind === 'rpc') calls++;
        if (e.ok === false || e.kind === 'error') errors++;
      }
    }
    return { calls, errors };
  };
  const refresh = () => {
    const { calls, errors } = counts();
    $('[data-role=stats]', root).textContent = runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'} · ${calls} server call${calls === 1 ? '' : 's'} · ${errors} error${errors === 1 ? '' : 's'}` : '';
    $('[data-role=empty]', root).hidden = runs.length > 0;
  };

  const exportJson = () => ({
    task,
    exportedAt: new Date().toISOString(),
    note: 'Times are milliseconds from the start of each run. Responses are truncated to 3,000 characters.',
    runs: runs.map((r) => ({ title: r.title, startedAt: r.startedAt.toISOString(), status: r.status, summary: r.summary, ms: r.ms, entries: r.entries.map(({ node, ...e }) => e) })),
  });

  root.addEventListener('click', async (ev) => {
    const copy = ev.target.closest('[data-copy]');
    if (copy) return void copyText(copy.dataset.copy);
    const role = ev.target.closest('[data-role]')?.dataset.role;
    if (role === 'expand' || role === 'collapse') $$('details', list).forEach((d) => (d.open = role === 'expand'));
    if (role === 'clear') {
      runs.length = 0;
      list.innerHTML = '';
      refresh();
    }
    if (role === 'copy') await copyText(JSON.stringify(exportJson(), null, 2), 'Log copied as JSON');
    if (role === 'download') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(exportJson(), null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `${task}-log-${Date.now()}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Log downloaded');
    }
  });
  $('[data-role=filter]', root).onchange = (ev) => (list.dataset.filter = ev.target.value);

  function entryNode(e) {
    const li = document.createElement('li');
    li.className = `entry k-${e.kind}${e.ok === false || e.kind === 'error' ? ' is-error' : ''}`;
    li.innerHTML = `<details><summary>
        <span class="t">+${Math.round(e.at)} ms</span>
        <span class="badge">${BADGE[e.kind] ?? e.kind}</span>
        <span class="title">${esc(titleOf(e))}${e.why ? `<span class="why-inline"> ${esc(e.why)}</span>` : ''}</span>
        <span class="wf" aria-hidden="true"><i></i></span>
        <span class="d">${e.ms != null ? dur(e.ms) : ''}</span>
      </summary><div class="body">${bodyOf(e)}</div></details>`;
    return li;
  }

  function layoutBars(run) {
    const timed = run.entries.filter((e) => e.ms != null);
    const total = Math.max(run.ms ?? 0, ...timed.map((e) => e.at + e.ms), 1);
    for (const e of timed) {
      const bar = $('.wf i', e.node);
      bar.style.left = `${(e.at / total) * 100}%`;
      bar.style.width = `${Math.max((e.ms / total) * 100, 1.2)}%`;
    }
  }

  function run(title, { open = true } = {}) {
    const startedAt = new Date();
    const t0 = performance.now();
    const r = { title, startedAt, status: 'running', summary: '', ms: null, entries: [] };
    runs.unshift(r);
    const li = document.createElement('li');
    li.className = 'run';
    li.dataset.status = 'running';
    li.innerHTML = `<details ${open ? 'open' : ''}><summary>
        <span class="dot" aria-hidden="true"></span>
        <span class="rt">${esc(title)}</span>
        <span class="rs"></span>
        <span class="rc">${clock(startedAt)} UTC</span>
        <span class="rd"></span>
      </summary><ol class="entries"></ol></details>`;
    list.prepend(li);
    while (list.children.length > 150) list.lastElementChild.remove();
    while (runs.length > 500) runs.pop();
    const entries = $('.entries', li);

    const api = {
      get t0() {
        return t0;
      },
      now: () => Math.round(performance.now() - t0),
      add(e) {
        const entry = { at: api.now(), ...e };
        r.entries.push(entry);
        entry.node = entryNode(entry);
        entries.append(entry.node);
        layoutBars(r);
        refresh();
        return entry;
      },
      // `offset`: where the server work sits on this run's timeline (when the request was sent).
      addTrace(trace, offset = 0) {
        for (const c of trace?.calls ?? []) {
          const { at, ...rest } = c;
          const kind = c.kind === 'retry' ? 'retry' : c.kind;
          api.add({ ...rest, kind, at: offset + at, ...(c.kind === 'session' ? { detail: c.detail } : {}) });
        }
      },
      end({ status = 'ok', summary = '' } = {}) {
        r.status = status;
        r.summary = summary;
        r.ms = api.now();
        li.dataset.status = status;
        $('.rs', li).textContent = summary;
        $('.rd', li).textContent = dur(r.ms);
        layoutBars(r);
        refresh();
      },
    };
    refresh();
    return api;
  }

  refresh();
  return { run, runs, exportJson, clear: () => $('[data-role=clear]', root).click() };
}
