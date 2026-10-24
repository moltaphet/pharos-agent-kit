// Trend engine with memory. It persists observations between runs and acts only when a
// trend holds over several consecutive observations, never on a single noisy reading.
//
// state = { version, rule, observations: [{ id, block, time, value }], active, events: [...] }
// rule  = { direction: 'down'|'up', observations: N (>= 3), minStepPct: 0 }
// An observation is identified by its block, so observing the same block twice is a no-op:
// a restart or a retry can never duplicate history.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { UserError } from './snapshot.js';

export const MIN_OBSERVATIONS = 3;
export const MAX_STORED = 200; // the newest observations and events kept; the rule only ever looks at the last few
export const DEFAULT_RULE = { direction: 'down', observations: 3, minStepPct: 0 };

export function parseRule(input = {}) {
  const rule = { ...DEFAULT_RULE, ...input };
  rule.observations = Number(rule.observations);
  rule.minStepPct = Number(rule.minStepPct);
  if (!['down', 'up'].includes(rule.direction)) throw new UserError('direction must be "down" or "up"');
  if (!Number.isInteger(rule.observations) || rule.observations < MIN_OBSERVATIONS) throw new UserError(`observations must be a whole number of at least ${MIN_OBSERVATIONS}: one reading can never be a trend`);
  if (!Number.isFinite(rule.minStepPct) || rule.minStepPct < 0) throw new UserError('minStepPct must be 0 or more');
  return rule;
}

export const newState = (rule) => ({ version: 1, rule: parseRule(rule), observations: [], active: false, events: [] });

const stepPct = (from, to) => (from === 0 ? (to === 0 ? 0 : Math.sign(to) * Infinity) : ((to - from) / Math.abs(from)) * 100);

// Does the most recent run of observations satisfy the rule? Pure: reads state, changes nothing.
export function evaluate(observations, rule) {
  const n = rule.observations;
  const tail = observations.slice(-n);
  if (observations.length < n) return { met: false, reason: `needs ${n} observations, has ${observations.length}`, tail, steps: [] };
  const sign = rule.direction === 'down' ? -1 : 1;
  const steps = [];
  for (let i = 1; i < tail.length; i++) steps.push({ from: tail[i - 1].id, to: tail[i].id, pct: stepPct(tail[i - 1].value, tail[i].value) });
  const bad = steps.find((s) => !(sign * s.pct > 0 && Math.abs(s.pct) >= rule.minStepPct));
  if (bad) return { met: false, reason: `${rule.direction === 'down' ? 'not falling' : 'not rising'} between ${bad.from} and ${bad.to} (${Number.isFinite(bad.pct) ? bad.pct.toFixed(4) : 'n/a'}%${rule.minStepPct ? `, needs ${rule.minStepPct}%` : ''})`, tail, steps };
  return { met: true, reason: `${n} consecutive observations ${rule.direction === 'down' ? 'falling' : 'rising'}`, tail, steps };
}

// Adds one observation (idempotent by block) and updates trigger state. Returns { state, added, evaluation, fired, cleared }.
export function observe(state, obs, { now = () => new Date().toISOString() } = {}) {
  const rule = parseRule(state.rule);
  if (!Number.isFinite(obs.value)) throw new UserError('observation value must be a number');
  const id = `b${obs.block}`;
  if (state.observations.some((o) => o.id === id)) {
    return { state, added: false, evaluation: evaluate(state.observations, rule), fired: false, cleared: false, duplicate: true };
  }
  const observations = [...state.observations, { id, block: obs.block, time: obs.time ?? null, value: obs.value }].sort((a, b) => a.block - b.block).slice(-MAX_STORED);
  const evaluation = evaluate(observations, rule);
  const events = [...state.events];
  let fired = false;
  let cleared = false;
  let active = state.active;
  if (evaluation.met && !state.active) {
    fired = true;
    active = true;
    events.push({ type: 'triggered', block: obs.block, time: obs.time ?? null, observations: evaluation.tail.map((o) => o.id), values: evaluation.tail.map((o) => o.value), at: now() });
  } else if (!evaluation.met && state.active) {
    cleared = true;
    active = false;
    events.push({ type: 'cleared', block: obs.block, time: obs.time ?? null, reason: evaluation.reason, at: now() });
  }
  return { state: { ...state, observations, active, events: events.slice(-MAX_STORED) }, added: true, evaluation, fired, cleared, duplicate: false };
}

// Durable storage: write to a temp file, then rename, so a crash can never leave half a file.
export class FileStore {
  constructor(path) {
    this.path = path;
  }
  async load() {
    try {
      let state;
      try {
        state = JSON.parse(await readFile(this.path, 'utf8'));
      } catch (err) {
        if (err instanceof SyntaxError) throw new UserError(`${this.path} is not valid JSON, so it cannot be a trend-watcher state file (${err.message}); move it aside to start again`);
        throw err;
      }
      if (state?.version !== 1 || !Array.isArray(state.observations)) throw new UserError(`${this.path} is not a trend-watcher state file`);
      return state;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  async save(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
    await rename(tmp, this.path);
  }
}
