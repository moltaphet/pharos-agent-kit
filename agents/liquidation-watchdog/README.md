# 16. Liquidation Watchdog

> Watch a loan on Pharos and get told before it can be liquidated, with the amount to repay or to add to be safe again.

**Arena task:** DeFi / Portfolio · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/liquidation-watchdog)  
**Try it:** https://pharos-agent-kit.vercel.app/#/liquidation-watchdog/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/liquidation-watchdog

## What it does

A loan on a lending market is safe as long as its collateral is worth enough. When the collateral price falls, or interest piles up, the loan slips towards liquidation, and anyone can then repay part of it and take the collateral at a discount. The Liquidation Watchdog watches one position and tells you early, while there is still time to act.

## What is real

Watches a real borrower in Morpho Blue on Pharos mainnet (three of the four recent borrowers are within 3.5% of liquidation), grades it against warn and critical thresholds, alerts to the console with a timestamp (and Discord or Telegram if configured) with the exact amount to repay or add. The real Morpho contract, asked to liquidate on a fork, agrees with the health factor on both sides of 1.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Reads the position's collateral, debt and health factor (or equivalent) from chain. | It reads the position’s collateral, debt and health factor from Morpho Blue on Pharos mainnet (collateral and borrow shares, the market totals, the oracle price and the interest rate model), in two Multicall3 batches at one pinned block, each confirmed on the public RPC. |
| 2 | Configurable warning thresholds, e.g. warn at 1.3 and critical at 1.1. | Thresholds are configurable (warn 1.3 and critical 1.1 by default, validated); the same recorded loan is OK, a warning or critical under different thresholds. |
| 3 | Sends alerts through at least one channel: Telegram, Discord, email, or a console with timestamps. | Alerts go to the console with a timestamp, and to Discord or Telegram when a webhook or bot token is set in the environment; an alert is raised when the level worsens or recovers, not on every look. |
| 4 | Suggests a concrete action in each alert, e.g. "repay X or add Y collateral". | Every alert carries a concrete action: how much to repay, or how much collateral to add, to get back to a safe health factor, plus how far the price may fall and how long interest alone would take. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/liquidation-watchdog/pharos-watchdog.js --market 0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86 --borrower 0x743d7b30661d65b41960bf6b5d1bb93cf7972a73
… --warn 1.5 --critical 1.2 --watch 60
DISCORD_WEBHOOK_URL=… node agents/liquidation-watchdog/pharos-watchdog.js …
node scripts/liquidation-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
[2026-10-24T21:09:28.373Z] CRITICAL: health factor 1.0134 (warn at 1.3, critical at 1.1)
    position 0xa4a57d…073dcc in market 0xc79579a0… (syzUSD/USDC)
    Collateral 1,547,470.9011 syzUSD worth 1,687,707.0967 USDC; debt 1,523,888.0824 USDC; liquidation threshold (LLTV) 91.5%; current loan-to-value 90.29%.
    syzUSD would have to fall 1.32% (to 1.0762 USDC each) to reach liquidation.
    Even at a flat price, interest at 9.35% a year takes about 51.8 days to get there.
    → repay 336,001.9336 USDC or add 437,713.0043 syzUSD of collateral to get back to a health factor of 1.30.
```

## What is in this folder

- [examples/positions.json](examples/positions.json)
- [pharos-watchdog.js](pharos-watchdog.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/liquidation.js](../../lib/liquidation.js)
- [lib/tasks/liquidation-watchdog.js](../../lib/tasks/liquidation-watchdog.js)
- [agents/liquidation-watchdog/pharos-watchdog.js](pharos-watchdog.js)
- [scripts/liquidation-demo.mjs](../../scripts/liquidation-demo.mjs)
- [scripts/liquidation-fork-run.mjs](../../scripts/liquidation-fork-run.mjs)
- [public/js/tasks/liquidation-watchdog.js](../../public/js/tasks/liquidation-watchdog.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/liquidation-demo.json](../../reports/liquidation-demo.json)
- [reports/liquidation-fork-run.json](../../reports/liquidation-fork-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 17, 18, 19, 20), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 17, 18, 19), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 17, 18, 19, 20), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 17, 18, 19), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 11, 15, 17, 18, 19), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 17, 18, 19), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/liquidation.test.js test/liquidation-task.test.js
```

## Verify it yourself

- **Read the position yourself.** The borrower’s collateral and borrow shares in the demo market, straight from Morpho Blue on the public RPC.
- **Read the oracle price.** The collateral price the market uses (1.0906e24 means 1.0906 USDC per syzUSD, scaled by 1e36 and the tokens’ decimals).
- **See Morpho agree on a fork.** The fork card above lists what the real Morpho did when asked to liquidate the same borrower on both sides of health factor 1. Run it yourself with Foundry.
- **Replay a recorded position.** In the recorded card press Replay: the position is read again at the recorded block and compared with the recording.
- **Read the code.** The engine, the CLI, the examples and the recordings are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
