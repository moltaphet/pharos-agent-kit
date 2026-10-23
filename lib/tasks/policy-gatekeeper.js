// Task: Policy Gatekeeper (Skill).
//
// Sits in front of an agent's actions. Each request is checked against a policy (spend limit,
// allowlist, time window); the answer is allow or deny plus the specific rule that decided it,
// a denied request never reaches the executor, and every decision goes into a hash-chained
// audit log. The web evaluator runs the same engine as the CLI and the testnet run, but its
// "executor" only counts calls: it broadcasts nothing. The recorded testnet run
// (reports/testnet-gatekeeper.json) is where allowed requests really become transactions.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MemoryLog, guardedExecute, verifyLog } from '../audit-log.js';
import { getBlock, pinnedBlock } from '../chain.js';
import { parsePolicy } from '../policy.js';
import { UserError } from '../snapshot.js';
import { ATLANTIC } from '../rpc-chain.js';
import { rpcCall } from '../rpc.js';
import { testnetEvidence } from '../testnet-report.js';

export const MAX_REQUESTS = 50;
const EXAMPLES = fileURLToPath(new URL('../../skills/pharos-policy-gatekeeper/examples/', import.meta.url));
export const readExample = async (name) => JSON.parse(await readFile(EXAMPLES + name, 'utf8'));

function parseAt(at, where) {
  const ms = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(at) ? Date.parse(at) : NaN;
  if (Number.isNaN(ms)) throw new UserError(`${where}: "at" must be a UTC time like 2026-10-26T10:00:00Z`);
  return Math.floor(ms / 1000);
}

// Pure: run requests through the gate one after another, in order, sharing one audit log.
// `clock()` gives the time for a request that has no "at". Returns what the page and CLI show.
export async function runGate({ policy: policySource, requests, clock, log = new MemoryLog() }) {
  let policy;
  try {
    policy = parsePolicy(policySource);
  } catch (err) {
    if (err instanceof SyntaxError) throw new UserError(`the policy is not valid JSON: ${err.message}`);
    throw err;
  }
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_REQUESTS) throw new UserError(`requests must be a list of 1 to ${MAX_REQUESTS} requests`);

  const executorCalls = [];
  const results = [];
  for (const [i, raw] of requests.entries()) {
    const { at, ...request } = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { __unreadable: true };
    const nowSec = at != null ? parseAt(at, `request ${i + 1}`) : await clock();
    const r = await guardedExecute({
      policy, log, request, nowSec,
      // Counts calls; broadcasts nothing. A deny must leave this untouched.
      execute: async (req) => {
        executorCalls.push(req.id ?? i + 1);
        return { note: 'the web evaluator does not broadcast; see the recorded testnet run for real transactions' };
      },
    });
    results.push({ index: i + 1, id: raw?.id ?? null, nowSec, clock: at != null ? 'request' : 'chain', decision: r.decision, executed: r.executed, executorCalled: r.executed });
  }
  const entries = await log.all();
  const denied = results.filter((r) => r.decision.decision === 'deny');
  return {
    policy: { name: policy.name, hash: policy.hash, types: policy.types, rules: policy.rules.map((r) => ({ id: r.id, type: r.type })) },
    results,
    summary: {
      requests: results.length,
      allowed: results.length - denied.length,
      denied: denied.length,
      deniedByRule: Object.fromEntries([...new Set(denied.map((d) => d.decision.rule.id))].map((id) => [id, denied.filter((d) => d.decision.rule.id === id).length])),
      deniedThatReachedTheExecutor: denied.filter((d) => d.executorCalled).length,
      executorCalls: executorCalls.length,
    },
    log: entries,
    integrity: verifyLog(entries),
  };
}

// The block time of the chain's pinned block: the clock for requests that give no "at".
async function chainClock(chain) {
  const block = await pinnedBlock(chain, 'Pick the block whose time the policy uses');
  return (await getBlock(chain, block, 'Get the block time the policy rules are checked against')).timestamp;
}

// Shows that the chain catches tampering: change one entry in a COPY of the log (flip its decision or its execution status) and verify the copy.
export function tamperDemo(entries, seq) {
  if (!Number.isInteger(seq) || seq < 0 || seq >= entries.length) throw new UserError(`tamper must be the number of an entry, 0 to ${entries.length - 1}`);
  const copy = structuredClone(entries);
  const e = copy[seq];
  let change;
  if (e.kind === 'decision') {
    const was = e.body.decision;
    e.body.decision = was === 'allow' ? 'deny' : 'allow';
    change = `entry ${seq} (decision): "${was}" rewritten to "${e.body.decision}"`;
  } else {
    const was = e.body.status;
    e.body.status = was === 'executed' ? 'not-executed' : 'executed';
    change = `entry ${seq} (execution): "${was}" rewritten to "${e.body.status}"`;
  }
  return { seq, change, integrity: verifyLog(copy) };
}

// The recorded testnet run, re-checked now: transactions (testnetEvidence), the audit log's hash chain, and the balances of the recipients.
export async function gatekeeperEvidence() {
  const evidence = await testnetEvidence({ name: 'testnet-gatekeeper.json' });
  const rec = evidence.report;
  const auditNow = verifyLog(rec.auditLog.entries);
  const balancesNow = await Promise.all(rec.proof.balances.map(async (b) => {
    try {
      const wei = BigInt(await rpcCall('eth_getBalance', [b.address, 'latest'], { url: ATLANTIC.rpc, why: `Read ${b.label} balance now` })).toString();
      return { address: b.address, wei, matchesRecorded: wei === b.chainWei };
    } catch (err) {
      return { address: b.address, wei: null, matchesRecorded: false, error: err.message };
    }
  }));
  return { ...evidence, auditNow, balancesNow };
}

export default async function run({ q, body, chain }) {
  if (q.real === 'testnet') return { testnet: await gatekeeperEvidence() };
  if (q.example) return { policy: await readExample('policy.json'), requests: await readExample('requests.json') };
  if (!body || typeof body !== 'object') throw new UserError('POST a JSON body: { "policy": {...}, "requests": [...] }');
  let clockValue;
  const clock = async () => (clockValue ??= await chainClock(chain));
  const gate = await runGate({ policy: body.policy, requests: body.requests, clock });
  const tamper = body.tamper === undefined || body.tamper === '' || body.tamper === null ? null : tamperDemo(gate.log, Number(body.tamper));
  return { gate, ...(tamper && { tamper }) };
}
