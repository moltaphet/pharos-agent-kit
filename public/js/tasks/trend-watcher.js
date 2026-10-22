// Trend Watcher: content and a factory panel. State is kept in the browser's localStorage,
// so reloading the page (a restart) keeps the history, and re-running never duplicates it.
import { esc, store } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const KEY = 'trend-watcher-state-v1';
const persisted = {
  load() {
    try {
      return JSON.parse(store.get(KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  save(s) {
    store.set(KEY, JSON.stringify(s));
  },
};
const f = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(6))));

function chart(state) {
  const obs = state.observations;
  if (obs.length < 2) return '';
  const W = 640;
  const H = 170;
  const pad = 28;
  const vals = obs.map((o) => o.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (i) => pad + (i * (W - 2 * pad)) / (obs.length - 1);
  const y = (v) => H - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 2 * pad);
  const fired = new Map(state.events.filter((e) => e.type === 'triggered').map((e) => [e.block, e]));
  const inTrend = new Set(state.events.filter((e) => e.type === 'triggered').flatMap((e) => e.observations));
  const pts = obs.map((o, i) => `${x(i).toFixed(1)},${y(o.value).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="trend-chart" role="img" aria-label="History of observations with the moment the trend was met">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/>
    ${obs.map((o, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(o.value).toFixed(1)}" r="${fired.has(o.block) ? 7 : inTrend.has(o.id) ? 5 : 4}" fill="${fired.has(o.block) ? 'var(--bad)' : inTrend.has(o.id) ? 'var(--warn)' : 'var(--accent)'}"><title>block ${o.block}: ${f(o.value)}${fired.has(o.block) ? ' — TREND MET HERE' : ''}</title></circle>`).join('')}
    ${[...fired.keys()].map((b) => { const i = obs.findIndex((o) => o.block === b); return i < 0 ? '' : `<text x="${x(i).toFixed(1)}" y="${(y(obs[i].value) - 12).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--bad)">trend met</text>`; }).join('')}
    <text x="${pad}" y="${H - 6}" font-size="10" fill="currentColor" opacity=".6">block ${obs[0].block.toLocaleString('en-US')}</text>
    <text x="${W - pad}" y="${H - 6}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">block ${obs.at(-1).block.toLocaleString('en-US')}</text>
  </svg>`;
}

export const content = {
  tagline: 'A watcher with memory: it acts only when a trend holds over several readings, never on one noisy blip.',
  tools: ['chain'],
  skill: true,
  story: [
    'One reading proves nothing. A lending pool’s liquidity can dip for a block and bounce back; a supply figure can spike once. A bot that reacts to a single reading cries wolf. The Trend Watcher is a Pharos Skill that remembers: it stores every observation, and fires only when the last N of them all move the same way (at least three, and you set how many and how big each step must be).',
    'The memory is the point. State lives in a file (the CLI) or in your browser’s storage (this page), so the watcher can be stopped and restarted without losing history, and observing the same block twice never adds it twice. The page shows the stored history, marks the exact observation where the trend condition was first met, and records when it stopped holding.',
    'It runs on real Pharos data. Because past blocks are readable, you can back-fill a history in one click instead of waiting hours. In the data we recorded, USDC’s total supply fell from 54.64M to 52.80M to 50.16M over three consecutive samples (a real trend, met at block 20,860,000), while the lending liquidity held by Morpho Blue dipped once and bounced back (a single dip that correctly did not trigger).',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number', text: 'Find the latest block and the fixed grid of past sample points (multiples of the step).' },
    { server: 'chain', tool: 'eth_call at a past block · get_block', text: 'Read the metric at each sample block, one block at a time, and confirm every value (and the block header) with a second read.' },
    { server: 'local', tool: 'store (idempotent)', text: 'Add each observation keyed by its block. A block already stored is skipped, so retries and restarts cannot duplicate history.' },
    { server: 'local', tool: 'evaluate the rule', text: 'Do the last N observations all fall (or rise), each step at least the minimum? Fewer than 3 observations is never a trend.' },
    { server: 'local', tool: 'record the moment', text: 'The first time the rule holds, record a “triggered” event with the observations and values; when it stops holding, record “cleared”, which re-arms it.' },
    { server: 'local', tool: 'persist', text: 'CLI: write the state file atomically (temp file + rename). Page: save to localStorage.' },
  ],
  decisions: [
    { title: 'The node sometimes returns the wrong block’s value', text: 'Measured: about 10% of parallel historical eth_calls on the public RPC returned another block’s value (4 of 40), with the same bogus number also showing up through Chain MCP, so the cause is the node. Even single sequential reads were wrong about 1 time in 12. We read blocks one at a time and accept a value only when two reads agree, and a block header is rejected if it is for a different block.' },
    { title: 'A bug our own test caught', text: 'The first version sampled the “last 8 blocks” counted back from the moving head. Running it again a few seconds later picked blocks 37 further on and stored near-duplicate history (16 observations instead of 8). The sample grid is now anchored to fixed multiples of the step, so a re-run picks the same blocks and adds nothing.' },
    { title: 'At least three, by construction', text: 'The rule refuses fewer than 3 observations: one or two readings can never be a trend. A single spike or dip cannot trigger it however large it is.' },
    { title: 'A trend can clear and re-arm', text: 'When the movement stops, a “cleared” event is recorded and the watcher is armed again, so one long decline fires once and a later decline fires again.' },
    { title: 'State is passed in and out, never kept on the server', text: 'The page keeps its own state, so reloading (a restart) keeps the history. The server stays stateless and cannot lose or duplicate anything.' },
    { title: 'Synthetic scenarios are labelled', text: 'The decline, spike, dip and recovery scenarios use scripted numbers to show the rule on demand. They are marked synthetic and are not market data.' },
  ],
  evidence: [
    'State is persistent: the CLI writes a JSON file atomically; this page keeps it in localStorage. Reload the page and the history is still here.',
    'The trend rule is configurable (direction, number of consecutive observations, minimum step) and refuses fewer than 3 observations.',
    'A restart never loses or duplicates history: observations are keyed by block, the back-fill grid is fixed, and a second back-fill adds nothing. This is unit-tested and was run live.',
    'The stored history is shown with the exact observation where the trend condition was met, and the cleared moments.',
    'A single spike or dip does not trigger it: shown by the synthetic scenarios and by a real single dip in Morpho’s liquidity.',
  ],
  files: ['skills/pharos-trend-watcher/SKILL.md', 'skills/pharos-trend-watcher/references/trend-watcher.md', 'skills/pharos-trend-watcher/scripts/watch.mjs', 'lib/trend.js', 'lib/stable.js', 'lib/tasks/trend-watcher.js'],
  run: {
    commands: ['node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --backfill 8 --step 20000', 'node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --observe   # run hourly', 'node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --show'],
    sample: `USDC total supply on Pharos: 8 new observation(s), 0 already stored.   (run it again:)
USDC total supply on Pharos: 0 new observation(s), 8 already stored (skipped, never duplicated).

  block   20820000  2026-10-21 08:37:46 UTC           54643459.47 USDC
  block   20840000  2026-10-21 13:48:22 UTC           52802700.41 USDC
  block   20860000  2026-10-21 18:43:32 UTC           50158018.66 USDC   ◀ TREND MET HERE
  block   20880000  2026-10-22 00:14:42 UTC           48259972.84 USDC
status: TREND ACTIVE (3 consecutive observations falling)`,
  },
  verify: [
    { title: 'Check a stored value yourself', text: 'USDC total supply at a fixed past block never changes. These are the values behind the trend above (divide by 10^6). Because the node can occasionally answer wrongly, run a command twice and trust the value that repeats.', code: 'for b in 20820000 20840000 20860000; do cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "totalSupply()(uint256)" --block $b --rpc-url https://rpc.pharos.xyz; done\n# 54643459469755, 52802700407414, 50158018661066' },
    { title: 'See the node’s inconsistency for yourself', text: 'Repeat one historical read a few times. Most answers agree; occasionally one is wildly different.', code: 'for i in 1 2 3 4 5 6; do cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "totalSupply()(uint256)" --block 20780000 --rpc-url https://rpc.pharos.xyz; done' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the engine and the script are in the repository.', link: [`${REPO}/tree/main/skills/pharos-trend-watcher`, 'skills/pharos-trend-watcher'] },
  ],
};

export const mount = makePanel({
  intro: 'Back-fill a real history (or load a labelled synthetic scenario), watch the rule evaluate, then reload the page: the history is still here. The state lives in your browser.',
  fields: [
    { name: 'action', label: 'Action', type: 'select', options: [['backfill', 'Back-fill real history'], ['observe', 'Observe now (latest block)'], ['scenario', 'Synthetic scenario']], value: 'backfill' },
    { name: 'metric', label: 'Metric', type: 'select', options: [['usdc-supply', 'USDC total supply'], ['morpho-usdc', 'USDC held by Morpho Blue'], ['wpros-supply', 'WPROS total supply'], ['vrpcw-share', 'R25 VRPC-Weekly share price']], value: 'usdc-supply' },
    { name: 'scenario', label: 'Scenario', type: 'select', options: [['decline', 'Steady decline'], ['spike', 'Single spike (noise)'], ['dip', 'Single dip (noise)'], ['recovery', 'Decline, recovery, decline']], value: 'decline' },
    { name: 'count', label: 'Samples', type: 'number', value: '8', min: 1, step: 1 },
    { name: 'step', label: 'Blocks apart', type: 'number', value: '20000', min: 100, step: 1000, hint: '~1 second per block' },
    { name: 'direction', label: 'Trend direction', type: 'select', options: [['down', 'Falling'], ['up', 'Rising']], value: 'down' },
    { name: 'observations', label: 'Consecutive observations', type: 'number', value: '3', min: 3, step: 1, hint: 'at least 3' },
    { name: 'minStepPct', label: 'Min step (%)', type: 'number', value: '0', min: 0, step: 'any' },
  ],
  button: 'Run',
  examples: [
    { label: 'Real USDC supply: a real decline', values: { action: 'backfill', metric: 'usdc-supply', count: '8', step: '20000', direction: 'down', observations: '3', minStepPct: '0' } },
    { label: 'Synthetic: a single spike (does not fire)', values: { action: 'scenario', scenario: 'spike', direction: 'up', observations: '3', minStepPct: '0' } },
    { label: 'Synthetic: decline, recovery, decline', values: { action: 'scenario', scenario: 'recovery', direction: 'down', observations: '3', minStepPct: '0' } },
  ],
  state: persisted,
  title: (v) => (v.action === 'scenario' ? `Scenario: ${v.scenario}` : `${v.action} ${v.metric}`),
  call: (v, state) => ({ params: { action: v.action, metric: v.metric, scenario: v.scenario, count: v.count, step: v.step, direction: v.direction, observations: v.observations, minStepPct: v.minStepPct }, body: { state } }),
  nextState: (d) => d.state,
  decode: (d) => d.results.map((r) => ({ kind: r.fired ? 'decision' : 'result', ok: true, title: `${r.duplicate ? 'Skipped (already stored)' : 'Stored'}: block ${r.block.toLocaleString('en-US')} = ${f(r.value)}${r.fired ? '  ← TREND MET' : ''}${r.cleared ? '  ← trend cleared' : ''}`, detail: r.reason })),
  summary: (d) => `${d.results.filter((r) => r.added).length} new, ${d.results.filter((r) => r.duplicate).length} duplicate · ${d.state.active ? 'TREND ACTIVE' : 'no trend'}`,
  render: (d, { state }) => {
    const s = d.state;
    const last = s.observations.at(-1);
    const ev = s.events.filter((e) => e.type === 'triggered');
    return `
      ${d.source === 'synthetic' ? `<p class="check warn"><b>Synthetic data:</b> ${esc(d.label)}. Scripted numbers, not market data.</p>` : `<p class="muted">${esc(d.label)} (${esc(d.unit)})</p>`}
      <div class="verdict ${s.active ? 'bad' : 'ok'}">${s.active ? 'TREND ACTIVE' : 'NO TREND'}<small>rule: ${esc(s.rule.direction === 'down' ? 'falling' : 'rising')} for ${s.rule.observations} consecutive observations${s.rule.minStepPct ? `, each ≥ ${s.rule.minStepPct}%` : ''} · ${s.observations.length} observation${s.observations.length === 1 ? '' : 's'} stored · ${d.results.filter((r) => r.duplicate).length} duplicate${d.results.filter((r) => r.duplicate).length === 1 ? '' : 's'} skipped</small></div>
      ${chart(s)}
      <h4 class="list-h">Stored history</h4>
      ${table(['Block', 'Time', 'Value', 'Rule'], s.observations.map((o) => { const e = ev.find((x) => x.block === o.block); const cleared = s.events.find((x) => x.type === 'cleared' && x.block === o.block); return [o.block.toLocaleString('en-US'), esc(o.time ?? ''), `<b>${f(o.value)}</b>`, e ? pill('trend met here', 'bad') : cleared ? pill('trend cleared', 'info') : '']; }))}
      ${ev.length ? `<h4 class="list-h">When the trend condition was met</h4>${ev.map((e) => `<p><b>Block ${e.block.toLocaleString('en-US')}</b>${e.time ? ` (${esc(e.time)})` : ''}: ${e.values.map(f).join(' → ')}</p>`).join('')}` : `<p class="muted">The rule has not been met${last ? ` (${esc(d.results.at(-1)?.reason ?? '')})` : ''}.</p>`}
      <p class="muted">Saved in this browser. Reload the page and the history is still here; run again and nothing is duplicated.</p>`;
  },
});
