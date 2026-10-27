# 10. Batch Executor

> Do several independent things in one transaction, with the real gas change and a clear answer to “which one failed?”.

**Arena task:** SkillEngine · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/batch-executor)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/batch-executor/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/batch-executor

## What it does

Sometimes you have a handful of independent jobs: poke several pools, pay several people. Sending them one by one means one signature, one fee and one chance to fail for each. The Batch Executor is a Pharos Skill that bundles three or more of them into a single Multicall3 transaction and prepares it for you to sign.

## What is real

Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.

Real transaction to open: https://atlantic.pharosscan.xyz/tx/0x37fd3313534ab882ddc5f5e35ebdc8f5efb5aee62474dd2e352fc9bfec0e34e3

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Accepts a list of at least 3 independent actions. | Accepts a list of at least 3 independent actions (up to 25), validated one by one. |
| 2 | Executes them as a batch: multicall, a single prepared transaction, or an equivalent. | Executes them as one batch: a single Multicall3.aggregate3Value transaction, prepared unsigned, whose encoding matches `cast calldata`. |
| 3 | Reports the gas saving or step reduction compared with running them individually. | Reports the gas and step change against sending them one by one: estimated here, and measured on a real-EVM fork (178,977 → 150,762 gas for the sync workload; and honestly +70% for plain transfers). |
| 4 | Handles partial failure clearly: which action failed and what happened to the rest. | Handles partial failure by name: each failing action is listed with its reason, the policy decides whether to exclude it or abort, and forcing it in makes the whole batch revert with nothing changed. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-batch-executor/scripts/batch.mjs --from 0x9f8ea09770dc38fc61f5a62031b3be0526d54d92 --actions skills/pharos-batch-executor/examples/sync-pairs.json
… --fork --out run.json
… --actions skills/pharos-batch-executor/examples/native-transfers.json
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
PLAN @ block 20,920,350  ·  3 actions in 1 transaction: saves 36,893 gas (15.2%); 1 left out.
  a1  IN   0 PROS → 0xb7d5d299…  solo gas 80,751
  a4  FAILS 0 PROS → 0xc879c018…  the call reverted without a reason
  1 transaction instead of 3: estimated gas 243,043 → 206,150

FORK (real EVM, throwaway): one by one used 178,977 gas; the batch used 150,762 gas (success); saved 28,215 (15.8%)
  forcing the failing action into the batch: the WHOLE batch reverts (Multicall3: call failed); no recipient balance changed: yes
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/native-transfers.json](examples/native-transfers.json)
- [examples/sync-pairs.json](examples/sync-pairs.json)
- [references/batch-executor.md](references/batch-executor.md)
- [scripts/batch.mjs](scripts/batch.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/batch-executor.js](../../lib/tasks/batch-executor.js)
- [scripts/testnet-run.mjs](../../scripts/testnet-run.mjs)
- [scripts/batch-sender-proof.mjs](../../scripts/batch-sender-proof.mjs)
- [public/js/tasks/batch-executor.js](../../public/js/tasks/batch-executor.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/batch-runs.json](../../reports/batch-runs.json)
- [reports/batch-sender-proof.json](../../reports/batch-sender-proof.json)
- [reports/testnet-runs.json](../../reports/testnet-runs.json)
- [contracts/Counter.sol](../../contracts/Counter.sol)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 12, 13, 15, 17, 18, 19, 22, 23, 25, 26), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 11, 15, 16, 17, 18, 19), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 12, 17, 18, 19, 22, 23, 25, 26), [lib/testnet-contracts.js](../../lib/testnet-contracts.js) (also tasks 6, 8, 20), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 11, 12, 17, 18, 19, 20, 22, 23, 25, 26), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 11, 20, 24, 25), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/batch.test.js test/multicall.test.js
```

## Verify it yourself

- **Open the real transactions.** Every hash on the testnet card links to the Atlantic explorer, including the one-transaction batch and the three separate ones it replaces.
- **Check the encoding yourself.** cast encodes a batch of two calls to the same bytes the planner produces for them.
- **Check a solo cost yourself.** The planner’s “solo gas” for one sync() call.
- **Reproduce the real-EVM comparison.** Needs Foundry. Prints actual gas used for both ways and the all-or-nothing revert.
- **Read the skill itself.** SKILL.md, the reference, the script and the example action lists are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
