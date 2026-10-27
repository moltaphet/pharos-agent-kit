# 22. On-Chain Alert Bot

> Watches Pharos mainnet for the conditions you set and tells your channel once, with the value and a link.

**Arena task:** Trading / Monitoring · Easy · [brief](https://pharos-agent-arena.vercel.app/tasks/on-chain-alert-bot)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/on-chain-alert-bot/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/on-chain-alert-bot

## What it does

You describe what matters in a small config file: a price crossing a threshold on a Chainlink-style feed, an ERC-20 transfer above an amount, an event emitted by a contract, or a call to a contract. The bot reads new blocks, finds the matching events and sends each one to Discord, Telegram, ntfy or a webhook.

## What is real

A bot that watches Pharos mainnet for a price crossing on the PROS/USD feed, large USDC/WPROS transfers, contract events and contract calls, and delivers each alert (what, value, explorer link) to Discord, Telegram, ntfy or a webhook. Each event goes to each channel once; a channel outage loses nothing. The recorded run scans 1,000 real mainnet blocks and delivers over real HTTP to local Discord-style, ntfy and webhook receivers (sending to Discord/Telegram itself needs the owner’s webhook or bot token).

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | At least one configurable alert condition. | Four condition types (price crossing, large transfer, contract event, contract call) are configured from JSON; the recorded run uses five conditions on Pharos mainnet. |
| 2 | Delivers alerts to a real channel: Telegram, Discord or similar. | The bot delivers by HTTP to Discord, Telegram, ntfy and webhook channels; the recorded run shows the exact requests received by Discord-style, ntfy and webhook endpoints. |
| 3 | Each alert includes what happened, the value, and a tx or explorer link. | Each message carries what happened, the value, the block and an explorer link; the recorded alerts are re-read from mainnet when this page loads. |
| 4 | No repeat spam for the same event. | Rescanning the same blocks, and restarting from the saved state, sent nothing twice; during a channel outage nothing was lost and the recovered channel got only what it missed. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/alerts-run.mjs
node agents/on-chain-alert-bot/pharos-alerts.js --config agents/on-chain-alert-bot/alerts.example.json --dry-run --once --lookback 200
DISCORD_WEBHOOK_URL=… node agents/on-chain-alert-bot/pharos-alerts.js --config alerts.json --state .alerts-state.json --interval 30
```

## Sample output

Output of node scripts/alerts-run.mjs (Pharos mainnet, read-only):

```text
first-cycle: found 29 · delivered 87 · duplicates suppressed 0 · failed 0
  same-window-again: found 28 · delivered 0 · duplicates suppressed 84 · failed 0
  restart-from-state-file: found 28 · delivered 0 · duplicates suppressed 84 · failed 0
  channel-outage: found 25 · delivered 50 · duplicates suppressed 0 · failed 25
  channel-recovered: found 25 · delivered 25 · duplicates suppressed 50 · failed 0
  call-condition: found 3 · delivered 9 · duplicates suppressed 0 · failed 0
```

## What is in this folder

- [alerts.example.json](alerts.example.json)
- [pharos-alerts.js](pharos-alerts.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/alerts.js](../../lib/alerts.js)
- [lib/tasks/on-chain-alert-bot.js](../../lib/tasks/on-chain-alert-bot.js)
- [scripts/alerts-run.mjs](../../scripts/alerts-run.mjs)
- [public/js/tasks/on-chain-alert-bot.js](../../public/js/tasks/on-chain-alert-bot.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [agents/on-chain-alert-bot/alerts.example.json](alerts.example.json)
- [reports/alerts-run.json](../../reports/alerts-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/alerts.test.js
```

## Verify it yourself

- **Open an alert’s transaction.** Every alert on the Run tab links to its transaction on pharosscan.xyz; the amount and the block are in the transaction’s logs.
- **Scan the latest blocks.** Use the Try tab: it reads the newest blocks of mainnet with your threshold and shows the exact message, then scans again to show nothing would be sent twice.
- **Run it with your channel.** Put your webhook in the environment and start the bot with a state file.
- **Read the tests.** Conditions, scanning, formatting, dedup, outage and secret handling are covered with a fake chain and fake channels.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
