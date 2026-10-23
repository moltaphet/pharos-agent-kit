// A live "run it for real" panel: starts a run on a throwaway Vercel Sandbox through the API, polls it, and shows the run's
// events as they arrive, then the final result. Used by demos whose script executes real EVM transactions on a mainnet fork.
//
// cfg = {
//   slug, intro, button,
//   scenarios: [[id, label], ...],
//   eventRow: (event) => '<tr>…</tr>',  eventHead: ['Time', …],
//   resultHtml: (record) => html,
//   verdict: (record) => 'ok' | 'error',  summary: (record) => string,
//   recorded?: { label, params, html: (data) => html }     // the recorded run, one click away
// }
import { $, api, esc } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 2500;

export function mountRealRun(root, cfg) {
  let cancelled = false;
  root.innerHTML = `
    <p class="panel-intro">${esc(cfg.intro)}</p>
    <form class="form" id="rr-f" autocomplete="off">
      <label class="grow">Scenario<select id="rr-scenario">${cfg.scenarios.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>
      <div class="actions">
        <button class="primary" id="rr-go">${ICONS.play} ${esc(cfg.button ?? 'Run for real')}</button>
        ${cfg.recorded ? `<button class="ghost" type="button" id="rr-rec">${esc(cfg.recorded.label)}</button>` : ''}
      </div>
    </form>
    <div class="chips" role="group" aria-label="Scenarios">${cfg.scenarios.map(([v, l]) => `<button type="button" class="chip" data-sc="${esc(v)}">${esc(l)}</button>`).join('')}</div>
    <div id="rr-out" class="out" aria-live="polite"><div class="idle">Pick a scenario and press the button. A new machine starts, forks Pharos mainnet, and every step appears here as it happens (about 30 seconds).</div></div>
    <div id="rr-log"></div>`;

  const out = $('#rr-out', root);
  const go = $('#rr-go', root);
  const rec = $('#rr-rec', root);
  const scenarioEl = $('#rr-scenario', root);
  const log = createRunLog($('#rr-log', root), { task: cfg.slug });
  const busy = (b) => { go.disabled = b; if (rec) rec.disabled = b; };

  async function run(scenario) {
    const r = log.run(`Real run: ${scenario}`);
    r.add({ kind: 'ui', title: 'You started a real run', request: { scenario } });
    out.innerHTML = '<div class="idle">Starting a machine…</div>';
    busy(true);
    const t0 = performance.now();
    try {
      const sent = r.now();
      const res = await api('run', { slug: cfg.slug, real: 'start', scenario });
      const { started } = res.data;
      r.add({ kind: 'http', title: `GET /api/run (start) answered ${res.status}`, ms: res.ms, at: sent, detail: `machine ${started.id}` });
      out.innerHTML = `
        <div class="card">
          <div class="verdict info">RUNNING<small id="rr-phase">Starting the machine…</small></div>
          <p class="muted"><span id="rr-elapsed">0</span> s elapsed · machine <code>${esc(started.id)}</code> · it is removed when the run ends (6 minutes at most)</p>
          <div class="scroll"><table class="tbl"><thead><tr>${cfg.eventHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody id="rr-events"></tbody></table></div>
        </div>`;
      const tick = setInterval(() => { const el = $('#rr-elapsed', root); if (el) el.textContent = String(Math.round((performance.now() - t0) / 1000)); }, 500);
      let from = 0;
      let failures = 0;
      try {
        for (;;) {
          if (cancelled) return;
          await sleep(POLL_MS);
          let st;
          try {
            st = (await api('run', { slug: cfg.slug, real: 'status', id: started.id, from })).data.status;
            failures = 0;
          } catch (err) {
            if (++failures >= 4) throw err;
            continue;
          }
          const phase = $('#rr-phase', root);
          if (phase) phase.textContent = st.phase;
          for (const e of st.events) {
            $('#rr-events', root)?.insertAdjacentHTML('beforeend', cfg.eventRow(e));
            r.add({ kind: 'decision', ok: true, title: e.what ?? e.event, detail: e.detail, at: Math.round(performance.now() - t0) });
          }
          from = st.total;
          if (st.state === 'running') continue;
          if (st.state !== 'done') throw new Error(st.error ?? st.message ?? `the run ${st.state}`);
          out.innerHTML = cfg.resultHtml(st.result);
          r.end({ status: cfg.verdict(st.result), summary: `${cfg.summary(st.result)} · ${Math.round((performance.now() - t0) / 1000)} s` });
          return;
        }
      } finally {
        clearInterval(tick);
      }
    } catch (err) {
      r.add({ kind: 'error', title: err.message, error: err.detail ?? err.message });
      r.end({ status: 'error', summary: err.message });
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      busy(false);
    }
  }

  async function showRecorded() {
    const r = log.run('Recorded run');
    busy(true);
    try {
      const sent = r.now();
      const res = await api('run', { slug: cfg.slug, ...cfg.recorded.params });
      r.add({ kind: 'http', title: `GET /api/run answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
      out.innerHTML = cfg.recorded.html(res.data);
      r.end({ status: 'ok', summary: 'recorded run shown' });
    } catch (err) {
      r.add({ kind: 'error', title: err.message, error: err.message });
      r.end({ status: 'error', summary: err.message });
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      busy(false);
    }
  }

  $('#rr-f', root).onsubmit = (e) => { e.preventDefault(); run(scenarioEl.value); };
  if (rec) rec.onclick = showRecorded;
  root.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { scenarioEl.value = b.dataset.sc; run(b.dataset.sc); }));
  return () => { cancelled = true; };
}
