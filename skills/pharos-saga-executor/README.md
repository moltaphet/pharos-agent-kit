# 6. Saga Executor

> Run dependent on-chain steps safely: verify each one, retry what is worth retrying, and undo everything if a step fails for good.

**Arena task:** SkillEngine · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/saga-executor)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/saga-executor/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/saga-executor

## What it does

Some workflows cannot be left half-done. “Approve USDC, deposit it into a vault, send the shares to the treasury” is three transactions, and if the third fails after the second succeeded you are left holding shares and an open approval you never meant to keep. The Saga Executor is a Pharos Skill for exactly that: it runs the steps in order, and if one fails permanently it walks back through the finished ones and undoes them.

## What is real

Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo). The retry and undo rules are also proved on the real Atlantic testnet: a step whose receipt times out is not sent twice, and a step that executed but failed its check is undone (the chain’s own ledger shows 1 instead of 3, and 0 instead of 1).

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | At least 3 dependent steps, each verified (receipt checked) before the next starts. | Three dependent steps (approve, deposit, transfer), each confirmed by its receipt and by a state check (allowance, shares, treasury balance) before the next starts. |
| 2 | A defined retry policy for transient failures, e.g. a gas spike or dropped transaction. | A defined retry policy: up to 3 attempts, exponential backoff, only for transient errors (underpriced, nonce, timeout, dropped, 429/503); reverts are never retried. Shown in the retry scenario and in the recorded success run. |
| 3 | A defined compensation/rollback path when a step permanently fails, and a demo of it. | A compensation path (bring shares back, redeem, revoke approval) with a demo: the forced-failure scenario runs for real on a fork, right here on this page. |
| 4 | A state log showing exactly which step the saga is in at any time. | A state log records every transition with a timestamp: step start, attempt, sent, confirmed, retry, failed, compensation, and the final outcome. |
| 5 | Shows one fully successful run and one forced-failure run with recovery. | Four real scenarios run on demand against a fork of Pharos mainnet (success, retry, forced failure with full recovery, stuck undo), plus the earlier success and failure runs recorded in reports/saga-runs.json with their provenance. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-saga-executor/scripts/saga.mjs
node skills/pharos-saga-executor/scripts/saga.mjs --scenario failure --out run.json
node skills/pharos-saga-executor/scripts/saga.mjs --scenario stuck --stream
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
=== vault-saga:failure → COMPENSATED ===
    0 ms  step:start                 approve
    8 ms  step:confirmed             approve
   19 ms  step:confirmed             deposit
16149 ms  step:failed                transfer  transaction reverted: ZeroAddress
16835 ms  compensation:confirmed     deposit
16839 ms  compensation:confirmed     approve
16839 ms  saga:compensated
final state: USDC 999999999 (started 1000000000, spent 1), account shares 0, allowance 0, treasury shares 0
expected: everything undone, nothing left behind → AS EXPECTED
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [references/saga-executor.md](references/saga-executor.md)
- [scripts/saga.mjs](scripts/saga.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/saga-executor.js](../../lib/tasks/saga-executor.js)
- [lib/saga-sandbox.js](../../lib/saga-sandbox.js)
- [scripts/testnet-saga.mjs](../../scripts/testnet-saga.mjs)
- [public/js/tasks/saga-executor.js](../../public/js/tasks/saga-executor.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/saga-runs.json](../../reports/saga-runs.json)
- [reports/testnet-saga.json](../../reports/testnet-saga.json)
- [contracts/Ledger.sol](../../contracts/Ledger.sol)
- [config/saga-snapshot.json](../../config/saga-snapshot.json)
- [scripts/build-saga-snapshot.mjs](../../scripts/build-saga-snapshot.mjs)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/saga-scenario.js](../../lib/saga-scenario.js), [lib/saga-sim.js](../../lib/saga-sim.js), [lib/saga.js](../../lib/saga.js), [scripts/support/saga-before-fix.js](../../scripts/support/saga-before-fix.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/keccak.js](../../lib/keccak.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 7, 8, 10, 11, 15, 16, 17, 18, 19), [lib/sandbox-run.js](../../lib/sandbox-run.js) (also task 7), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-contracts.js](../../lib/testnet-contracts.js) (also tasks 8, 10, 20, 27), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 8, 10, 11, 12, 17, 18, 19, 20, 22, 23, 25, 26, 27, 28), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 8, 10, 11, 20, 24, 25, 27, 29), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

6 test files cover this task (run all of them with `npm test`):

```bash
node --test test/saga.test.js test/saga-fidelity.test.js test/saga-fork.test.js test/saga-sandbox.test.js test/start-fork.test.js test/saga-testnet.test.js
```

## Verify it yourself

- **The vault is real.** The deposit goes into the RockawayX USDC vault on Pharos mainnet. Open it on the explorer.
- **Reproduce a run on your own machine.** Needs Foundry (anvil 1.4.0 works; the newest versions cannot fork Pharos). This forks mainnet, runs both recorded scenarios and exits 0 only if both ended as expected. Transaction hashes exist only on a fork, so they will not appear on the explorer.
- **Check the revert reason yourself.** The forced failure is a real revert of the vault’s transfer to the zero address.
- **Read the recorded runs.** The recorded state logs and final checks are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
