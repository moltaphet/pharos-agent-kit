#!/usr/bin/env node
// A watcher with memory. State lives in a JSON file, so every run continues where the last stopped.
//   node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric morpho-usdc --observe
//   node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --backfill 8 --step 20000
//   node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --show
//   options: --direction down|up  --observations 3  --min-step 0   --json
// Exit code: 0 = no trend now, 10 = a trend is active, 1 = error. Run from the repository root.
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { METRICS, runTrend } from '../../../lib/tasks/trend-watcher.js';
import { FileStore, evaluate, newState, parseRule } from '../../../lib/trend.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const file = arg('state', 'trend-state.json');
const store = new FileStore(file);
const rule = { direction: arg('direction'), observations: arg('observations'), minStepPct: arg('min-step') };
for (const k of Object.keys(rule)) if (rule[k] === undefined) delete rule[k];
const chain = new McpClient(PHAROS_CHAIN_MCP);
const show = (state, unit = '') => {
  const ev = evaluate(state.observations, state.rule);
  console.log(`\nrule: ${state.rule.direction} for ${state.rule.observations} consecutive observations${state.rule.minStepPct ? ` (each ≥ ${state.rule.minStepPct}%)` : ''}   ·   ${state.observations.length} observation(s) stored in ${file}`);
  for (const o of state.observations) {
    const fired = state.events.find((e) => e.type === 'triggered' && e.block === o.block);
    console.log(`  block ${String(o.block).padStart(10)}  ${String(o.time ?? '').padEnd(24)}  ${String(o.value).padStart(18)} ${unit}${fired ? '   ◀ TREND MET HERE' : ''}`);
  }
  console.log(`\nstatus: ${state.active ? 'TREND ACTIVE' : 'no trend'} (${ev.reason})`);
  for (const e of state.events) console.log(`  ${e.type} at block ${e.block}${e.time ? ` (${e.time})` : ''}${e.values ? `; values ${e.values.join(' → ')}` : ''}`);
};
try {
  let state = (await store.load()) ?? newState(rule);
  if (has('reset')) state = newState(rule);
  else if (Object.keys(rule).length) state = { ...state, rule: parseRule({ ...state.rule, ...rule }) }; // a rule given now replaces the stored one; history is kept
  let unit = '';
  if (has('observe') || has('backfill')) {
    const metric = arg('metric', 'morpho-usdc');
    const out = await runTrend({ chain }, { action: has('backfill') ? 'backfill' : 'observe', metric, state, rule: { ...state.rule, ...rule }, count: arg('backfill', 8), step: arg('step', 20000) }, () => new Date().toISOString());
    state = out.state;
    unit = out.unit;
    await store.save(state);
    const added = out.results.filter((r) => r.added).length;
    console.log(`${out.label}: ${added} new observation(s), ${out.results.length - added} already stored (skipped, never duplicated).`);
  } else if (has('reset') || Object.keys(rule).length) await store.save(state);
  if (has('json')) console.log(JSON.stringify(state, null, 2));
  else show(state, unit);
  process.exitCode = state.active ? 10 : 0;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
