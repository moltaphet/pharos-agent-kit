# 6. Saga Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/saga-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/saga-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-saga-executor
- **What the proof shows:** Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo).

## Requirements it was built against (the Arena’s own list)

1. At least 3 dependent steps, each verified (receipt checked) before the next starts.
   - Met by: Three dependent steps (approve, deposit, transfer), each confirmed by its receipt and by a state check (allowance, shares, treasury balance) before the next starts.
2. A defined retry policy for transient failures, e.g. a gas spike or dropped transaction.
   - Met by: A defined retry policy: up to 3 attempts, exponential backoff, only for transient errors (underpriced, nonce, timeout, dropped, 429/503); reverts are never retried. Shown in the retry scenario and in the recorded success run.
3. A defined compensation/rollback path when a step permanently fails, and a demo of it.
   - Met by: A compensation path (bring shares back, redeem, revoke approval) with a demo: the forced-failure scenario runs for real on a fork, right here on this page.
4. A state log showing exactly which step the saga is in at any time.
   - Met by: A state log records every transition with a timestamp: step start, attempt, sent, confirmed, retry, failed, compensation, and the final outcome.
5. Shows one fully successful run and one forced-failure run with recovery.
   - Met by: Four real scenarios run on demand against a fork of Pharos mainnet (success, retry, forced failure with full recovery, stuck undo), plus the earlier success and failure runs recorded in reports/saga-runs.json with their provenance.

Code and notes: [skills/pharos-saga-executor/README.md](../skills/pharos-saga-executor/README.md)
