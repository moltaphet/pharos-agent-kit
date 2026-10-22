// Docs MCP Onboarding: content and a custom live panel (it runs several steps in a row).
import { $, api, copyText, esc, md, toast } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';
import { REPO } from '../consts.js';

export const content = {
  tagline: 'Onboard onto Pharos with nothing but its docs server, and report exactly where it let you down.',
  tools: ['docs', 'chain', 'rpc'],
  story: [
    'The brief for this task is feedback: pretend to be a developer who knows nothing about Pharos, use only Developer Docs MCP, and write an honest account of where the docs got you unstuck and where they failed.',
    'Opinions are cheap, so this tool does not give any. It asks ten questions a new developer would really need (RPC and chain ID, faucet, MCP setup, the tool list, log limits, Skill Engine install, token addresses, mainnet verification, x402, llms.txt), and then checks every answer against reality: the live RPC, the live MCP server, the real URL the answer points at. A gap is only reported when one of those checks fails.',
    'The result is a report you can read or download: each question with its exact wording and the docs’ answer, each gap with the query that exposed it, the evidence and what the docs should have said, and finally what the onboarding managed to run (and what it could not).',
  ],
  how: [
    { server: 'docs', tool: 'askQuestion', text: 'Ask one onboarding question, worded the way a newcomer would.' },
    { server: 'chain', tool: 'get_chain_info · tools/list', text: 'Check answers about the MCP server against the live server.' },
    { server: 'rpc', tool: 'eth_chainId · eth_getCode · eth_getLogs', text: 'Check network facts: chain ID, which token addresses are real contracts, the real log-range limit.' },
    { server: 'local', tool: 'HTTP probes', text: 'Fetch the URLs the docs mention (llms.txt, the verifier endpoint, the x402 page) and see whether they exist.' },
    { server: 'local', tool: 'gap detection', text: 'A failed check becomes a gap with the exact query, the evidence, and a written suggestion.' },
    { server: 'chain', tool: 'get_chain_info · get_block_number', text: 'Finale: use only what the docs gave (MCP config, RPC URLs) to connect and read both networks.' },
    { server: 'local', tool: 'report', text: 'Assemble the Markdown report from the recorded results.' },
  ],
  decisions: [
    { title: 'Checks, not opinions', text: 'Every gap is backed by a measurement. For example, “the documented log range is wrong” comes from asking the public RPC for 1,000 and then 1,001 blocks and seeing which one is rejected.' },
    { title: 'Gaps can disappear', text: 'Docs MCP answers are generated, so they change. One gap flipped between two runs because the answer was reworded. Gaps are recomputed every run, so a fixed docs page simply stops producing one.' },
    { title: 'A right number next to a wrong one is still wrong', text: 'The first version passed the log-range check because the answer correctly said the MCP tool allows 1,000 blocks, even though it also claimed the RPC allows 10,000. The check now fails if any stated limit is wrong.' },
    { title: 'We only claim what we measured', text: 'We could not safely prove whether the hosted server’s send_raw_transaction is enabled, so that is not reported as a gap.' },
    { title: 'Two sources for one fact is a finding', text: 'Both addresses the docs give for Atlantic USDC are real contracts with symbol USDC, but they are different contracts, and the docs do not say which to use for what.' },
  ],
  evidence: [
    'Every question, its exact wording and the docs’ answer appear in the log below, and in the downloadable report.',
    'Gaps come from checks against the live network or the real URL, each listed with the exact query that exposed it. The recorded report (reports/docs-mcp-onboarding.md) lists 6; the count can change because Docs MCP answers are generated.',
    'Each gap carries a written suggestion of what the docs should have said.',
    'The report ends with what the onboarding actually ran (MCP connection, both RPCs, live reads) and what it could not do, and why.',
  ],
  files: ['bin/pharos-onboard.js', 'lib/tasks/docs-mcp-onboarding.js', 'lib/http.js', 'reports/docs-mcp-onboarding.md'],
  run: {
    commands: ['node bin/pharos-onboard.js', 'node bin/pharos-onboard.js --out report.md'],
    sample: `### Gap 3: Two different “USDC” addresses on Atlantic, with no guidance on which to use

- **Exact query:** \`What is the USDC token address on Atlantic testnet?\`
- **What happened:** Expected: the answer leads to one USDC, not several. Found: 2 distinct contracts on
  Atlantic report symbol USDC: 0xcfC833…Fc8B (USDC, 1798 bytes); 0xE0BE08…4ec8 (USDC, 6005 bytes).
- **What the docs should say:** Say which USDC is for what (general use vs x402), mark the other clearly,
  and use the same address in every example, including the Skill Engine guide.`,
  },
  verify: [
    { title: 'Read the recorded report', text: 'The full report from a real run is in the repository.', link: [`${REPO}/blob/main/reports/docs-mcp-onboarding.md`, 'reports/docs-mcp-onboarding.md'] },
    { title: 'Check the llms.txt gap yourself', text: 'The endpoint that ai.pharos.xyz advertises returns 404, while the docs site publishes its own llms.txt.', code: `curl -s -o /dev/null -w '%{http_code}\\n' https://www.pharos.xyz/agent-center/llms.txt   # 404\ncurl -s -o /dev/null -w '%{http_code}\\n' https://docs.pharos.xyz/llms.txt                 # 200` },
    { title: 'Check the two USDC contracts yourself', text: 'Both answer symbol() with USDC on Atlantic. This asks the first; swap in 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8 for the second.', code: `curl -s https://atlantic.dplabs-internal.com -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B","data":"0x95d89b41"},"latest"]}'` },
  ],
};

const ICON = { pending: '·', running: '…', ok: '✓', gap: '✗', error: '!' };

export function mount(root, { slug }) {
  root.innerHTML = `
    <p class="panel-intro">Runs ten onboarding questions through Developer Docs MCP, one after another (about two minutes), and checks each answer against the live network.</p>
    <div class="actions"><button class="primary" id="go">${ICONS.play} Run the onboarding</button></div>
    <div id="out" class="out" aria-live="polite"><div class="idle">Press the button. Each step appears here as it finishes; the log below records every call.</div></div>
    <div id="log"></div>`;
  const out = $('#out', root);
  const go = $('#go', root);
  const log = createRunLog($('#log', root), { task: slug });
  let running = false;

  const stepHtml = (s, st) => {
    const r = st.result;
    return `<li><span class="si ${st.state === 'ok' ? 'ok' : st.state === 'gap' ? 'bad' : st.state === 'error' ? 'warn' : ''}">${ICON[st.state]}</span>
      <div><b>${esc(s.goal)}</b> ${st.state === 'gap' ? '<span class="tpill bad">gap</span>' : st.state === 'ok' ? '<span class="tpill ok">checks pass</span>' : st.state === 'running' ? '<span class="tpill info">asking…</span>' : st.state === 'error' ? '<span class="tpill warn">error</span>' : ''}
      <p><i>${esc(s.question)}</i></p>
      ${r ? `<details><summary>Answer and checks</summary><div class="answer">${md(r.answer)}</div><ul class="steps-list">${r.checks.map((c) => `<li><span class="si ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}</span><div>${esc(c.name)}<p>${esc(c.detail)}</p></div></li>`).join('')}</ul></details>` : ''}
      ${st.error ? `<p class="bad">${esc(st.error)}</p>` : ''}</div></li>`;
  };

  async function runAll() {
    if (running) return;
    running = true;
    go.disabled = true;
    const state = [];
    let steps;
    const paint = (summary = '') => {
      out.innerHTML = `${summary}<ol class="steps-list">${steps.map((s, i) => stepHtml(s, state[i])).join('')}</ol>`;
    };
    try {
      const plan = log.run('Plan the onboarding', { open: false });
      const sentPlan = plan.now();
      const p = await api('run', { slug, step: 'plan' });
      plan.addTrace(p.trace, sentPlan);
      plan.end({ status: 'ok', summary: `${p.data.steps.length} questions` });
      steps = p.data.steps;
      steps.forEach(() => state.push({ state: 'pending' }));
      paint();

      for (let i = 0; i < steps.length; i++) {
        state[i].state = 'running';
        paint();
        const r = log.run(`${i + 1}. ${steps[i].goal}`, { open: false });
        r.add({ kind: 'ui', title: 'Asked Developer Docs MCP', request: { question: steps[i].question } });
        const sent = r.now();
        try {
          const res = await api('run', { slug, step: steps[i].id });
          r.add({ kind: 'http', title: `GET /api/run answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
          r.addTrace(res.trace, sent);
          for (const c of res.data.checks) r.add({ kind: 'decision', at: sent + res.ms, ok: c.ok !== false, title: `${c.ok === true ? 'Pass' : c.ok === false ? 'Fail' : 'Info'}: ${c.name}`, detail: c.detail });
          state[i] = { state: res.data.gap ? 'gap' : 'ok', result: res.data };
          r.end({ status: res.data.gap ? 'error' : 'ok', summary: res.data.gap ? `gap: ${res.data.gap.title}` : 'checks pass' });
        } catch (err) {
          if (err.trace) r.addTrace(err.trace, sent);
          r.add({ kind: 'error', title: err.message, error: err.detail ?? err.message, at: sent + (err.ms ?? 0) });
          state[i] = { state: 'error', error: err.message };
          r.end({ status: 'error', summary: err.message });
        }
        paint();
      }

      const fin = log.run('Finale: what the docs let us run', { open: false });
      const sentFin = fin.now();
      let finale = null;
      try {
        const res = await api('run', { slug, step: 'finale' });
        fin.add({ kind: 'http', title: `GET /api/run answered ${res.status}`, ms: res.ms, at: sentFin });
        fin.addTrace(res.trace, sentFin);
        finale = res.data;
        fin.end({ status: 'ok', summary: `${finale.built.length} things ran` });
      } catch (err) {
        if (err.trace) fin.addTrace(err.trace, sentFin);
        fin.add({ kind: 'error', title: err.message, error: err.message });
        fin.end({ status: 'error', summary: err.message });
      }

      const results = state.filter((s) => s.result).map((s) => s.result);
      const rep = log.run('Build the report', { open: false });
      const sentRep = rep.now();
      const res = await api('run', { slug, step: 'report' }, { body: { results, finale } });
      rep.addTrace(res.trace, sentRep);
      rep.end({ status: 'ok', summary: `${res.data.markdown.split('\n').length} lines` });

      const gaps = results.filter((r) => r.gap);
      const summary = `<div class="verdict ${gaps.length ? 'warn' : 'ok'}">${results.length} questions asked · ${gaps.length} documentation gap${gaps.length === 1 ? '' : 's'} found<small>each backed by a check against the live network</small></div>`;
      paint(summary);
      out.insertAdjacentHTML(
        'beforeend',
        `<h4 class="list-h">Gaps found</h4><div class="cards">${gaps.map((r, n) => `<article class="note-card"><h3>${n + 1}. ${esc(r.gap.title)}</h3><p><b>Exact query:</b> <code>${esc(r.question)}</code></p><p><b>Evidence:</b> ${esc(r.gap.evidence.join(' '))}</p><p><b>The docs should say:</b> ${esc(r.gap.fix)}</p></article>`).join('') || '<p class="muted">None this run.</p>'}</div>
         ${finale ? `<h4 class="list-h">What the onboarding managed to run</h4><ul>${finale.built.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><h4 class="list-h">What it could not do</h4><ul>${finale.couldNot.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
         <div class="actions" style="margin-top:14px"><button class="ghost" id="copy-md">${ICONS.copy} Copy report as Markdown</button><button class="ghost" id="dl-md">${ICONS.download} Download report</button></div>`,
      );
      $('#copy-md', root).onclick = () => copyText(res.data.markdown, 'Report copied');
      $('#dl-md', root).onclick = () => {
        const url = URL.createObjectURL(new Blob([res.data.markdown], { type: 'text/markdown' }));
        Object.assign(document.createElement('a'), { href: url, download: 'docs-mcp-onboarding-report.md' }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Report downloaded');
      };
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      running = false;
      go.disabled = false;
    }
  }
  go.onclick = runAll;
  return () => {};
}
