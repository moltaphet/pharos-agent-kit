# 23. Whale-Watching Agent

> Follows a list of addresses on Pharos mainnet and explains each significant move: what, how much, to whom, and why it matters.

**Arena task:** Trading / Monitoring · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/whale-watching-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/whale-watching-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/whale-watching-agent

## What it does

You give the agent a watchlist (as many addresses as you like, at least five make a useful picture) and what “significant” means: an amount per token, and optionally a value in dollars. It scans a range of blocks and reports every token transfer that touches a watched address and crosses the line.

## What is real

An agent that follows a watchlist on Pharos mainnet and reports every token move above a per-token or dollar threshold, explained (what, how much, to whom, why it matters), plus new positions, exits and balance changes, and a summary across all addresses. The recorded run watches eight addresses over 2,000 real blocks: 205 significant moves at default thresholds, 3 at stricter ones, the biggest re-read from the chain.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Tracks at least 5 configurable addresses. | The recorded run watches eight addresses on Pharos mainnet; the CLI and the Try tab accept any list. |
| 2 | A configurable "significant" threshold per token or in value terms. | Thresholds are set per token (USDC, WPROS, PROS) and in dollars; the same blocks give 205 moves at 100 and 3 moves at 1,000 per token. |
| 3 | Each report explains the move: what moved, how much, and where to (labelled where known). | Every report line names what moved, the amount and dollar value, and the counterparty with its label or kind, plus reasons; the biggest moves are re-read from mainnet when this page loads. |
| 4 | Produces a summary view of recent activity across all watched addresses. | The summary view lists, for every watched address, its significant moves, dollars in and out, position changes, and the overall biggest move. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/whales-run.mjs
node agents/whale-watching-agent/pharos-whales.js --config agents/whale-watching-agent/watchlist.example.json --blocks 1000
```

## Sample output

Output of node scripts/whales-run.mjs (Pharos mainnet, read-only):

```text
window 21379547–21381546 (pinned; chain head was 21384546)
  default: 205 significant move(s), 5 position change(s), 6 of 8 wallets active
  strict: 3 significant move(s), 4 position change(s), 2 of 8 wallets active
wrote reports/whales-run.json: 205 moves at default thresholds, 3 at strict
```

## What is in this folder

- [pharos-whales.js](pharos-whales.js)
- [watchlist.example.json](watchlist.example.json)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/whales.js](../../lib/whales.js)
- [lib/tasks/whale-watching-agent.js](../../lib/tasks/whale-watching-agent.js)
- [scripts/whales-run.mjs](../../scripts/whales-run.mjs)
- [public/js/tasks/whale-watching-agent.js](../../public/js/tasks/whale-watching-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [agents/whale-watching-agent/watchlist.example.json](watchlist.example.json)
- [reports/whales-run.json](../../reports/whales-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21, 22, 25, 26, 27, 28), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 25, 26, 27, 28), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 25, 26, 27, 28), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19, 22, 25, 26, 27, 28), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19, 22, 25, 26, 27, 28), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21, 22, 25, 26, 27, 28), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 22, 25, 26, 27, 28), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19, 22, 25, 26, 27, 28), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22, 25, 26, 27, 28), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/whales.test.js
```

## Verify it yourself

- **Open a move.** The Run tab lists the biggest moves with their transaction links; each was just re-read from mainnet (token, amount, sender, receiver, block).
- **Watch your own list.** On the Try tab, paste addresses, set thresholds and scan the latest blocks.
- **Run it.** The CLI prints the explained report and the summary.
- **Read the tests.** Thresholds, explanations, position classification, summary and input validation run against a fake chain.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
