# 7. Arbitrage Scanner

> Compare one pair on two venues, subtract every cost, and act only when the profit is real.

**Arena task:** SkillEngine · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/arbitrage-scanner)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner

## What it does

An arbitrage scanner is easy to fool. Two venues disagree on a price, the gap looks huge, and the bot trades into a pool that holds a few cents. This Pharos Skill reads the same token pair from two independent places at the same block (FaroSwap V2 reserves and FaroSwap V3 pool state), simulates buying on the cheaper venue and selling on the dearer one, and subtracts swap fees, price impact and gas before it will call anything profitable.

## What is real

Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Reads prices from at least 2 sources in the same scan. | Both venues are read in the same scan at one pinned block: FaroSwap V2 (reserves) and FaroSwap V3 (slot0, liquidity), through one Multicall3 call. |
| 2 | Calculates net profit after swap fees, slippage estimate, and gas. | Net profit subtracts each venue’s swap fee, an estimate of price impact (searched across trade sizes) and gas (270k units at the live gas price, in WPROS). |
| 3 | Acts (or prepares the transaction) only above a configurable profit threshold; otherwise logs why it skipped. | It acts (a simulated fill) only when net profit reaches a configurable minimum; otherwise the scan lists exactly why it skipped, with the numbers. |
| 4 | Logs every scan with gross spread, costs, net result and decision. | Every scan records gross spread, costs, net result and decision: the history table below, the run log, and `--log scans.jsonl` in the CLI. |
| 5 | Works safely on testnet or with simulated execution; no requirement to risk real funds. | Live scans never send anything: “acting” on live data is a simulated fill, so no key, no transaction and no funds are ever at risk. The act path itself was executed on a local fork of Pharos mainnet (real FaroSwap V2 and V3 contracts, a real EVM, anvil’s unlocked dev accounts), with predicted and actual profit recorded side by side in reports/arbitrage-runs.json. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-arbitrage-scanner/scripts/scan.mjs
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --watch 10 --interval 5 --log scans.jsonl
node scripts/arb-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
scan 1/1  WPROS/DLP  block 20918559
  FaroSwap V2 0.000042216 WPROS/DLP   FaroSwap V3 (0.3% tier) 2.4462
  gross spread 5794000%   best size 1.7783e-9 WPROS
  gross 0.00010304 − fees 3.0819e-7 − price impact 3.3514e-7 − gas 0.0027 = net -0.0025976 WPROS
  DECISION SKIP
    skipped because: best net profit -0.002598 WPROS is below the minimum 0.001 WPROS
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [references/arbitrage-scanner.md](references/arbitrage-scanner.md)
- [scripts/scan.mjs](scripts/scan.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/arbitrage-scanner.js](../../lib/tasks/arbitrage-scanner.js)
- [lib/arb-sandbox.js](../../lib/arb-sandbox.js)
- [scripts/arb-fork-run.mjs](../../scripts/arb-fork-run.mjs)
- [public/js/tasks/arbitrage-scanner.js](../../public/js/tasks/arbitrage-scanner.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/arbitrage-runs.json](../../reports/arbitrage-runs.json)
- [contracts/ArbLab.sol](../../contracts/ArbLab.sol)
- [contracts/ArbLab.bytecode.json](../../contracts/ArbLab.bytecode.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/amm.js](../../lib/amm.js), [lib/arb-fork.js](../../lib/arb-fork.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 8, 10, 11, 15, 16, 17, 18, 19), [lib/sandbox-run.js](../../lib/sandbox-run.js) (also task 6), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

4 test files cover this task (run all of them with `npm test`):

```bash
node --test test/arbitrage.test.js test/amm.test.js test/arb-fork.test.js test/arb-sandbox.test.js
```

## Verify it yourself

- **Read the V2 pool yourself.** Reserves of the WPROS/DLP V2 pair: the first is WPROS, about 0.00007 in size.
- **Read the V3 pool yourself.** The square-root price (first value), current tick and liquidity of the V3 pool. Price = (sqrtPriceX96 / 2^96)².
- **Check the pools are real FaroSwap contracts.** The V2 pair reports FaroSwap’s V2 factory as its creator, and the V3 factory returns the V3 pool for the same two tokens and the 0.3% tier. Both should print the addresses in the comments.
- **Reproduce the real-EVM run.** Needs Foundry (anvil, forge, cast). It forks Pharos mainnet, builds contracts/ArbLab.sol, runs both scenarios and rewrites the report. Transaction hashes exist only on that local fork. Your numbers will differ slightly because the fork block and gas price differ.
- **Read the recorded run and the helper contract.** The recorded report with every step, and the Solidity helper that adds liquidity and runs the two legs.
- **Read the skill itself.** SKILL.md, the reference and the script are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
