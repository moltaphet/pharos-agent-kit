// Saga engine: run dependent on-chain steps one by one, verify each before the next,
// retry transient failures, and undo what already happened if a step fails for good.
// It only orchestrates; sending and receipts go through an injected `exec`, so the same
// engine runs against a local fork (real EVM), a simulator, or (later) a live wallet.
//
// step = { id, title, tx: () => ({ to, data, value?, from? }), verify?: async (receipt) => true | string,
//          compensate?: { title, tx: () => ({...}), verify?: async (receipt) => true | string } }
// exec = { send(tx) -> hash, receipt(hash) -> { status: 'success'|'reverted', hash, blockNumber, gasUsed } }

export const DEFAULT_POLICY = { maxAttempts: 3, baseDelayMs: 400, maxDelayMs: 4000 };

// Transient = worth retrying (network or mempool trouble). Everything else, notably a
// revert, is permanent: sending the same transaction again cannot fix it.
const TRANSIENT = /nonce too low|replacement transaction underpriced|underpriced|gas price too low|fee too low|timed? ?out|etimedout|econnreset|econnrefused|temporarily|rate limit|\b429\b|\b503\b|dropped|not found in mempool|try again/i;
export const classifyError = (err) => (TRANSIENT.test(err?.message ?? String(err)) ? 'transient' : 'permanent');

const delay = (policy, attempt) => Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);

// `onEvent(entry)` is called for every state-log entry the moment it happens, so a caller can stream the run live.
export async function runSaga({ name = 'saga', steps, exec, policy = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), onEvent }) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const t0 = now();
  const log = [];
  const emit = (event, extra = {}) => {
    const entry = { t: now() - t0, event, ...extra };
    log.push(entry);
    onEvent?.(entry);
  };
  const result = { name, status: 'running', policy: p, steps: steps.map((s) => ({ id: s.id, title: s.title, state: 'pending', attempts: 0 })), log, failure: null };
  const rec = (id) => result.steps.find((s) => s.id === id);

  // One transaction with the retry policy. Returns { ok, receipt?, error?, kind? }.
  async function attemptTx(label, id, make, verify) {
    for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
      const counter = label === 'step' ? 'attempts' : 'compensationAttempts'; // keep forward and undo attempts apart
      rec(id)[counter] = (rec(id)[counter] ?? 0) + 1;
      emit(`${label}:attempt`, { step: id, attempt });
      try {
        const hash = await exec.send(make());
        emit(`${label}:sent`, { step: id, attempt, txHash: hash });
        const receipt = await exec.receipt(hash);
        if (receipt.status !== 'success') return { ok: false, kind: 'permanent', error: `transaction reverted${receipt.reason ? `: ${receipt.reason}` : ''}`, receipt };
        const verdict = verify ? await verify(receipt) : true;
        if (verdict !== true) return { ok: false, kind: 'permanent', error: `verification failed: ${verdict || 'post-condition not met'}`, receipt };
        return { ok: true, receipt };
      } catch (err) {
        const kind = classifyError(err);
        if (kind === 'transient' && attempt < p.maxAttempts) {
          const wait = delay(p, attempt);
          emit(`${label}:retry`, { step: id, attempt, error: err.message, waitMs: wait, why: 'transient failure, retrying with backoff' });
          await sleep(wait);
          continue;
        }
        return { ok: false, kind, error: err.message, attemptsUsed: attempt };
      }
    }
    return { ok: false, kind: 'transient', error: 'retries exhausted' };
  }

  emit('saga:start', { steps: steps.map((s) => s.id) });
  const confirmed = [];
  for (const step of steps) {
    const r = rec(step.id);
    r.state = 'running';
    emit('step:start', { step: step.id, title: step.title });
    const out = await attemptTx('step', step.id, step.tx, step.verify);
    if (out.ok) {
      r.state = 'confirmed';
      r.txHash = out.receipt.hash;
      r.gasUsed = out.receipt.gasUsed;
      emit('step:confirmed', { step: step.id, txHash: out.receipt.hash, blockNumber: out.receipt.blockNumber, gasUsed: out.receipt.gasUsed });
      confirmed.push(step);
    } else {
      r.state = 'failed';
      r.error = out.error;
      result.failure = { step: step.id, kind: out.kind, error: out.error };
      emit('step:failed', { step: step.id, kind: out.kind, error: out.error });
      break;
    }
  }

  if (!result.failure) {
    result.status = 'completed';
    emit('saga:completed');
    return result;
  }

  // Compensation: undo confirmed steps, newest first.
  emit('compensation:start', { undo: confirmed.map((s) => s.id).reverse() });
  const stuck = [];
  for (const step of [...confirmed].reverse()) {
    const r = rec(step.id);
    if (!step.compensate) {
      r.state = 'not-undoable';
      stuck.push(step.id);
      emit('compensation:skipped', { step: step.id, why: 'no compensation defined for this step' });
      continue;
    }
    r.state = 'compensating';
    emit('compensation:start-step', { step: step.id, title: step.compensate.title });
    const out = await attemptTx('compensation', step.id, step.compensate.tx, step.compensate.verify);
    if (out.ok) {
      r.state = 'compensated';
      r.compensationTx = out.receipt.hash;
      emit('compensation:confirmed', { step: step.id, txHash: out.receipt.hash, gasUsed: out.receipt.gasUsed });
    } else {
      r.state = 'compensation-failed';
      stuck.push(step.id);
      emit('compensation:failed', { step: step.id, error: out.error });
    }
  }
  result.status = stuck.length ? 'compensation-failed' : 'compensated';
  if (stuck.length) result.stuck = stuck;
  emit(stuck.length ? 'saga:stuck' : 'saga:compensated', stuck.length ? { stuck } : {});
  return result;
}

// Wraps an executor so the first `times` sends of a given step fail with `message`
// (used to demonstrate the retry policy; always labelled as an injected fault).
export function withInjectedFault(exec, { match, times = 1, message = 'replacement transaction underpriced' }) {
  let left = times;
  return {
    ...exec,
    async send(tx) {
      if (left > 0 && match(tx)) {
        left--;
        throw new Error(`${message} (injected fault)`);
      }
      return exec.send(tx);
    },
  };
}
