// Live panel: Doc-Search.
import { $, api, copyText, esc, md, shareUrl } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';

const EXAMPLES = [
  'How do I deploy a contract?',
  'What are the chain ID and RPC URL for Pharos mainnet?',
  'How do I become a validator?',
  'How do I get testnet gas tokens?',
  'What is the airspeed velocity of an unladen swallow?',
];

export default function mount(root, { slug, params }) {
  root.innerHTML = `
    <form class="form" id="f" autocomplete="off">
      <label class="grow">Your question <input id="q" maxlength="300" placeholder="How do I deploy a contract?" required minlength="3"></label>
      <div class="actions">
        <button class="primary" id="go">${ICONS.play} Ask the docs</button>
        <button class="ghost" type="button" id="share" disabled>${ICONS.link} Copy link to this question</button>
      </div>
    </form>
    <div class="chips" role="group" aria-label="Example questions">${EXAMPLES.map((x) => `<button type="button" class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div id="out" class="out" aria-live="polite"><div class="idle">Ask something or pick an example. Two are special: the testnet gas question is a real gap (the docs have no faucet page, so the answer may say so), and the last one is a trap the docs cannot answer at all. The tool should refuse both as an answer.</div></div>
    <div id="log"></div>`;

  const q = $('#q', root);
  const out = $('#out', root);
  const go = $('#go', root);
  const log = createRunLog($('#log', root), { task: slug });
  let last = null;
  q.value = params.q || '';

  $('#share', root).onclick = () => last && copyText(shareUrl(slug, { q: last }), 'Link copied. It re-asks this question when opened');

  async function ask(question) {
    last = question;
    const r = log.run(question.length > 60 ? `${question.slice(0, 57)}…` : question);
    r.add({ kind: 'ui', title: 'You asked a question', request: { question } });
    out.innerHTML = '<div class="idle">Asking Developer Docs MCP…</div>';
    go.disabled = true;
    const sent = r.now();
    try {
      const res = await api('docs', { q: question });
      const d = res.data;
      r.add({ kind: 'http', title: `GET /api/docs answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
      r.addTrace(res.trace, sent);
      r.add({
        kind: 'decision',
        at: sent + res.ms,
        ok: true,
        title: d.found ? 'Verdict: answer found' : 'Verdict: no good answer',
        detail: d.reason,
        lines: [
          ['answer text returned', d.checks.hasAnswer ? 'yes' : 'no'],
          ['answer admits it cannot answer', d.checks.refusalPhrase ? 'yes' : 'no'],
          ['keyword search matches', `${d.checks.searchHits} page(s)`],
          ['docs pages linked in the answer', `${d.checks.linkedPages}`],
          ['question words found in those pages', d.checks.questionSupport == null ? 'not tested (no key words)' : `${Math.round(d.checks.questionSupport * 100)}%  (needs 50%)`],
        ],
      });
      if (d.found) {
        out.innerHTML = `<div class="card answer">${md(d.answer)}<h4>Sources</h4><ol class="sources">${d.sources
          .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> ${s.cited ? '<span class="tpill ok" title="The answer itself links to this page">cited in the answer</span>' : '<span class="tpill" title="Listed by the docs search as related; not proof of the answer">related</span>'}<span>${esc(s.url)}</span></li>`)
          .join('')}</ol><p class="check ok">✓ ${esc(d.reason)}</p></div>`;
      } else {
        out.innerHTML = `<div class="card none"><h4>No good answer found in the Pharos docs</h4>
          <p>Nothing in the docs directly answers “${esc(question)}”. Try rephrasing with a product, tool or network name.</p>
          ${d.partial ? `<p class="muted">What the docs server said instead (not a direct answer):</p><div class="answer">${md(d.partial)}</div>` : ''}
          ${d.related.length ? `<p class="muted">Closest pages (related, not an answer):</p><ul>${d.related.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>` : ''}
          <p class="check warn">${esc(d.reason)}</p></div>`;
      }
      $('#share', root).disabled = false;
      r.end({ status: 'ok', summary: `${d.found ? 'answered with ' + d.sources.length + ' sources' : 'no good answer'} · ${res.trace.calls.filter((c) => c.kind === 'mcp').length} server calls` });
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
    ask(q.value.trim());
  };
  root.querySelectorAll('.chip').forEach((b) => (b.onclick = () => ((q.value = b.dataset.q), ask(b.dataset.q))));
  if (params.run === '1' && q.value.trim()) ask(q.value.trim());
  return () => {};
}
