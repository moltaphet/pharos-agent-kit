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

  // A network that lost a transaction (dropped, replaced) has to be sent again; any other transient trouble after the send (a slow receipt, a slow
  // verification read) is only a reason to ask again about the SAME transaction. Sending it again then would do the step twice.
  const LOST = /dropped|not found in mempool|replaced|replacement transaction underpriced|underpriced|nonce too low/i;

  // One transaction with the retry policy. Returns { ok, receipt?, error?, kind?, mined? }; `mined` means the transaction really executed (so its
  // effects are on chain even if a later check failed).
  async function attemptTx(label, id, make, verify) {
    let hash = null;
    let receipt = null;
    const minedNow = () => receipt?.status === 'success';
    for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
      const counter = label === 'step' ? 'attempts' : 'compensationAttempts'; // keep forward and undo attempts apart
      rec(id)[counter] = (rec(id)[counter] ?? 0) + 1;
      emit(`${label}:attempt`, { step: id, attempt });
      try {
        if (hash == null) {
          hash = await exec.send(make());
          emit(`${label}:sent`, { step: id, attempt, txHash: hash });
        }
        receipt ??= await exec.receipt(hash);
        if (receipt.status !== 'success') return { ok: false, kind: 'permanent', error: `transaction reverted${receipt.reason ? `: ${receipt.reason}` : ''}`, receipt, mined: false };
        const verdict = verify ? await verify(receipt) : true;
        if (verdict !== true) return { ok: false, kind: 'permanent', error: `verification failed: ${verdict || 'post-condition not met'}`, receipt, mined: true };
        return { ok: true, receipt };
      } catch (err) {
        const kind = classifyError(err);
        if (kind === 'transient' && attempt < p.maxAttempts) {
          const wait = delay(p, attempt);
          const resend = hash != null && !minedNow() && LOST.test(err?.message ?? '');
          if (resend) { hash = null; receipt = null; }
          emit(`${label}:retry`, { step: id, attempt, error: err.message, waitMs: wait, why: hash == null ? 'transient failure, retrying with backoff' : 'transient failure after the transaction was sent: asking again about the same transaction, not sending it twice' });
          await sleep(wait);
          continue;
        }
        return { ok: false, kind, error: err.message, attemptsUsed: attempt, receipt, mined: minedNow() };
      }
    }
    return { ok: false, kind: 'transient', error: 'retries exhausted', receipt, mined: minedNow() };
  }

  emit('saga:start', { steps: steps.map((s) => s.id) });
  const confirmed = [];
  let failedStep = null;
  let failedMined = false;
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
      emit('step:failed', { step: step.id, kind: out.kind, error: out.error, ...(out.mined && { mined: true }) });
      failedStep = step;
      failedMined = Boolean(out.mined);
      break;
    }
  }

  if (!result.failure) {
    result.status = 'completed';
    emit('saga:completed');
    return result;
  }

  // Compensation: undo what happened, newest first. A step whose transaction executed but failed its check (or whose check could not be completed)
  // has changed the chain too, so it is undone with the rest; a step that reverted changed nothing.
  const toUndo = failedStep && failedMined ? [...confirmed, failedStep] : confirmed;
  emit('compensation:start', { undo: toUndo.map((s) => s.id).reverse() });
  const stuck = [];
  for (const step of [...toUndo].reverse()) {
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
