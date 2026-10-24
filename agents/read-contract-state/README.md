# 1. Read Contract State

> Turn raw contract storage into something a person can read.

**Arena task:** Chain MCP · Easy · [brief](https://pharos-agent-arena.vercel.app/tasks/read-contract-state)  
**Try it:** https://pharos-agent-kit.vercel.app/#/read-contract-state/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/read-contract-state

## What it does

A smart contract answers questions in hex. To learn a token’s name you send a four-byte function selector in an eth_call and get back 32-byte words that still need decoding. This agent does that work through the Chain MCP server and shows the answer the way a person would read it.

## What is real

Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Reads at least 3 different values from one contract via Chain MCP (e.g. name, totalSupply, owner, a balance). | name, symbol, decimals, totalSupply and owner are read with eth_call through Chain MCP; the Try-it table shows each one. |
| 2 | Shows the contract address and the block number the data was read at. | The header shows the contract address and the block (with its time) that every read is pinned to. |
| 3 | Formats raw values for humans: token decimals applied, addresses labelled. | Decimals applied and thousands grouped with the raw value kept; addresses labelled from the Pharos registry, as wallet or contract, or with your own label. |
| 4 | Includes a short README: which contract you chose, how to run it, sample output. | This page and the README document the contract chosen, how to run it, and real sample output. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/read-contract-state/pharos-read.js
node agents/read-contract-state/pharos-read.js 0xc879c018db60520f4355c26ed1a6d572cdac1815 --holder 0x768b959191ce5876cabbbc014a08d72615bdde54
node agents/read-contract-state/pharos-read.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --json
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
Pharos contract snapshot
────────────────────────────────────────────────────────────
  Contract       USDC
  Address        0xc879c018db60520f4355c26ed1a6d572cdac1815
  Network        Pharos · chain 1672
  Read at        block 20,911,225 · 2026-10-22 08:07:21 UTC
  Code size      1,798 bytes

Values read via Chain MCP (eth_call at that block)
  name           USDC
  symbol         USDC
  decimals       6
  totalSupply    39,689,691.355769 USDC   (raw 39689691355769)
  owner          wallet (no contract code)  0x9f8e…4d92
  balanceOf      unlabelled contract  0x768b…de54 → 366.45403 USDC
```

## What is in this folder

- [pharos-read.js](pharos-read.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [api/read.js](../../api/read.js)
- [public/js/content.js](../../public/js/content.js) (page in the web hub)
- [public/js/panels/read.js](../../public/js/panels/read.js) (page in the web hub)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/crosscheck.js](../../lib/crosscheck.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 2, 3, 4, 13), [lib/confirm.js](../../lib/confirm.js) (also tasks 2, 4), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc.js](../../lib/rpc.js) (also tasks 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15), [lib/server.js](../../lib/server.js) (also tasks 2, 4), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

4 test files cover this task (run all of them with `npm test`):

```bash
node --test test/snapshot.test.js test/confirm.test.js test/crosscheck.test.js test/stable.test.js
```

## Verify it yourself

- **Compare with the block explorer.** Open the USDC token page and compare the total supply. It moves as tokens are minted, so expect a small difference from a snapshot taken minutes ago.
- **Ask the RPC yourself.** This is the call behind decimals(), sent straight to the public RPC with no MCP in between. It should return 6.
- **Repeat any call from the log.** Each MCP row in the run log has a Reproduce block that repeats that exact call using this repository’s client. Clone the repo and paste it.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
