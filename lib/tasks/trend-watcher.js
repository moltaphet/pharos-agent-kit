// Task: Trend Watcher (Skill). The engine and its storage are in lib/trend.js. This module
// reads the chain metrics and drives the engine. State is never kept on the server: callers
// pass it in and get the new state back (the CLI keeps it in a file, the web demo in the
// browser's storage), so a restart cannot lose or duplicate anything.

import { blockNumber, getBlock, optionalCall } from '../chain.js';
import { SELECTORS, decodeUint, encodeAddress, formatUnits } from '../abi.js';
import { MORPHO, USDC, VAULTS, WPROS } from '../protocols.js';
import { UserError } from '../snapshot.js';
import { stableHeader, stableRead } from '../stable.js';
import { newState, observe, parseRule } from '../trend.js';

const tokenUnits = async (chain, token, block, label) => {
  const [raw, dec] = await Promise.all([
    optionalCall(chain, token.address, token.data, block, label),
    optionalCall(chain, token.address, SELECTORS.decimals, block, 'decimals()'),
  ]);
  if (raw == null) throw new UserError('the contract did not answer');
  return Number(formatUnits(decodeUint(raw), dec ? Number(decodeUint(dec)) : 18, 18).replace(/,/g, ''));
};

// Each metric reads one number at a given block. All of them work at historical blocks.
export const METRICS = {
  'morpho-usdc': { label: 'USDC held by Morpho Blue (lending liquidity)', unit: 'USDC', read: ({ chain }, block) => tokenUnits(chain, { address: USDC, data: SELECTORS.balanceOf + encodeAddress(MORPHO.address) }, block, 'USDC balance of Morpho Blue') },
  'usdc-supply': { label: 'USDC total supply on Pharos', unit: 'USDC', read: ({ chain }, block) => tokenUnits(chain, { address: USDC, data: SELECTORS.totalSupply }, block, 'USDC totalSupply') },
  'wpros-supply': { label: 'WPROS total supply (wrapped PROS)', unit: 'WPROS', read: ({ chain }, block) => tokenUnits(chain, { address: WPROS, data: SELECTORS.totalSupply }, block, 'WPROS totalSupply') },
  'vrpcw-share': { label: 'R25 VRPC-Weekly share price', unit: 'USDC/share', read: ({ chain }, block) => tokenUnits(chain, { address: VAULTS[0].address, data: '0x07a2d13a' + (10n ** 6n).toString(16).padStart(64, '0') }, block, 'vault convertToAssets(1 share)') },
};

// Scripted series for demonstrating the rule (synthetic, clearly labelled).
export const SCENARIOS = {
  decline: { label: 'Steady decline (a real trend)', values: [100, 99, 97.5, 95, 92] },
  spike: { label: 'One big spike (noise, not a trend)', values: [100, 100, 100, 180, 100, 100] },
  dip: { label: 'One big dip (noise, not a trend)', values: [100, 100, 40, 100, 100] },
  recovery: { label: 'Decline, recovery, decline again', values: [100, 98, 95, 99, 97, 94, 90] },
};

const num = (n) => Number(n.toPrecision(10));

function feed(state, samples, now) {
  const results = [];
  let s = state;
  for (const sample of samples) {
    const r = observe(s, sample, { now });
    s = r.state;
    results.push({ block: sample.block, time: sample.time, value: sample.value, added: r.added, duplicate: r.duplicate, fired: r.fired, cleared: r.cleared, met: r.evaluation.met, reason: r.evaluation.reason });
  }
  return { state: s, results };
}

export async function runTrend({ chain }, { action, metric, state: stateIn, rule: ruleIn, count = 8, step = 20000, scenario }, now) {
  const rule = parseRule(ruleIn);
  let state = stateIn ?? newState(rule);
  state = { ...state, rule }; // the rule in force is the one the caller passed now
  if (action === 'scenario') {
    const sc = SCENARIOS[scenario];
    if (!sc) throw new UserError(`scenario must be one of ${Object.keys(SCENARIOS).join(', ')}`);
    const fresh = newState(rule);
    const samples = sc.values.map((value, i) => ({ block: 1000 + i * 100, time: `synthetic t+${i}`, value }));
    return { ...feed(fresh, samples, now), source: 'synthetic', label: sc.label, rule };
  }
  const m = METRICS[metric];
  if (!m) throw new UserError(`metric must be one of ${Object.keys(METRICS).join(', ')}`);
  const head = await blockNumber(chain, 'Latest block, the newest observation point');
  let blocks;
  if (action === 'observe') blocks = [head];
  else if (action === 'backfill') {
    const n = Number(count);
    const st = Number(step);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new UserError('count must be a whole number from 1 to 20');
    if (!Number.isInteger(st) || st < 100) throw new UserError('step must be a whole number of at least 100 blocks');
    // Anchor the grid to multiples of `step`, not to the moving head: running this again a few
    // seconds later must pick the SAME blocks, so the engine's per-block de-duplication catches them.
    const anchor = Math.floor(head / st) * st;
    blocks = Array.from({ length: n }, (_, i) => anchor - (n - 1 - i) * st).filter((b) => b > 0);
  } else throw new UserError('action must be observe, backfill or scenario');
  // One block at a time, each value confirmed by a second read: parallel historical reads are
  // unreliable on the node (see lib/stable.js).
  const samples = [];
  for (const block of blocks) {
    const { value } = await stableRead(async () => String(await m.read({ chain }, block)), { label: `${m.label} at block ${block}` });
    const header = await stableHeader((b) => getBlock(chain, b, `Timestamp of block ${b.toLocaleString('en-US')}`), block);
    samples.push({ block, time: new Date(header.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'), value: num(Number(value)) });
  }
  return { ...feed(state, samples, now), source: 'live', label: m.label, unit: m.unit, rule, head };
}

export default async function run({ q, body, chain }) {
  const rule = { direction: q.direction ?? 'down', observations: q.observations ?? 3, minStepPct: q.minStepPct ?? 0 };
  const out = await runTrend({ chain }, { action: q.action ?? 'backfill', metric: q.metric ?? 'morpho-usdc', state: body?.state ?? null, rule, count: q.count ?? 8, step: q.step ?? 20000, scenario: q.scenario }, () => new Date().toISOString());
  return { ...out, metrics: Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v.label])), scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])) };
}
