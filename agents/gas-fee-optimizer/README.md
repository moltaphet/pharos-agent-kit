# 24. Gas Fee Optimizer

> Holds a transaction that can wait until gas is cheap, submits it by the deadline whatever the price, and shows what it really paid.

**Arena task:** Trading / Monitoring · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/gas-fee-optimizer)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/gas-fee-optimizer/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/gas-fee-optimizer

## What it does

You hand the agent a transaction and a deadline. It reads the network’s price, base fee and suggested tip, and compares what the transaction would cost now with a target: your own ceiling in gwei, or by default the cheap quarter of the recent price history. If the price is at or under the target it submits at once; otherwise it holds, looks again every few seconds, and submits the moment the price is favourable.

## What is real

An agent that reads the base fee, quoted gas price and tip, holds a transaction until the price is at or under a ceiling (or the history’s cheap quarter) or until the deadline, then submits it as an EIP-1559 transaction. Run for real on Atlantic testnet: four transfers, each read back from the chain; the optimized ones paid 1 gwei where the naive legacy transaction at the quoted price paid 10 gwei, the held one was submitted before its deadline, and Pharos mainnet is only read and prepared. Gas on both networks is flat, which the report states.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Tracks gas price over time and shows recent history. | The history of both networks is sampled over 3,000 blocks (30 readings) with minimum, quartiles and maximum; the Try tab shows it live for mainnet or Atlantic. |
| 2 | Accepts a transaction with a deadline and holds it until gas is favorable or the deadline is reached. | The recorded run holds a transaction with an unreachable ceiling, re-checks seven times, then submits at the deadline; the favourable-now and automatic-target runs submit within a second. |
| 3 | Reports the actual gas paid compared with the price at request time. | Each recorded transaction reports gas used, price paid and cost beside the request-time quote: 0.000021 PHRS against 0.00021 PHRS for the naive wallet’s identical transfer. |
| 4 | Never misses the deadline. It submits at the deadline even if gas is high. | All three optimized transactions were submitted before their deadlines (36.6 s of a 40 s deadline for the held one); a scripted-price test proves the deadline submission when the price never drops, and that a drop releases the hold. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/gas-run.mjs
node agents/gas-fee-optimizer/pharos-gas.js history --chain mainnet
node agents/gas-fee-optimizer/pharos-gas.js send --to 0x… --value 1 --deadline 60 --max-gwei 0.5
```

## Sample output

Output of node scripts/gas-run.mjs (Atlantic testnet):

```text
mainnet: base fee 10 gwei, eth_gasPrice 10 gwei; Atlantic: base fee 1 gwei, eth_gasPrice 10 gwei
  naive legacy at eth_gasPrice: success, gas 21,000
  favorable-now → favorable: submitted after 0.7s, before the deadline; paid 1 gwei
  hold-to-deadline → deadline: submitted after 36.6s, before the deadline; paid 1 gwei
  auto-target → favorable: submitted after 0.7s, before the deadline; paid 1 gwei
```

## What is in this folder

- [pharos-gas.js](pharos-gas.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/gas.js](../../lib/gas.js)
- [lib/tasks/gas-fee-optimizer.js](../../lib/tasks/gas-fee-optimizer.js)
- [scripts/gas-run.mjs](../../scripts/gas-run.mjs)
- [public/js/tasks/gas-fee-optimizer.js](../../public/js/tasks/gas-fee-optimizer.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/gas-run.json](../../reports/gas-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10, 11, 20, 25, 27, 29), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/gas.test.js
```

## Verify it yourself

- **Open the transactions.** The Run tab links the four Atlantic transactions; the explorer shows the gas price each paid (10 gwei naive, 1 gwei optimized).
- **Read the price yourself.** The quoted price and the base fee differ on Atlantic.
- **Ask the optimizer now.** On the Try tab set a ceiling and a deadline and see the decision, the history and the cost.
- **Read the tests.** The hold loop runs against scripted price series: release on a drop, submission at the deadline when the price never drops, RPC failures, retries.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
