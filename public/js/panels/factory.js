// A declarative live panel, so a task only describes its form and how to show the
// result; the run log, sharing, errors and timing are handled here once.
//
// cfg = {
//   fields:   [{ name, label, type: 'text'|'number'|'select'|'textarea', value, options: [[value, label]], hint, grow, mono }],
//   button:   'Run it',
//   examples: [{ label, values: { name: value } }],
//   call:     (values, state) => ({ params?: {}, body?: any })     // default: send values as query
//   state:    { load(): any, save(any) }                           // optional browser-side persistence
//   render:   (data, ctx) => html                                  // result card
//   decode:   (data) => [{ kind, title, detail, lines }]           // extra log entries after the server calls
//   summary:  (data) => string                                     // one-line run summary
//   verdict:  (data) => 'ok' | 'error'                              // default 'ok'
// }
import { $, api, copyText, esc, shareUrl } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';

export function makePanel(cfg) {
  return function mount(root, { slug, params }) {
    const fieldHtml = (f) => {
      const id = `f-${f.name}`;
      const attrs = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''}`;
      const control =
        f.type === 'select'
          ? `<select ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`
          : f.type === 'textarea'
            ? `<textarea ${attrs} rows="${f.rows ?? 5}" spellcheck="false" placeholder="${esc(f.placeholder ?? '')}"></textarea>`
            : `<input ${attrs} type="${f.type === 'number' ? 'number' : 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} spellcheck="false" placeholder="${esc(f.placeholder ?? '')}" ${f.mono === false ? 'class="plain"' : ''}>`;
      return `<label class="${f.grow ? 'grow' : ''} ${f.wide ? 'wide' : ''}">${esc(f.label)}${f.optional ? ' <span class="opt">optional</span>' : ''}${control}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</label>`;
    };

    root.innerHTML = `
      ${cfg.intro ? `<p class="panel-intro">${esc(cfg.intro)}</p>` : ''}
      <form class="form" id="f" autocomplete="off">
        ${cfg.fields.map(fieldHtml).join('')}
        <div class="actions">
          <button class="primary" id="go">${ICONS.play} ${esc(cfg.button ?? 'Run')}</button>
          <button class="ghost" type="button" id="share" disabled>${ICONS.link} Copy link to this run</button>
          ${cfg.state ? `<button class="ghost" type="button" id="reset">Reset saved state</button>` : ''}
        </div>
      </form>
      ${cfg.examples?.length ? `<div class="chips" role="group" aria-label="Examples">${cfg.examples.map((x, i) => `<button type="button" class="chip" data-ex="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}
      <div id="out" class="out" aria-live="polite"><div class="idle">${esc(cfg.idle ?? 'Press the button. The result appears here and every step is recorded in the run log below.')}</div></div>
      <div id="log"></div>`;

    const out = $('#out', root);
    const go = $('#go', root);
    const log = createRunLog($('#log', root), { task: slug });
    const el = (name) => $(`#f-${name}`, root);
    const values = () => Object.fromEntries(cfg.fields.map((f) => [f.name, el(f.name).value.trim()]));
    const setValues = (v) => cfg.fields.forEach((f) => (el(f.name).value = v[f.name] ?? f.value ?? ''));
    setValues({ ...Object.fromEntries(cfg.fields.map((f) => [f.name, params[f.name]]).filter(([, v]) => v !== undefined)) });
    let last = null;

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c && !c.closest('.log')) copyText(c.dataset.copy);
      const ex = e.target.closest('[data-ex]');
      if (ex) {
        setValues(cfg.examples[Number(ex.dataset.ex)].values);
        run();
      }
    });
    $('#share', root).onclick = () => last && copyText(shareUrl(slug, last), 'Link copied. It re-runs this when opened');
    if (cfg.state) {
      $('#reset', root).onclick = () => {
        cfg.state.save(null);
        out.innerHTML = '<div class="idle">Saved state cleared.</div>';
      };
    }

    async function run() {
      const v = values();
      last = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
      const r = log.run(cfg.title ? cfg.title(v) : `Run ${slug}`);
      r.add({ kind: 'ui', title: 'You ran the task', request: v });
      out.innerHTML = '<div class="idle">Working…</div>';
      go.disabled = true;
      const sent = r.now();
      try {
        const state = cfg.state?.load() ?? null;
        const extra = cfg.call?.(v, state) ?? {};
        const res = await api('run', { slug, ...v, ...(extra.params ?? {}) }, extra.body === undefined ? {} : { body: extra.body });
        r.add({ kind: 'http', title: `${extra.body === undefined ? 'GET' : 'POST'} /api/run answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
        r.addTrace(res.trace, sent);
        for (const e of cfg.decode?.(res.data) ?? []) r.add({ at: sent + res.ms, ...e });
        cfg.state?.save(cfg.nextState ? cfg.nextState(res.data, state) : state);
        out.innerHTML = cfg.render(res.data, { values: v });
        $('#share', root).disabled = false;
        const calls = res.trace.calls.filter((c) => c.kind === 'mcp' || c.kind === 'rpc').length;
        r.end({ status: cfg.verdict?.(res.data) ?? 'ok', summary: `${cfg.summary?.(res.data) ?? 'done'} · ${calls} server call${calls === 1 ? '' : 's'}` });
      } catch (err) {
        if (err.trace) r.addTrace(err.trace, sent);
        r.add({ kind: 'error', title: err.message, error: err.detail ?? err.message, at: sent + (err.ms ?? 0) });
        r.end({ status: 'error', summary: err.message });
        out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      } finally {
        go.disabled = false;
      }
    }

    $('#f', root).onsubmit = (e) => {
      e.preventDefault();
      run();
    };
    if (params.run === '1') run();
    return () => {};
  };
}

// Small rendering helpers shared by task panels.
export const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${v}</span>`).join('')}</div>`;
export const pill = (text, tone = '') => `<span class="tpill ${tone}">${esc(text)}</span>`;
export const table = (head, rows) =>
  `<div class="scroll"><table class="tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const verdictBox = (tone, html) => `<p class="check ${tone}">${html}</p>`;
