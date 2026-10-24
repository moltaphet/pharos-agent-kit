# 13. Docs MCP + Chain MCP Agent

> Give it a contract function: it asks the docs what it means, calls it on chain, and reads the answer the way the docs say, checking the docs against the chain.

**Arena task:** Composition · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/docs-chain-mcp-agent)  
**Try it:** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent

## What it does

Raw contract values mean nothing without their context. A price feed returns 80683130407437730000000. Is that dollars, cents, 18 decimals, 8? This agent finds out the way a careful developer would. It asks Developer Docs MCP what the function does, what it returns and what to check, and it keeps the answer with its sources. Then it calls the same function on Pharos mainnet through Chain MCP, at one pinned block, and reads the number the way the explanation says: divide by 10^18, so 80,683.13 BTC/USD.

## What is real

Explains a contract function from Developer Docs MCP (with sources), calls it on Pharos mainnet through Chain MCP, reads the value the way the docs say, cross-checked against decimals(), and confirms every read on the public RPC. Five recorded real cases pinned to a block, replayable.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | The explanation comes from Docs MCP, with sources referenced. | The explanation comes from Developer Docs MCP (askQuestion) and is shown in full with its sources marked cited or related; it counts as documentation only if a documentation search for the contract’s address finds a page that lists it, and the answer names the function and links a docs page. |
| 2 | The agent then calls the same function on chain via Chain MCP. | The agent then calls the same function on chain through Chain MCP (eth_call at one pinned block, repeated on the public RPC to confirm it), built from the signature you give, and decodes the result by its declared type. |
| 3 | Interprets the result in the context of the explanation. | It interprets the value in the context of the explanation: it applies the scale the docs state, confirms it against the contract’s decimals(), reads the unit and the freshness the docs ask about, and reports a conflict if the docs and the chain disagree. |
| 4 | Works for at least 2 different functions or contracts. | It works for different functions and contracts: five recorded real cases (two price feeds with the same function, USDC totalSupply(), WPROS balanceOf(address), a pair’s token0()), four explained and applied and one the docs do not cover, shown raw. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/docs-chain-mcp-agent/pharos-explain.js --contract 0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466 --function "latestAnswer()(int256)"
node agents/docs-chain-mcp-agent/pharos-explain.js --contract 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --function "balanceOf(address)(uint256)" --arg 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417
… --block 21100000
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
latestAnswer() on 0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466
block 21,110,xxx · sat 2026-10-24 10:10 UTC

 8  AGENT      read-explanation     The docs explain latestAnswer() (1 cited page). Scale stated: 10^18; unit: PROS/USD; follow-up calls it asks for: decimals.
 9  CHAIN MCP  eth_call             latestAnswer()  →  645560037162381300
12  AGENT      follow-up decimals   the explanation states a scale (18 decimals), so the contract's own decimals() is asked to confirm it. decimals() = 18.
15  AGENT      interpret            … Read the way the docs say (docs and chain agree), that is 0.6455600371 (PROS/USD).

EXPLAINED AND CALLED: the docs’ explanation was applied to the live value

What the docs say:
  latestAnswer() reads the latest PROS/USD price from this Pacific Mainnet feed. It returns one signed int256 value, scaled to 18 decimals: divide the raw result by 10^18 to get USD per PROS.
Sources
  1. Chainlink Push Engine Feeds  (cited in the answer)

✓ the documented scale matches the contract’s decimals(): the docs say 10^18 and the contract says decimals() = 18
```

## What is in this folder

- [examples/cases.json](examples/cases.json)
- [pharos-explain.js](pharos-explain.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/docs-chain.js](../../lib/docs-chain.js)
- [lib/tasks/docs-chain-mcp-agent.js](../../lib/tasks/docs-chain-mcp-agent.js)
- [scripts/docs-chain-demo.mjs](../../scripts/docs-chain-demo.mjs)
- [public/js/tasks/docs-chain-mcp-agent.js](../../public/js/tasks/docs-chain-mcp-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/docs-chain-demo.json](../../reports/docs-chain-demo.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/abi-call.js](../../lib/abi-call.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4), [lib/docs.js](../../lib/docs.js) (also tasks 3, 4), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 14, 15), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 15), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 3, 5, 6, 7, 8, 10, 11, 12, 14, 15), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 14, 15), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

3 test files cover this task (run all of them with `npm test`):

```bash
node --test test/abi-call.test.js test/docs-chain.test.js test/docs-chain-task.test.js
```

## Verify it yourself

- **Check the value yourself.** The BTC/USD feed read at the recorded block, straight from the public RPC. It should return 80683130407437730000000, i.e. 80,683.13 with 18 decimals.
- **Check the decimals the docs state.** The agent applies a scale only after the contract confirms it. You can ask the same contract.
- **Check the selector it computed.** The built-in Keccak-256 gives the same selector as Foundry.
- **Read the explanation at its source.** The page the explanation cites for the price feeds.
- **Replay a recorded case.** In the recorded demo card on this page press Replay: the agent runs again at the recorded block and reports how many Chain MCP answers match the recording.
- **Read the code.** The agent, its ABI helpers and the tests are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
