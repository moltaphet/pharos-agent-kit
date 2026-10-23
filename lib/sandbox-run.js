// Runs a script for real, on demand, inside a Vercel Sandbox: an ephemeral Firecracker microVM that boots from a snapshot with
// Foundry installed, forks Pharos mainnet with anvil and executes real EVM transactions. Vercel's functions cannot run anvil, and
// a run takes a minute or two, so a run is started and then polled:
//   startRun()   boots the VM, uploads the files, starts the script detached, returns an id at once
//   runStatus()  reads the script's JSON-lines output so the page can show events as they happen
//
// What a visitor can influence is one scenario from a fixed list (and, for Saga, a retry limit of 1-5). Nothing they send
// reaches a command line. The VM may only reach rpc.pharos.xyz, lives for at most 6 minutes, and the limits below are read
// from Vercel's own sandbox listing, so they hold across serverless instances.
//
// The script speaks one JSON object per line: {type:'phase', message, forkBlock?} | {type:'event', event} | {type:'result',
// record} | {type:'error', message}.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError } from './snapshot.js';

export const LIMITS = { maxActive: 2, maxPerHour: 40, cooldownMs: 15_000, timeoutMs: 6 * 60_000, vcpus: 2 };
const TAG = { app: 'pharos-agent-kit-demo' };
// Absolute paths under /tmp: a sandbox booted from a snapshot has no /vercel/sandbox, and the default directory differs between images.
const ROOT = '/tmp/demo-run';
const repoFile = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

export class BusyError extends Error {
  httpStatus = 429;
}

// The raw IP is never stored: a short salted hash identifies a visitor for the limits.
export const visitorId = (ip) => createHash('sha256').update(`pharos-saga-demo:${ip}`).digest('hex').slice(0, 10);

async function loadSdk() {
  return (await import('@vercel/sandbox')).Sandbox;
}
const snapshotId = async () => JSON.parse(await readFile(repoFile('config/saga-snapshot.json'), 'utf8')).snapshotId;

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

// config: { demo, scenarios: {id: label}, files: [repo-relative paths], script: repo-relative path, extraArgs?: (attempts) => string,
//           takesAttempts?: boolean }
export function createSandboxRunner(config) {
  const { demo, scenarios, files, script, takesAttempts = false } = config;
  const idPattern = new RegExp(`^${demo}-(${Object.keys(scenarios).join('|')})-[a-z0-9]{8}$`);

  function validate({ scenario, maxAttempts = 3 }) {
    if (!Object.hasOwn(scenarios, scenario)) throw new UserError(`scenario must be one of ${Object.keys(scenarios).join(', ')}`);
    const attempts = Number(maxAttempts);
    if (takesAttempts && (!Number.isInteger(attempts) || attempts < 1 || attempts > 5)) throw new UserError('maxAttempts must be 1 to 5');
    return { scenario, attempts: takesAttempts ? attempts : null };
  }

  const runCommandLine = (scenario, attempts) =>
    `cd ${ROOT}/app && PATH=$HOME/.foundry/bin:$PATH node ${script} --scenario ${scenario}${takesAttempts ? ` --max-attempts ${attempts}` : ''} --stream > ${ROOT}/run.ndjson 2> ${ROOT}/run.err; echo $? > ${ROOT}/run.exit`;

  async function startRun({ scenario, maxAttempts, ip = 'unknown' }, { Sandbox, now = () => Date.now(), random = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0') } = {}) {
    const { scenario: sc, attempts } = validate({ scenario, maxAttempts });
    Sandbox ??= await loadSdk();
    const visitor = visitorId(ip);

    const all = [];
    for await (const sb of await Sandbox.list({ tags: TAG })) all.push(sb);
    const isActive = (sb) => ['pending', 'running'].includes(sb.status);
    const mine = all.filter((sb) => sb.tags?.visitor === visitor);
    const active = all.filter(isActive);
    if (active.length >= LIMITS.maxActive) throw new BusyError(`${active.length} runs are already in progress (the limit is ${LIMITS.maxActive}). Each takes 1 to 2 minutes; try again shortly.`);
    if (mine.some(isActive)) throw new BusyError('You already have a run in progress. Wait for it to finish.');
    const sinceLast = now() - Math.max(0, ...mine.map((sb) => sb.createdAt));
    if (mine.length && sinceLast < LIMITS.cooldownMs) throw new BusyError(`Please wait ${Math.ceil((LIMITS.cooldownMs - sinceLast) / 1000)} seconds before starting another run.`);
    if (all.filter((sb) => now() - sb.createdAt < 3_600_000).length >= LIMITS.maxPerHour) throw new BusyError('The live demos have reached their hourly limit. Please try again later, or read the recorded runs.');

    const id = `${demo}-${sc}-${random()}`;
    const sandbox = await Sandbox.create({
      name: id,
      source: { type: 'snapshot', snapshotId: await snapshotId() },
      timeout: LIMITS.timeoutMs,
      resources: { vcpus: LIMITS.vcpus },
      persistent: false,
      tags: { ...TAG, demo, visitor },
      networkPolicy: { allow: ['rpc.pharos.xyz'] },
    });
    try {
      await sandbox.writeFiles([
        { path: `${ROOT}/app/package.json`, content: Buffer.from('{"type":"module"}\n') }, // ES modules, without depending on the deployed package.json
        ...(await Promise.all(files.map(async (rel) => ({ path: `${ROOT}/app/${rel}`, content: await readFile(repoFile(rel)) })))),
      ]);
      await sandbox.runCommand({ cmd: 'bash', args: ['-lc', runCommandLine(sc, attempts)], detached: true });
    } catch (err) {
      await sandbox.stop().catch(() => {});
      throw err;
    }
    return { id, scenario: sc, startedAt: now(), limits: { maxSeconds: LIMITS.timeoutMs / 1000 } };
  }

  async function runStatus({ id, from = 0 }, { Sandbox } = {}) {
    if (!idPattern.test(id ?? '')) throw new UserError('unknown run id');
    Sandbox ??= await loadSdk();
    let sandbox;
    try {
      sandbox = await Sandbox.get({ name: id, resume: false });
    } catch {
      return { state: 'gone', message: 'This run has finished or timed out and its machine has been removed. Start a new run.' };
    }
    // Never read from a machine that has been stopped: reading a file auto-resumes it, which would bring a finished machine back
    // to life (running until its timeout) every time the page, a second tab or a retry asks again.
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
    // The machine is no longer needed once the result is read. A failed stop is reported, not hidden: the machine would still be
    // removed by its 6 minute timeout, but a leak should be visible.
    let stopError = null;
    if (finished) {
      try {
        await sandbox.stop();
      } catch (e) {
        stopError = e.message;
        console.error(`sandbox ${id}: stop failed: ${e.message}`);
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

  return { demo, scenarios, validate, runCommandLine, startRun, runStatus, idPattern };
}
