// Live panel: Read Contract State.
import { $, api, copyText, esc, num, shareUrl, short, utc } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';
import { USDC } from '../content.js';

export const PRESETS = [
  ['USDC', USDC],
  ['WPROS', '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0'],
  ['LINK', '0x51e2a24742db77604b881d6781ee16b5b8fcbe29'],
  ['WETH', '0x1f4b7011ee3d53969bb67f59428a9ec0477856e9'],
];
const nameOf = (address) => PRESETS.find(([, a]) => a === address)?.[0] ?? short(address);

export default function mount(root, { slug, params }) {
  root.innerHTML = `
    <form class="form" id="f" autocomplete="off">
      <label>Contract
        <select id="preset">${PRESETS.map(([n, a]) => `<option value="${a}">${n} · ${short(a)}</option>`).join('')}<option value="">Custom address…</option></select>
      </label>
      <label class="grow">Contract address <input id="addr" spellcheck="false" required pattern="0x[0-9a-fA-F]{40}" title="A 0x address with 40 hex characters"></label>
      <label class="grow">Wallet to check <span class="opt">optional</span>
        <input id="holder" spellcheck="false" placeholder="0x… whose balance to read" pattern="0x[0-9a-fA-F]{40}">
      </label>
      <div class="actions">
        <button class="primary" id="go">${ICONS.play} Read state</button>
        <button class="ghost" type="button" id="share" disabled>${ICONS.link} Copy link to this run</button>
      </div>
    </form>
    <div id="out" class="out" aria-live="polite"></div>
    <div id="log"></div>`;

  const addr = $('#addr', root);
  const holderEl = $('#holder', root);
  const preset = $('#preset', root);
  const out = $('#out', root);
  const go = $('#go', root);
  const log = createRunLog($('#log', root), { task: slug });
  let last = null;

  addr.value = params.address || USDC;
  holderEl.value = params.holder || '';
  preset.value = PRESETS.some(([, a]) => a === addr.value) ? addr.value : '';
  preset.onchange = () => preset.value && (addr.value = preset.value);
  addr.oninput = () => (preset.value = PRESETS.some(([, a]) => a === addr.value.trim().toLowerCase()) ? addr.value.trim().toLowerCase() : '');

  out.innerHTML = '<div class="idle">Pick a contract and press <b>Read state</b>. The result appears here and every step is recorded in the run log below.</div>';

  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c && !c.closest('.log')) copyText(c.dataset.copy);
  });
  $('#share', root).onclick = () => last && copyText(shareUrl(slug, last), 'Link copied. It re-runs this read when opened');

  function render(s) {
    const unit = s.symbol ? ` ${s.symbol}` : '';
    const who = (a) => `${esc(a.description)} <code>${short(a.address)}</code>`;
    const human = [
      esc(s.name ?? 'n/a'),
      esc(s.symbol ?? 'n/a'),
      s.decimals ?? 'n/a',
      s.totalSupply ? `<b>${esc(s.totalSupply.formatted)}${esc(unit)}</b>` : 'n/a',
      s.owner ? who(s.owner) : '<span class="muted">n/a (this contract has no owner())</span>',
      ...s.balances.map((b) => (b.raw == null ? `${who(b)} → n/a` : `${who(b)} → <b>${esc(b.formatted)}${esc(unit)}</b>`)),
    ];
    const cc = s.crosscheck;
    const status = (i) => cc?.rows?.[i]?.status;
    const mark = (st) => (st === 'match' ? '<span class="ok" title="Matches the public RPC">✓ match</span>' : st === 'resolved' ? '<span class="ok" title="The RPC’s first answer differed; a re-read agreed with Chain MCP">✓ match (re-read)</span>' : st === 'mismatch' ? '<span class="bad">✗ differs</span>' : st === 'inconclusive' ? '<span class="warn">? inconclusive</span>' : '<span class="muted">n/a</span>');
    const verdict = !cc
      ? ''
      : cc.error
        ? `<p class="check warn">Independent check unavailable: ${esc(cc.error)}</p>`
        : cc.mismatch
          ? `<p class="check bad">✗ ${cc.mismatch} of ${cc.total} values differ from the public RPC at block ${num(cc.block)}. Open the log to compare the raw bytes.</p>`
          : cc.inconclusive
            ? `<p class="check warn">${cc.match} of ${cc.total} values match the public RPC; ${cc.inconclusive} could not be confirmed.</p>`
            : `<p class="check ok">✓ Independent check: all ${cc.total} values match what the public RPC (rpc.pharos.xyz) returns at block ${num(cc.block)}.${cc.resolved ? ` ${cc.resolved} needed a re-read because the node first answered inconsistently.` : ''}</p>`;

    out.innerHTML = `
      <div class="card">
        <div class="kv">
          <span>Contract</span><b>${esc([s.name, s.symbol && s.symbol !== s.name ? `(${s.symbol})` : ''].filter(Boolean).join(' ') || 'unnamed contract')}</b>
          <span>Address</span><span><code>${esc(s.contract)}</code> <button type="button" class="mini" data-copy="${esc(s.contract)}">Copy</button></span>
          <span>Network</span><span>${esc(s.network.name)} · chain ${s.network.chainId}</span>
          <span>Read at</span><span>block <b>${num(s.block.number)}</b> · ${utc(s.block.timestamp)}</span>
          <span>Code size</span><span>${num(s.codeBytes)} bytes of contract code</span>
        </div>
        <h4>Values read via Chain MCP <span class="muted">eth_call, every one at block ${num(s.block.number)}</span></h4>
        <div class="scroll"><table class="tbl evidence">
          <thead><tr><th>Value</th><th>Reads as</th><th>Raw result of the call</th><th>Public RPC</th></tr></thead>
          <tbody>${s.evidence
            .map(
              (e, i) => `<tr><th scope="row"><code>${esc(e.field)}</code></th><td>${human[i]}</td>
              <td class="rawcell">${e.raw ? `<code class="raw" title="${esc(e.raw)}">0x…${esc(e.raw.slice(-8))}</code> <small class="muted">${(e.raw.length - 2) / 2} bytes</small><button type="button" class="mini icon" data-copy="${esc(e.raw)}" aria-label="Copy the full raw value" title="Copy the full raw value">${ICONS.copy}</button>` : '<span class="muted">empty (0x)</span>'}</td>
              <td>${mark(status(i))}</td></tr>`,
            )
            .join('')}</tbody></table></div>
        ${verdict}
      </div>`;
  }

  async function runRead() {
    const address = addr.value.trim().toLowerCase();
    const holder = holderEl.value.trim().toLowerCase();
    last = { address, holder };
    const r = log.run(`Read ${nameOf(address)}${holder ? ` + balance of ${short(holder)}` : ''}`);
    r.add({ kind: 'ui', title: `You asked for the state of ${short(address)}${holder ? ` and the balance of ${short(holder)}` : ''}`, request: { address, holder: holder || undefined } });
    out.innerHTML = '<div class="idle">Reading from Pharos through Chain MCP…</div>';
    go.disabled = true;
    const sent = r.now();
    try {
      const res = await api('read', { address, holder });
      const s = res.data;
      r.add({ kind: 'http', title: `GET /api/read answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
      r.addTrace(res.trace, sent);
      const afterServer = sent + res.ms;
      for (const e of s.evidence) {
        r.add({
          kind: 'decode',
          at: afterServer,
          title: `${e.field} → ${e.decoded ?? 'no value'}`,
          lines: [['selector / call data', `${e.data.slice(0, 10)}${e.data.length > 10 ? '…' : ''}`], ['raw result', e.raw ?? '0x (empty)'], ['decoded', e.decoded ?? 'n/a: the contract does not implement this']],
        });
      }
      const cc = s.crosscheck;
      if (cc && !cc.error) {
        r.add({
          kind: 'decision',
          at: afterServer,
          ok: cc.mismatch === 0,
          title: `Cross-check: ${cc.match + (cc.resolved ?? 0)}/${cc.total} match the public RPC${cc.resolved ? ` (${cc.resolved} after a re-read)` : ''}${cc.mismatch ? `, ${cc.mismatch} differ` : ''}${cc.inconclusive ? `, ${cc.inconclusive} inconclusive` : ''}`,
          lines: cc.rows.map((row) => [row.field, row.note ? `${row.status} (${row.note})` : row.status]),
        });
      }
      render(s);
      $('#share', root).disabled = false;
      const calls = res.trace.calls.filter((c) => c.kind === 'mcp' || c.kind === 'rpc').length;
      r.end({ status: 'ok', summary: `block ${num(s.block.number)} · ${calls} server calls${cc && !cc.error ? ` · ${cc.match}/${cc.total} cross-checked` : ''}` });
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
    runRead();
  };
  if (params.run === '1') runRead();
  return () => {};
}
