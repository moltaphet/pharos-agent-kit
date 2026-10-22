// Small helpers shared by every view and panel.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '');
export const num = (n) => Number(n).toLocaleString('en-US');
export const utc = (t) => new Date(t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
export const clock = (d = new Date()) => d.toISOString().slice(11, 23);
export const dur = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);

// localStorage can throw (private windows, blocked storage), so never rely on it.
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

export class ApiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

// Calls our own /api/* routes. Resolves { data, trace, url, status, ms } where `trace`
// is the server's record of every MCP/RPC call that request made. Errors carry the
// trace too, so a failed run still shows what happened.
export async function api(path, params = {}, { body: payload } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const url = `/api/${path}?${query}`;
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, payload === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (err) {
    throw new ApiError(`Could not reach the server: ${err.message}`, { url, ms: Math.round(performance.now() - t0) });
  }
  const body = await res.json().catch(() => null);
  const ms = Math.round(performance.now() - t0);
  if (!body) throw new ApiError(`The server answered HTTP ${res.status} without JSON`, { url, status: res.status, ms });
  if (!res.ok || !body.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, { url, status: res.status, ms, trace: body.trace, detail: body.detail });
  return { data: body.data, trace: body.trace, url, status: res.status, ms };
}

let toastTimer;
export function toast(message) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export async function copyText(text, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed';
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      toast('Copy failed');
      ta.remove();
      return false;
    }
    ta.remove();
  }
  toast(message);
  return true;
}

// Tiny, safe markdown: everything is escaped first, then a few constructs are re-enabled.
export function md(src) {
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

// A shareable link into this page's current panel state.
export function shareUrl(slug, params) {
  const query = new URLSearchParams({ ...params, run: '1' });
  return `${location.origin}/#/${slug}/try?${query}`;
}
