# 26. Audit-Log Agent

> Turns a wallet’s on-chain activity over a date range into a report an accountant or compliance officer can read.

**Arena task:** Compliance / Security · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/audit-log-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/audit-log-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/audit-log-agent

## What it does

Give the agent a wallet and a start and end date. It finds the blocks that cover the period, reads the wallet’s token transfers and approvals from the chain, looks at every transaction behind them, and sorts what happened into four groups: transfers in and out, swaps, approvals, and contract interactions.

## What is real

An agent that turns a wallet’s activity over a date range into a plain-language report: it finds the blocks for the dates, reads the wallet’s token transfers and approvals (the node’s only per-address index) and the transactions behind them in JSON-RPC batches, groups them into transfers in and out, swaps, approvals and contract interactions with totals and notable transactions, and exports Markdown, CSV and PDF. Recorded for three real wallets over one whole day on Pharos mainnet; what the node cannot list (plain PROS transfers) is counted and stated.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Accepts a wallet address and a date range. | The report takes any wallet address and a start and end date or time (UTC); the recorded reports cover one whole day, and the Try tab takes any range up to 12 hours. |
| 2 | Groups activity into categories: transfers in and out, swaps, approvals, contract interactions. | Events are grouped into transfers in, transfers out, swaps, approvals and contract interactions; across the three recorded wallets all of them occur. |
| 3 | Includes totals per category and notable transactions with links. | Each report has totals per category (counts and dollar values), per-token transfer totals, and notable transactions with explorer links that are re-read from mainnet when this page loads. |
| 4 | Exports the report as Markdown, PDF or CSV. | Each report is exported as Markdown, CSV and PDF; the downloads on this page are generated from the same data. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/auditlog-run.mjs 2026-10-26
node agents/audit-log-agent/pharos-audit.js 0x16797a0f3f0dbbf3a9d2dfb66c9c4a5a61e9cb76 --from 2026-10-26 --to 2026-10-26 --format pdf --out report.pdf
```

## Sample output

Output of node scripts/auditlog-run.mjs 2026-10-26:

```text
period 2026-10-26 00:00:00 UTC – 2026-10-26 23:59:59 UTC: blocks 21261543–21355420 (93,878)
  transfer 2 · swap 33 · approval 17 · contract interaction 0
  transfer 1 · swap 0 · approval 0 · contract interaction 0
  transfer 0 · swap 5 · approval 5 · contract interaction 1
```

## What is in this folder

- [pharos-audit.js](pharos-audit.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/auditlog.js](../../lib/auditlog.js)
- [lib/rpc-batch.js](../../lib/rpc-batch.js)
- [lib/tasks/audit-log-agent.js](../../lib/tasks/audit-log-agent.js)
- [scripts/auditlog-run.mjs](../../scripts/auditlog-run.mjs)
- [public/js/tasks/audit-log-agent.js](../../public/js/tasks/audit-log-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/auditlog-run.json](../../reports/auditlog-run.json)
- [reports/auditlog/wallet-a.md](../../reports/auditlog/wallet-a.md)
- [reports/auditlog/wallet-a.csv](../../reports/auditlog/wallet-a.csv)
- [reports/auditlog/wallet-a.pdf](../../reports/auditlog/wallet-a.pdf)
- [reports/auditlog/wallet-b.md](../../reports/auditlog/wallet-b.md)
- [reports/auditlog/wallet-b.csv](../../reports/auditlog/wallet-b.csv)
- [reports/auditlog/wallet-b.pdf](../../reports/auditlog/wallet-b.pdf)
- [reports/auditlog/wallet-c.md](../../reports/auditlog/wallet-c.md)
- [reports/auditlog/wallet-c.csv](../../reports/auditlog/wallet-c.csv)
- [reports/auditlog/wallet-c.pdf](../../reports/auditlog/wallet-c.pdf)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19, 22, 23, 25), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19, 22, 23, 25), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 22, 23, 25), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19, 22, 23, 25), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22, 23, 25), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/auditlog.test.js
```

## Verify it yourself

- **Open a notable transaction.** Each report links its notable transactions to the explorer; the amounts and the wallet are in the logs.
- **Download the files.** On the Run tab, each recorded wallet has its Markdown, CSV and PDF.
- **Run it for your wallet.** The CLI covers up to 7 days.
- **Read the tests.** Dates, classification, totals, the CSV’s formula guard and the PDF’s structure run against a fake chain.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
