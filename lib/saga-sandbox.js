// Runs the Saga Executor for real, on demand, inside a Vercel Sandbox: an ephemeral Firecracker microVM that boots from a
// snapshot with Foundry installed, forks Pharos mainnet with anvil, and executes the saga as real EVM transactions.
// Vercel's functions cannot run anvil, and a run takes 1-2 minutes, so a run is started and then polled:
//   startRun()   boots the VM, uploads the engine, starts the script detached, returns an id at once
//   runStatus()  reads the script's JSON-lines output so the page can show events as they happen
//
// What a visitor can influence: one of four fixed scenarios and a retry limit (1-5). Nothing they send reaches a
// command line. The VM may only reach rpc.pharos.xyz, lives for at most 6 minutes, and at most 2 run at once.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError } from './snapshot.js';

export const SCENARIOS = {
  plain: 'Success: all three steps',
  retry: 'Retry: the deposit is dropped twice, then lands',
  failure: 'Forced failure: step 3 reverts, undo steps 2 and 1',
  stuck: 'Stuck: step 3 fails and the undo of the deposit is blocked',
};
export const LIMITS = { maxActive: 2, maxPerHour: 40, cooldownMs: 15_000, timeoutMs: 6 * 60_000, vcpus: 2 };
const TAG = { app: 'pharos-saga-demo' };
// Absolute paths under /tmp: a sandbox booted from a snapshot does not have /vercel/sandbox, and the default working
// directory differs between images.
const ROOT = '/tmp/saga-run';
const ID = /^saga-(plain|retry|failure|stuck)-[a-z0-9]{8}$/;

// The engine and its script, uploaded fresh on every run so the demo always runs the deployed code.
const FILES = [
  'lib/saga.js', 'lib/saga-scenario.js', 'lib/saga-fork.js', 'lib/abi.js', 'lib/protocols.js', 'lib/rpc.js', 'lib/trace.js', 'lib/limit.js',
  'skills/pharos-saga-executor/scripts/saga.mjs',
];
const repoFile = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

export class BusyError extends Error {
  httpStatus = 429;
}

// Limits are enforced from the Sandbox listing itself (creation time, status and a hashed-visitor tag), so they hold
// across serverless instances; an in-memory counter would only see the instance that happened to answer.
export const visitorId = (ip) => createHash('sha256').update(`pharos-saga-demo:${ip}`).digest('hex').slice(0, 10); // the raw IP is never stored
export const resetCooldowns = () => {}; // kept for callers; there is no per-instance state any more

async function loadSdk() {
  return (await import('@vercel/sandbox')).Sandbox;
}

async function snapshotId() {
  return JSON.parse(await readFile(repoFile('config/saga-snapshot.json'), 'utf8')).snapshotId;
}

export function validate({ scenario, maxAttempts = 3 }) {
  if (!SCENARIOS[scenario]) throw new UserError(`scenario must be one of ${Object.keys(SCENARIOS).join(', ')}`);
  const attempts = Number(maxAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new UserError('maxAttempts must be 1 to 5');
  return { scenario, attempts };
}

export const runCommandLine = (scenario, attempts) =>
  `cd ${ROOT}/app && PATH=$HOME/.foundry/bin:$PATH node skills/pharos-saga-executor/scripts/saga.mjs --scenario ${scenario} --max-attempts ${attempts} --stream > ${ROOT}/run.ndjson 2> ${ROOT}/run.err; echo $? > ${ROOT}/run.exit`;

export async function startRun({ scenario, maxAttempts, ip = 'unknown' }, { Sandbox, now = () => Date.now(), random = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0') } = {}) {
  const { scenario: sc, attempts } = validate({ scenario, maxAttempts });
  Sandbox ??= await loadSdk();
  const visitor = visitorId(ip);

  const all = [];
  for await (const sb of await Sandbox.list({ tags: TAG })) all.push(sb);
  const isActive = (sb) => ['pending', 'running'].includes(sb.status);
  const mine = all.filter((sb) => sb.tags?.visitor === visitor);
  const active = all.filter(isActive);
  if (active.length >= LIMITS.maxActive) throw new BusyError(`${active.length} runs are already in progress (the limit is ${LIMITS.maxActive}). Each takes 1 to 2 minutes; try again shortly.`);
  if (mine.some(isActive)) throw new BusyError('You already have a run in progress. Wait for it to finish (about 30 seconds).');
  const sinceLast = now() - Math.max(0, ...mine.map((sb) => sb.createdAt));
  if (mine.length && sinceLast < LIMITS.cooldownMs) throw new BusyError(`Please wait ${Math.ceil((LIMITS.cooldownMs - sinceLast) / 1000)} seconds before starting another run.`);
  if (all.filter((sb) => now() - sb.createdAt < 3_600_000).length >= LIMITS.maxPerHour) throw new BusyError('The live demo has reached its hourly limit. Please try again later, or read the recorded runs below.');

  const id = `saga-${sc}-${random()}`;
  const sandbox = await Sandbox.create({
    name: id,
    source: { type: 'snapshot', snapshotId: await snapshotId() },
    timeout: LIMITS.timeoutMs,
    resources: { vcpus: LIMITS.vcpus },
    persistent: false,
    tags: { ...TAG, visitor },
    networkPolicy: { allow: ['rpc.pharos.xyz'] },
  });
  try {
    await sandbox.writeFiles([
      { path: `${ROOT}/app/package.json`, content: Buffer.from('{"type":"module"}\n') }, // ES modules, without depending on the deployed package.json
      ...(await Promise.all(FILES.map(async (rel) => ({ path: `${ROOT}/app/${rel}`, content: await readFile(repoFile(rel)) })))),
    ]);
    await sandbox.runCommand({ cmd: 'bash', args: ['-lc', runCommandLine(sc, attempts)], detached: true });
  } catch (err) {
    await sandbox.stop().catch(() => {});
    throw err;
  }
  return { id, scenario: sc, startedAt: now(), limits: { maxSeconds: LIMITS.timeoutMs / 1000 } };
}

const parseLines = (text) => {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a partially written last line: it will be complete on the next poll
    }
  }
  return out;
};

export async function runStatus({ id, from = 0 }, { Sandbox } = {}) {
  if (!ID.test(id ?? '')) throw new UserError('unknown run id');
  Sandbox ??= await loadSdk();
  let sandbox;
  try {
    sandbox = await Sandbox.get({ name: id, resume: false });
  } catch {
    return { state: 'gone', message: 'This run has finished or timed out and its machine has been removed. Start a new run.' };
  }
  // Never read from a machine that has been stopped: reading a file auto-resumes it, which would bring a finished
  // machine back to life (running until its timeout) every time the page, a second tab or a retry asks again.
  if (['stopped', 'stopping', 'failed', 'aborted', 'snapshotting'].includes(sandbox.status)) {
    return { state: 'gone', message: 'This run has finished or timed out and its machine has been removed. Start a new run.' };
  }
  const read = async (path) => (await sandbox.readFileToBuffer({ path }).catch(() => null))?.toString('utf8') ?? null;
  const [ndjson, exit, err] = await Promise.all([read(`${ROOT}/run.ndjson`), read(`${ROOT}/run.exit`), read(`${ROOT}/run.err`)]);
  const lines = parseLines(ndjson ?? '');
  const result = lines.find((l) => l.type === 'result')?.record ?? null;
  const failure = lines.find((l) => l.type === 'error')?.message ?? null;
  const phases = lines.filter((l) => l.type === 'phase');
  const events = lines.filter((l) => l.type === 'event').map((l) => l.event);
  const finished = exit !== null;
  const state = finished ? (result ? 'done' : 'failed') : 'running';
  // The machine is no longer needed once the result is read. A failed stop is reported, not hidden: the machine would
  // still be removed by its 6 minute timeout, but a leak should be visible.
  let stopError = null;
  if (finished) {
    try {
      await sandbox.stop();
    } catch (err) {
      stopError = err.message;
      console.error(`saga sandbox ${id}: stop failed: ${err.message}`);
    }
  }
  return {
    state,
    phase: phases.at(-1)?.message ?? 'Starting the machine…',
    forkBlock: phases.find((p) => p.forkBlock)?.forkBlock ?? null,
    events: events.slice(from),
    total: events.length,
    result,
    ...(stopError && { stopError }),
    error: state === 'failed' ? failure ?? err?.trim().split('\n').slice(-3).join(' ') ?? 'the run failed' : null,
  };
}
