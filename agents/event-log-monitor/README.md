# 2. Event/Log Monitor

> Watch a contract live and see every new event exactly once.

**Arena task:** Chain MCP · Easy · [brief](https://pharos-agent-arena.vercel.app/tasks/event-log-monitor)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/event-log-monitor/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/event-log-monitor

## What it does

Contracts announce what happens by emitting logs: a Transfer, a Deposit. This monitor polls the Chain MCP server for them and prints each new log once, decoded into who sent what to whom, in which transaction and block.

## What is real

Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Uses Chain MCP log queries filtered by contract address and event signature. | Every poll calls get_logs filtered by the contract address and the event’s topic0. |
| 2 | Runs continuously (polling or block-by-block) and reports only new events, with no duplicates. | Only blocks after the last scanned one are read (windows of ≤ 1,000 blocks) and each log is de-duplicated by txHash:logIndex. |
| 3 | Decodes each event into readable fields (from, to, amount, tx hash, block). | Each event is decoded into from, to, amount (decimals and symbol applied), tx hash, block and block time. |
| 4 | Demonstrated catching at least one live or test event. | Busy mainnet contracts emit events within seconds, so you can watch live events arrive above. A CLI run is in the README. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/event-log-monitor/pharos-watch.js
node agents/event-log-monitor/pharos-watch.js --max-events 3 --interval 2
node agents/event-log-monitor/pharos-watch.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --event Deposit --from-block 20908000 --json
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
Watching Transfer on USDC 0xc879c018db60520f4355c26ed1a6d572cdac1815
Starting at block 20,911,107 (chain head 20,911,106), polling every 2s. Ctrl-C to stop.

[08:05:45 UTC] block 20,911,114  Transfer   0x946d…4cef → 0x5dbb…ed3e  3.984048 USDC
    tx 0x3c12c6e64af3b2ff18d75b11ffdaff6e339ccdef0bf7950329760ed2413895b8
[08:05:47 UTC] block 20,911,116  Transfer   0x9b1e…6be8 → 0x768b…de54  104.74 USDC
    tx 0x7268fa6b43e02a509b302850313bfa1656edbac8ad2458c2698a65e7c8c3c548

Stopped after 2 events; last scanned block 20,911,116.
```

## What is in this folder

- [pharos-watch.js](pharos-watch.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [api/logs.js](../../api/logs.js)
- [public/js/content.js](../../public/js/content.js) (page in the web hub)
- [public/js/panels/watch.js](../../public/js/panels/watch.js) (page in the web hub)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/watch.js](../../lib/watch.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25), [lib/confirm.js](../../lib/confirm.js) (also tasks 1, 4), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25), [lib/server.js](../../lib/server.js) (also tasks 1, 4), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/watch.test.js
```

## Verify it yourself

- **Open a transaction on the explorer.** Every event row links to its transaction on Pharosscan. Compare the sender, receiver and amount with what the monitor printed.
- **Ask the RPC for the same logs.** This asks the public RPC for USDC Transfers in blocks 20,911,114 to 20,911,116, with no MCP in between. It returns 3 logs: the same three transactions our first live CLI run reported (3c12c6…, 7268fa…, 4fb129…). To check a range from your own run, copy fromBlock and toBlock from a get_logs row in the log.
- **Watch the duplicates counter.** With the default overlap, the “duplicates suppressed” number rises while “new events” counts each log once. That is de-duplication visibly working.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
