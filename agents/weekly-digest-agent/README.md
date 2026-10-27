# 28. Weekly Digest Agent

> A weekly summary of what changed on Pharos: key numbers against the week before, the three things that stood out, delivered to your channel and published as a page.

**Arena task:** Support / Reporting · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/weekly-digest-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/weekly-digest-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/weekly-digest-agent

## What it does

Once a week (or every N days) the agent reads the chain for the period that just ended and the one before it: the PROS price, the USDC supply, the Morpho Blue syzUSD/USDC market, the four USDC vaults (value locked and the return their share price earned), and how busy the network was. Every number comes with the same number for the previous period and the change.

## What is real

An agent that builds a digest of the last N days (7 by default) of Pharos mainnet against the N before: PROS price, USDC supply, the Morpho syzUSD/USDC market, four USDC vaults, network activity and every Morpho event log, picks the three notable things, and delivers it to Discord, Telegram, ntfy or a webhook once per digest and channel, and as a published page. It runs on a schedule (a Vercel cron on Mondays, or --every on the CLI). Recorded for the real last week with delivery over real HTTP to local receivers; sending to Discord or Telegram needs the owner’s webhook or token.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Runs on a schedule (weekly by default, configurable). | The CLI runs on a schedule with --every (7 days by default, 1 to 31 configurable), and a Vercel cron runs it every Monday at 08:00 UTC; a state file stops the same period from being sent twice. |
| 2 | Covers key metrics with a comparison to the previous period. | Fourteen metrics are shown with the value for the previous period and the change: price, USDC supply, the Morpho market’s supply, borrow and utilisation, vault value locked and return, blocks, and the Morpho event volumes. |
| 3 | Highlights the top 3 notable events of the period. | The digest always lists three notable events, chosen by size against what they are measured against, with the transaction link when there is one; quiet weeks say what stayed steady. |
| 4 | Delivers to a real channel (email, Telegram, Discord) or as a published page. | Delivery to Discord, Telegram, ntfy and webhook channels is recorded with the exact requests the receivers got, and a second run sent nothing; the digest is also published as a page at /digests/latest.html. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/digest-run.mjs
node agents/weekly-digest-agent/pharos-digest.js --days 7 --publish ./digest
DISCORD_WEBHOOK_URL=… node agents/weekly-digest-agent/pharos-digest.js --deliver --every 7 --state digest-state.json
```

## Sample output

Output of node scripts/digest-run.mjs:

```text
building the digest (about 1–2 minutes) …
  built in 69 s: 14 metrics, 3 notable
wrote reports/digest-run.json: 14 metrics, 3 notable events; first delivery 3 messages, second 0 (3 skipped as already sent)
```

## What is in this folder

- [pharos-digest.js](pharos-digest.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/digest.js](../../lib/digest.js)
- [lib/digest-delivery.js](../../lib/digest-delivery.js)
- [lib/tasks/weekly-digest-agent.js](../../lib/tasks/weekly-digest-agent.js)
- [scripts/digest-run.mjs](../../scripts/digest-run.mjs)
- [public/js/tasks/weekly-digest-agent.js](../../public/js/tasks/weekly-digest-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/digest-run.json](../../reports/digest-run.json)
- [public/digests/latest.html](../../public/digests/latest.html)
- [public/digests/latest.md](../../public/digests/latest.md)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25, 26, 27), [lib/alerts.js](../../lib/alerts.js) (also task 22), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19, 22, 23, 25, 26, 27), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19, 22, 23, 25, 26, 27), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25, 26, 27), [lib/rpc-batch.js](../../lib/rpc-batch.js) (also tasks 26, 27), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19, 22, 23, 25, 26, 27), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22, 23, 25, 26, 27), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/digest.test.js
```

## Verify it yourself

- **Read the published digest.** The digest this page records is published as a page of the site.
- **Check a number.** The Run tab re-reads the recorded end-of-period figures and the notable transactions from the chain.
- **Make one now.** The Try tab builds a digest of 1 to 14 days from the chain.
- **Read the tests.** Periods, comparisons, the choice of three, the stale-read guards and the delivery once per channel run against a fake chain.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
