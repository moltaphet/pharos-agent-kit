# 18. Recurring Payment Agent

> A weekly or monthly payment that is prepared on time, tracked as paid, pending or failed from what is on chain, and never paid twice.

**Arena task:** Payments · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/recurring-payment-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/recurring-payment-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/recurring-payment-agent

## What it does

Rent, a subscription, a salary: money that goes to the same place on a schedule. Doing it by hand means remembering, checking whether last time worked, and not paying twice when a transaction was slow or failed. This agent keeps the schedule and, whenever you look, tells you what is paid, what is due, what is next, and hands you the unsigned transaction for the payment to make now.

## What is real

A weekly or monthly schedule on Pharos mainnet: every period is upcoming, pending, submitted, paid or failed from the chain’s own receipts and Transfer logs, the next payment and the history are shown, and the whole lifecycle (sign, fail, retry, unreported payment found on chain, short balance) ran on a mainnet fork with exactly one payment per period.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Supports a schedule (weekly or monthly) with amount, token and recipient. | A schedule is weekly or monthly with an amount, a token and a recipient (and a start date and an optional count); the due times are exact (a month without the 31st takes its last day), and the next payment is shown. |
| 2 | Prepares each payment on time and tracks paid, pending and failed status. | Each payment is prepared as an unsigned transaction when it is due, and every period is tracked as upcoming, pending, submitted, paid or failed, from the receipt and the token’s Transfer log on Pharos mainnet. |
| 3 | Handles insufficient balance or a failed transaction without double-paying. | A payer without enough balance gets nothing prepared and a reason; a reverted transaction is failed and retried (at most three times); a transaction that landed unreported is found on chain and never prepared again; reporting a paid period again is refused. On a fork the payee ended with exactly one payment per period. |
| 4 | Shows a payment history and the next scheduled payment. | The page and the CLI show the payment history (every prepared, reported, paid, failed and blocked event with its transaction) and the next scheduled payment. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/recurring-payment-agent/pharos-recurring.js --state rent.json --payer 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --payee 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A --token USDC --amount 25 --frequency weekly --start 2026-10-05T09:00
… --state rent.json --schedule rent.schedule.json --report 0 0x<hash you signed>
node scripts/recurring-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
weekly 25 USDC  0x8ecdf4… → 0x5a5a5a…   at block 21,151,643 · 2026-10-24T20:49:06Z
  period  0  2026-10-05T09:00:00Z  PENDING  
  period  1  2026-10-12T09:00:00Z  PENDING  
  period  2  2026-10-19T09:00:00Z  PENDING  
  period  3  2026-10-26T09:00:00Z  UPCOMING 
  period  4  2026-11-02T09:00:00Z  UPCOMING 

  0 paid · 3 pending · 0 submitted · 0 failed · next: 25 USDC on 2026-10-26T09:00:00Z

  PREPARE period 0 (prepared); sign it once, then report it with --report 0 <hash>
    Send 25 USDC from 0x8ecdf4…24ab9f to 0x5a5a5a…5a5a5a on Pharos Pacific Mainnet.
    It is a call to the USDC contract (0xc879c0…ac1815): transfer(0x5a5a5a…5a5a5a, 25000000).
    Reference "rp:rent-weekly:0" is written into the transaction data after the transfer, so it can be read on chain.
    Network fee: about 0.000961 PROS (80,118 gas at 10 gwei).
    Balance after: 942,917.429833 USDC.
```

## What is in this folder

- [examples/schedules.json](examples/schedules.json)
- [pharos-recurring.js](pharos-recurring.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/recurring.js](../../lib/recurring.js)
- [lib/tasks/recurring-payment-agent.js](../../lib/tasks/recurring-payment-agent.js)
- [agents/recurring-payment-agent/pharos-recurring.js](pharos-recurring.js)
- [scripts/payments-demo.mjs](../../scripts/payments-demo.mjs)
- [scripts/recurring-fork-run.mjs](../../scripts/recurring-fork-run.mjs)
- [public/js/tasks/recurring-payment-agent.js](../../public/js/tasks/recurring-payment-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/recurring-demo.json](../../reports/recurring-demo.json)
- [reports/recurring-fork-run.json](../../reports/recurring-fork-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 19, 20, 21, 22, 23, 25, 26, 27), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 19, 22, 23, 25, 26, 27), [lib/invoice.js](../../lib/invoice.js) (also tasks 17, 19), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26, 27), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 27), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 19, 22, 23, 25, 26, 27), [lib/payments.js](../../lib/payments.js) (also tasks 17, 19, 22, 23, 25, 26, 27), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 19, 22, 23, 25, 26, 27), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 19, 20, 21, 22, 23, 25, 26, 27), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 11, 15, 16, 17, 19), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 19, 22, 23, 25, 26, 27), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 19, 22, 23, 25, 26, 27), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 19, 20, 22, 23, 25, 26, 27), [lib/trace.js](../../lib/trace.js) (all tasks), [scripts/support/fork-chain.mjs](../../scripts/support/fork-chain.mjs) (also tasks 17, 19)

## Tests

3 test files cover this task (run all of them with `npm test`):

```bash
node --test test/recurring.test.js test/recurring-task.test.js test/recurring-audit.test.js
```

## Verify it yourself

- **Read the payee’s USDC balance on the fork run’s final state.** The fork run ends with three payments of 25 USDC. Its report lists every transfer on chain with the reference read from its transaction data.
- **Read a reference from a transaction’s input.** The data after the 68 bytes of a transfer is the reference: decode it from any transaction the agent prepared.
- **Check the due dates.** Weekly periods are 604,800 seconds apart: compare two due times in the table above.
- **Replay a recorded schedule.** In the recorded card press Replay: the schedule is looked at again at the recorded block, and the periods and the prepared transaction are compared.
- **Read the code.** The engine, the CLI, the examples and the recordings are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
