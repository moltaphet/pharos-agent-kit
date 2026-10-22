// Task: Saga Executor (Skill). The engine lives in lib/saga.js. This handler runs it with
// the in-memory simulator for the interactive demo, and serves the recorded real-EVM runs
// (anvil fork of Pharos mainnet) as evidence.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runSaga, withInjectedFault } from '../saga.js';
import { SEL, VAULT, vaultSaga } from '../saga-scenario.js';
import { simIO } from '../saga-sim.js';
import { UserError } from '../snapshot.js';

const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const TREASURY = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
export const SCENARIOS = {
  success: 'All three steps succeed.',
  retry: 'The deposit hits a transient error twice (a dropped transaction / gas spike), then succeeds.',
  failure: 'Step 3 fails for good (the shares are sent to the zero address); the saga undoes steps 2 and 1.',
  stuck: 'Step 3 fails, and then the vault is paused so step 2 cannot be undone. The saga reports it honestly.',
};

const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

export async function simulate({ scenario, maxAttempts = 3 }) {
  if (!SCENARIOS[scenario]) throw new UserError(`scenario must be one of ${Object.keys(SCENARIOS).join(', ')}`);
  const attempts = Number(maxAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new UserError('maxAttempts must be 1 to 5');
  const io = simIO({ account: ACCOUNT, treasury: TREASURY });
  const saga = vaultSaga({ io, account: ACCOUNT, treasury: TREASURY, amount: 100_000_000n, failStep3: scenario === 'failure' || scenario === 'stuck' });
  let exec = io;
  if (scenario === 'retry') exec = withInjectedFault(io, { match: (tx) => tx.data.startsWith(SEL.deposit), times: 2, message: 'transaction dropped from the mempool' });
  if (scenario === 'stuck') {
    const inner = io;
    exec = { ...inner, send: (tx) => (tx.data.startsWith(SEL.redeem) ? Promise.reject(new Error('execution reverted: vault is paused')) : inner.send(tx)) };
  }
  const result = await runSaga({ name: `vault-saga:${scenario}`, steps: saga.steps, exec, policy: { maxAttempts: attempts, baseDelayMs: 50, maxDelayMs: 200 } });
  result.finalCheck = await saga.finalCheck(result.status === 'completed' ? 'completed' : 'compensated');
  return JSON.parse(JSON.stringify({ ...result, scenario, description: SCENARIOS[scenario], vault: VAULT }, big));
}

// What matters about a log entry for "did the engine behave the same": the event, the step, the attempt
// number and whether it carried an error. Timings, hashes, block numbers and gas differ by nature.
export const shape = (log) => log.map((e) => [e.event, e.step ?? '', e.attempt ?? '', e.error ? 'error' : ''].join('|'));

// Replays the configuration of each recorded real-EVM run through the in-memory simulator that the web
// demo uses, and compares the two logs entry by entry. If they match, the demo is a faithful stand-in.
export async function fidelity(rec) {
  const rows = [];
  for (const run of rec.runs) {
    const kind = run.name.split(':')[1];
    const io = simIO({ account: ACCOUNT, treasury: TREASURY });
    const saga = vaultSaga({ io, account: ACCOUNT, treasury: TREASURY, amount: 100_000_000n, failStep3: kind === 'failure' });
    // The recorded success run injected one transient deposit error to show the retry policy; do the same.
    const exec = kind === 'success' ? withInjectedFault(io, { match: (tx) => tx.data.startsWith(SEL.deposit), times: 1 }) : io;
    const sim = await runSaga({ name: run.name, steps: saga.steps, exec, policy: { maxAttempts: run.policy?.maxAttempts ?? 3, baseDelayMs: 50, maxDelayMs: 200 } });
    const real = shape(run.log);
    const simulated = shape(sim.log);
    const at = real.findIndex((x, i) => x !== simulated[i]);
    const first = at === -1 && real.length === simulated.length ? null : Math.max(at, 0);
    rows.push({
      run: run.name,
      realEntries: real.length,
      simulatedEntries: simulated.length,
      sameStatus: run.status === sim.status,
      identical: first === null && run.status === sim.status,
      firstDifference: first === null ? null : { index: first, real: real[first] ?? '(none)', simulated: simulated[first] ?? '(none)' },
    });
  }
  return { compared: 'event, step, attempt number and whether an error was attached; not timings, hashes, block numbers or gas', rows };
}

async function recorded() {
  const file = fileURLToPath(new URL('../../reports/saga-runs.json', import.meta.url));
  const rec = JSON.parse(await readFile(file, 'utf8'));
  return { ...rec, fidelity: await fidelity(rec) };
}

export default async function run({ q }) {
  if (q.scenario === 'recorded') return { recorded: await recorded() };
  return { simulated: await simulate({ scenario: q.scenario ?? 'success', maxAttempts: q.maxAttempts ?? 3 }), scenarios: SCENARIOS };
}
