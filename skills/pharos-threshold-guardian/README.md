# 5. Threshold Guardian

> Decide whether to act by checking several live conditions together, and explain the decision condition by condition.

**Arena task:** SkillEngine · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/threshold-guardian)  
**Try it:** https://pharos-agent-kit.vercel.app/#/threshold-guardian/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/threshold-guardian

## What it does

Most bots fail the same way: they fire on one noisy signal. A rebalance that is cheap in gas but pointless, or profitable on paper but with no liquidity to execute against. The Threshold Guardian is a Pharos Skill that refuses to act on one reading. It evaluates several independent on-chain conditions together and answers FIRE or HOLD.

## What is real

Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.

Real transaction to open: https://atlantic.pharosscan.xyz/tx/0xfd9df7e9dfefb2d0c67b5717d739aa840e6c333fbfd5e8ab7a5425fdc7d4695d

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Evaluates at least 3 independent conditions read from chain. | Three independent conditions are read from chain: gas price (get_gas_price), a token balance (eth_call balanceOf), and a vault’s share-price change (eth_call convertToAssets now versus N blocks earlier). |
| 2 | Conditions and thresholds are configurable, not hard-coded. | Condition types, operators, thresholds, addresses, the look-back window and the rule are all in the JSON config; edit it above and run again. Nothing is hard-coded. |
| 3 | Logs a clear decision trace each run: each condition's value, pass/fail, and the final decision. | Every run prints a trace: each condition’s value, threshold and pass/fail, the rule, and the final decision. The same lines are recorded in the run log. |
| 4 | Demonstrates both outcomes: one run where it fires and one where it holds. | examples/fires.json fires and examples/holds.json holds, both on live data; each is a chip above. The testnet card shows both outcomes acting for real: the FIRE sent a real transaction and the HOLD sent nothing. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-threshold-guardian/scripts/guardian.mjs skills/pharos-threshold-guardian/examples/fires.json
node skills/pharos-threshold-guardian/scripts/guardian.mjs skills/pharos-threshold-guardian/examples/holds.json
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
rebalance-gate (strict: should HOLD)  ·  block 20,917,208

FAIL  gas-is-cheap: 10 gwei <= 1  →  not met
PASS  morpho-has-usdc-liquidity: 1,312,441.56 tokens >= 1,000  →  met
FAIL  vault-share-price-moved-a-lot: 0.245232 % >= 5  →  not met
RULE  all conditions must be met: 1 of 3 met
DECISION  HOLD: 2 more conditions needed before prepare the vault rebalance
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/fires.json](examples/fires.json)
- [examples/holds.json](examples/holds.json)
- [references/threshold-guardian.md](references/threshold-guardian.md)
- [scripts/guardian.mjs](scripts/guardian.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/threshold-guardian.js](../../lib/tasks/threshold-guardian.js)
- [scripts/testnet-guardian.mjs](../../scripts/testnet-guardian.mjs)
- [public/js/tasks/threshold-guardian.js](../../public/js/tasks/threshold-guardian.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/testnet-guardian.json](../../reports/testnet-guardian.json)
- [reports/testnet-runs.json](../../reports/testnet-runs.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 7, 8, 9, 10, 11, 12), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 8, 10, 11, 12), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 3, 6, 7, 8, 10, 11, 12), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 6, 7, 8, 10, 11), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 8, 10, 11, 12), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 8, 10, 11), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file cover this task (run all of them with `npm test`):

```bash
node --test test/guardian.test.js
```

## Verify it yourself

- **Open the real transaction the guardian sent.** The FIRE run called ping() on the counter contract on Atlantic testnet; the HOLD run sent nothing.
- **Check gas yourself.** The guardian said 10 gwei. This is the same number straight from the public RPC, in wei.
- **Check the share-price change yourself.** Two calls at different blocks; divide the first by the second and subtract 1. Over 1,500,000 blocks it was +0.2452%.
- **Read the skill itself.** SKILL.md, the reference, the script and both example configs are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
