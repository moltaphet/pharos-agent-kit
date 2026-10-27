# 30. Multi-Protocol Aggregator

> One interface over R25, Morpho Vault V2 and Morpho Blue: ask about rates and positions, or deposit and withdraw, and it picks the best venue and explains why.

**Arena task:** Cross-tool / Advanced · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/multi-protocol-aggregator)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/multi-protocol-aggregator/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/multi-protocol-aggregator

## What it does

Pharos has several places to put USDC to work: three R25 vaults, the RockawayX vault of Morpho Vault V2, and the Morpho Blue lending market. Each has its own contract, its own way of reporting a return, and its own rules about who can get in and how much can come out.

## What is real

A Harbor-style agent over five USDC venues of three Pharos protocols (R25’s three vaults, the RockawayX vault of Morpho Vault V2, a Morpho Blue lending market) behind one interface: it queries rates, liquidity and a wallet’s positions, routes a deposit or withdrawal to the best venue with the reasons (each venue’s own simulation decides who can get in), and prepares the unsigned transactions. A protocol that cannot be read is reported and the others carry on; the recorded run takes protocols down one after another, up to all of them. The architecture write-up is in docs/architecture-multi-protocol-aggregator.md.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Integrates at least 2 protocols or vaults behind one interface. | Five venues of three protocols (R25 ×3, Morpho Vault V2, Morpho Blue) sit behind one interface, read the same way and measured the same way. |
| 2 | Supports both queries (positions, rates) and actions (deposit or withdraw prepared for signature). | Queries (rates, value locked, free liquidity, a wallet’s positions) and actions (deposit and withdraw, prepared as unsigned approve + deposit/withdraw transactions with a simulation) go through the same interface; nothing is signed. |
| 3 | Routes each request to the best venue and explains why it chose it. | Each request is routed to a venue and the answer says why: the best measured return among the venues that accept it, with every other venue listed with its reason; withdrawals come from the lowest return that can pay. |
| 4 | Handles one protocol being unavailable without breaking the others. | The recorded run takes down R25, then Morpho Vault V2, then both, then everything: each time the others carry on, and with all down the answer is a clear “no venue can take this right now”. |
| 5 | Includes an architecture write-up and a demo video, strongly encouraged for this tier. | The architecture write-up is in docs/architecture-multi-protocol-aggregator.md; the Try tab and the CLI show the same requests step by step. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/aggregator-run.mjs
node agents/multi-protocol-aggregator/pharos-aggregate.js rates
node agents/multi-protocol-aggregator/pharos-aggregate.js deposit 0x… 2500 --down R25
```

## Sample output

Output of node scripts/aggregator-run.mjs:

```text
deposit-small: Deposit 500 USDC in RockawayX USDC (Morpho Vault V2): the best measured return (5.46%) among the 3 venues that can take it; the next best is Morpho Blue syzUSD/USDC market (supply) at 5.39%.
withdraw: Withdraw 1,000 USDC from RockawayX USDC (Morpho Vault V2): it is the only venue where this wallet has money that can be paid out now (it earns 5.46%).
outage-best-venue: Deposit 2,500 USDC in Morpho Blue syzUSD/USDC market (supply): the best measured return (5.39%) among the 2 venues that can take it; the next best is R25 VRPC Weekly at 4.71%.
outage-all: No venue can take 500 USDC right now.
```

## What is in this folder

- [pharos-aggregate.js](pharos-aggregate.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/aggregator.js](../../lib/aggregator.js)
- [lib/tasks/multi-protocol-aggregator.js](../../lib/tasks/multi-protocol-aggregator.js)
- [scripts/aggregator-run.mjs](../../scripts/aggregator-run.mjs)
- [public/js/tasks/multi-protocol-aggregator.js](../../public/js/tasks/multi-protocol-aggregator.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [docs/architecture-multi-protocol-aggregator.md](../../docs/architecture-multi-protocol-aggregator.md)
- [reports/aggregator-run.json](../../reports/aggregator-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 27, 28), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-batch.js](../../lib/rpc-batch.js) (also tasks 25, 26, 27, 28), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/aggregator.test.js
```

## Verify it yourself

- **Compare a rate yourself.** A vault’s return is its share price over two days.
- **Route your own request.** The Try tab takes any wallet, an action and an amount, with a protocol optionally down.
- **Read the architecture.** The adapter interface, the routing rules and the outage handling.
- **Read the tests.** Each adapter, the routing, the outage handling and the disagreeing-read guard run against a fake chain.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
