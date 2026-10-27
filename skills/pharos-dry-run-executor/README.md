# 8. Dry-Run Executor

> Know what a transaction will do, and what it will cost, before it is sent. Block it automatically if it would fail.

**Arena task:** SkillEngine · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/dry-run-executor)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/dry-run-executor/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/dry-run-executor

## What it does

Sending a transaction that reverts still costs gas, and sending one that does the wrong thing can cost much more. The Dry-Run Executor is a Pharos Skill that answers three questions first: will it succeed, what will it cost, and what will change.

## What is real

Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.

Real transaction to open: https://atlantic.pharosscan.xyz/tx/0x79363e34be685e5bff405cd648ab3c68a6a27243ca0905cc50f644003f2fd565

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Uses a call or gas estimation to simulate the transaction without broadcasting it. | Uses eth_call and estimate_gas on the live chain at a pinned block to simulate the transaction without broadcasting it. |
| 2 | Reports predicted success or revert, including the revert reason when available, and estimated gas cost. | Reports predicted success or revert, including the decoded revert reason (string, panic, or known custom error), and the estimated gas and its cost in PROS. |
| 3 | Shows the expected outcome, e.g. balances or state before and after where possible. | Shows the expected before/after for ERC-20 transfers, approvals and native value; the real testnet run and the fork run produce the actual outcome to compare against. |
| 4 | Blocks execution automatically if the simulation fails. | The gate blocks execution automatically when the simulation fails: the executor’s send is never called (unit-tested), and the CLI prints “EXECUTION BLOCKED”. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from 0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb --to 0xc879c018db60520f4355c26ed1a6d572cdac1815 --data $(cast calldata "transfer(address,uint256)" 0x000000000000000000000000000000000000dEaD 1000000)
… --fork --execute --watch 0xc879c018db60520f4355c26ed1a6d572cdac1815
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from 0x0000000000000000000000000000000000000001 --to 0xc879c018db60520f4355c26ed1a6d572cdac1815 --data <same calldata> --execute
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
DRY RUN  ·  block 20,918,943  ·  GO
  The simulation succeeded: the transaction would go through.
  gas: 58,353 units (suggest a limit of 70,024) at 10 gwei = 0.00058353 PROS
  outcome: Move 1 USDC from 0x1857…4efb to 0x0000…dead
    0x1857…4efb USDC: 1,242,441.562141 USDC  →  1,242,440.562141 USDC

  EXECUTED on the local fork: 0xa166bd2b…  (success, gas used 44843)
    fork state diff 0xc879c0…: 1242441562141 → 1242440562141 (-1000000)
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [references/dry-run-executor.md](references/dry-run-executor.md)
- [scripts/dryrun.mjs](scripts/dryrun.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js)
- [scripts/testnet-run.mjs](../../scripts/testnet-run.mjs)
- [public/js/tasks/dry-run-executor.js](../../public/js/tasks/dry-run-executor.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/testnet-runs.json](../../reports/testnet-runs.json)
- [contracts/Counter.sol](../../contracts/Counter.sol)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 10, 12, 13, 15, 17, 18, 19, 22), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 10, 11, 12, 17, 18, 19, 20, 21, 22), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 10, 11, 15, 16, 17, 18, 19), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/tasks/batch-executor.js](../../lib/tasks/batch-executor.js) (also task 10), [lib/testnet-contracts.js](../../lib/testnet-contracts.js) (also tasks 6, 10, 20), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 10, 11, 12, 17, 18, 19, 20, 22), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 10, 11, 20), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/dryrun.test.js test/revert.test.js
```

## Verify it yourself

- **Open the real transactions.** Every hash on the testnet card links to the Atlantic explorer. The sender is a throwaway wallet that only ever holds test tokens.
- **Re-run it with your own key.** Needs Foundry and a funded Atlantic testnet key in .wallet/atlantic-testnet.json. Without --live it rehearses on a free local fork of Atlantic.
- **Simulate it yourself.** The same simulation straight from the public RPC. A reverting call prints the revert reason.
- **Estimate the gas yourself.** Compare with the page’s estimate for the passing transfer.
- **Read the skill itself.** SKILL.md, the reference and the script are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
