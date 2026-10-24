// The "Replay" half of a recorded demo, shared by the tasks that record real mainnet cases pinned to a block: a button per case asks the server to work the case out again at the
// recorded block, and the answer is compared with the recording. The server's `comparison` is { identical, compared, differing[] } (plus a note).
import { api, esc } from '../util.js';

export const replayButton = (id) => `<button class="ghost" type="button" data-replay="${esc(id)}">Replay</button><div data-out="${esc(id)}"></div>`;

export function wireReplay(root, slug) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-replay]');
    if (!b) return;
    const out = root.querySelector(`[data-out="${CSS.escape(b.dataset.replay)}"]`);
    b.disabled = true;
    out.innerHTML = '<small class="muted">Replaying at the recorded block…</small>';
    try {
      let res;
      for (let attempt = 1; ; attempt++) {
        try { res = await api('run', { slug, replay: b.dataset.replay }); break; } catch (err) { if (attempt >= 2 || !(err.status >= 500)) throw err; }
      }
      const c = res.data.comparison;
      const same = c.identical === c.compared && c.sameBlock !== false;
      out.innerHTML = `<p class="check ${same ? 'ok' : 'bad'}">${same ? '✓' : '✗'} <b>${same ? `Same: ${c.identical} of ${c.compared} things identical to the recording` : `${c.identical} of ${c.compared} identical`}</b>${c.differing?.length ? `<br>${c.differing.map((d) => `${esc(d.what ?? d.label ?? d.id)}: recorded <code class="tiny">${esc(JSON.stringify(d.recorded)?.slice(0, 80))}</code>, now <code class="tiny">${esc(JSON.stringify(d.replayed)?.slice(0, 80))}</code>`).join('<br>')}` : ''}</p><p class="muted">${esc(c.note ?? '')}</p>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      b.disabled = false;
    }
  });
}
