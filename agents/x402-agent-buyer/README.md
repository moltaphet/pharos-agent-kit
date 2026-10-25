# 21. x402 Agent Buyer

> A buyer that reads the offer, checks the value and budget, then pays only for data worth its price.

**Arena task:** Payments · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/x402-agent-buyer)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer

## What it does

The buyer takes a short plan of useful data to fetch. It asks each x402 endpoint for its price, compares that offer with the value estimate supplied for the task, checks a per-call ceiling and the remaining job budget, then signs only an offer that passes all four checks.

## What is real

A plan-driven x402 buyer evaluates two endpoint prices against explicit value estimates, a per-call cap and a cumulative budget. The offline fixture demonstrates both a completed job and a budget stop; live purchases require the user’s funded Atlantic testnet key and endpoints.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Calls at least 2 different x402 endpoints. They can be your own or another dev's. | The example plan buys two distinct routes (/api/info and /data); the offline demo exercises both in one completed job. |
| 2 | Enforces a spend budget and a per-call price cap, and refuses calls over either one. | The engine checks an exact per-call cap and cumulative budget before signing, and demonstrates stopping before the second purchase when only 2,000 units remain. |
| 3 | Logs every payment with the price, what it bought and the tx hash, plus a running total. | The confirmed-payment ledger records the endpoint/item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are separately reserved. |
| 4 | Handles payment failures with retries that are safe: the same payment never counts twice. | Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the workflow, and repeated transaction hashes or authorization nonces cannot increase the paid total. |
| 5 | Includes a demo task where the agent completes the job, and one where it stops because it hit the budget. | Two deterministic task demos are included: a completed two-endpoint job and a job that stops at its budget. Both are explicitly labelled simulated and make no network calls. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/x402-buyer-demo.mjs
node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 15000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef
node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 7000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef
```

## Sample output

Deterministic offline mock output; no payment was sent:

```text
OFFLINE BUYER DEMO — mock endpoint and signer; no payment was sent
Job: complete · bought Protocol summary (5000) + Market data (10000) · total 15000 test-USDC base units
  simulated settlement ids: 0x1111…1111, 0x2222…2222 (not explorer transactions)
Job: stopped · bought Protocol summary (5000) · Market data refused: budget has 2000 left but the price is 10000
  confirmed total 5000 · reserved 0 · remaining 2000
```

## What is in this folder

- [pharos-buy.js](pharos-buy.js)
- [plan.example.json](plan.example.json)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/x402-buyer.js](../../lib/x402-buyer.js)
- [scripts/x402-buyer-demo.mjs](../../scripts/x402-buyer-demo.mjs)
- [public/js/tasks/x402-agent-buyer.js](../../public/js/tasks/x402-agent-buyer.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [agents/x402-agent-buyer/plan.example.json](plan.example.json)
- [reports/x402-buyer-demo.json](../../reports/x402-buyer-demo.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20), [lib/secp256k1.js](../../lib/secp256k1.js) (also tasks 17, 19, 20), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/x402.js](../../lib/x402.js) (also task 20)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/x402-buyer.test.js
```

## Verify it yourself

- **Inspect the plan.** Each plan entry names a different endpoint and includes a value estimate in token base units.
- **Run the offline scenarios.** The demo script makes no HTTP or RPC requests and marks all settlement IDs as simulated.
- **Run against your test facilitator.** Start the x402 server and facilitator from task 20, set EVM_PRIVATE_KEY_FILE to a funded throwaway Atlantic test wallet, and direct a copied plan to those endpoints. Never use a mainnet key for this demo.
- **Read the regression tests.** Fake fetch tests cover price caps, budget stops, value skips, invalid offers, asset mismatch, retries, uncertain settlement and duplicate-payment prevention.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
