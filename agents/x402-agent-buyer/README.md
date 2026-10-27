# 21. x402 Agent Buyer

> A buyer that reads the offer, checks the value and budget, then pays only for data worth its price.

**Arena task:** Payments · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/x402-agent-buyer)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer

## What it does

The buyer takes a short plan of useful data to fetch. It asks each x402 endpoint for its price, compares that offer with the value estimate supplied for the task, checks a per-call ceiling and the remaining job budget, then signs only an offer that passes all four checks.

## What is real

A plan-driven x402 buyer reads each endpoint’s price, compares it with an explicit value estimate, a per-call cap and a cumulative budget, and signs only offers that pass. Run for real on Pharos Atlantic against the task-20 server: 4 real settlements across three jobs (completed, stopped by the budget, skipped as not worth it), each read back from the chain, and the payer’s balance moved by exactly the ledger total.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Calls at least 2 different x402 endpoints. They can be your own or another dev's. | The plan buys two distinct routes of the task-20 server (/api/info and /data) in one job; both settle on Atlantic and are re-read from the chain on this page. |
| 2 | Enforces a spend budget and a per-call price cap, and refuses calls over either one. | The engine checks an exact per-call cap and the cumulative budget before signing; the recorded budget-stop job buys one endpoint and refuses the other with 2,000 units left against a 10,000 price. |
| 3 | Logs every payment with the price, what it bought and the tx hash, plus a running total. | The confirmed-payment ledger records the item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are reserved separately. |
| 4 | Handles payment failures with retries that are safe: the same payment never counts twice. | Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the job, and repeated transaction hashes or authorization nonces cannot raise the paid total. |
| 5 | Includes a demo task where the agent completes the job, and one where it stops because it hit the budget. | Three real jobs are recorded: one completed, one stopped by the budget, one that skipped an endpoint priced above its estimated value. In each the payer’s balance moved by exactly the ledger total. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/x402-buyer-run.mjs
node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 15000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef
```

## Sample output

Output of node scripts/x402-buyer-run.mjs (real settlements on Atlantic):

```text
complete: complete · spent 15000 · token moved 15000 · ledger agrees with chain: true
  budget-stop: stopped (budget) · spent 5000 · token moved 5000 · ledger agrees with chain: true
  not-worth-it: complete · spent 5000 · token moved 5000 · ledger agrees with chain: true
wrote reports/x402-buyer-run.json: 4 real settlement(s), ledger vs chain agree
```

## What is in this folder

- [pharos-buy.js](pharos-buy.js)
- [plan.example.json](plan.example.json)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/x402-buyer.js](../../lib/x402-buyer.js)
- [lib/tasks/x402-agent-buyer.js](../../lib/tasks/x402-agent-buyer.js)
- [scripts/x402-buyer-run.mjs](../../scripts/x402-buyer-run.mjs)
- [public/js/tasks/x402-agent-buyer.js](../../public/js/tasks/x402-agent-buyer.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [agents/x402-agent-buyer/plan.example.json](plan.example.json)
- [reports/x402-buyer-run.json](../../reports/x402-buyer-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 22), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 22), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 22), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 22), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22), [lib/secp256k1.js](../../lib/secp256k1.js) (also tasks 17, 19, 20), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks), [lib/x402.js](../../lib/x402.js) (also task 20)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/x402-buyer.test.js
```

## Verify it yourself

- **Open a settlement.** Each purchase in the recorded run links to its transaction on Atlantic; the token’s Transfer log shows payer → payee for exactly the price.
- **Try the decisions yourself.** Change the budget, the per-call cap and the value estimates on the Try tab: the buyer takes its decisions on the paywall’s real offers. Nothing is signed or paid from the web.
- **Run it.** Run the script; it needs the throwaway Atlantic wallets of task 20 (scripts/x402-setup.mjs).
- **Read the regression tests.** Tests cover price caps, budget stops, value skips, invalid offers, asset mismatch, retries, uncertain settlement and duplicate-payment prevention.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
