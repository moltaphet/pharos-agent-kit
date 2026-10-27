# 14. Portfolio Assistant

> Ask in plain English what a wallet holds, where its USDC is, what it earns. Every number comes with the contract and block it was read from, and it says so when it does not know.

**Arena task:** DeFi / Portfolio · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/portfolio-assistant)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/portfolio-assistant/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/portfolio-assistant

## What it does

A wallet’s money on Pharos is spread over native PROS, tokens, and vault shares from different protocols. Finding out “where is my USDC?” means reading several contracts, turning vault shares into dollars, and pricing everything. The Portfolio Assistant does that and answers in a sentence.

## What is real

Answers eight kinds of plain-English question about a wallet from native PROS, USDC, WPROS and the four R25 / RockawayX vaults at one pinned block; every figure carries its contract, call and block, every read is repeated on the public RPC, and what it cannot know (other protocols, earnings since depositing) is refused. Recorded real wallets pinned to a block, replayable.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Reads positions from at least 2 protocols or vaults, plus wallet token balances. | It reads positions from two protocols (R25 and the RockawayX Morpho vault, four vaults in all) plus the wallet’s PROS, USDC and WPROS balances, in two Multicall3 batches at one pinned block, each confirmed on the public RPC. |
| 2 | Answers at least 5 different natural-language question types correctly. | It answers eight question types: total balance, what you hold, where a token is, what a token is worth, the biggest position, a named vault, which protocols you use, and what you are earning. Each is covered by tests, and eleven recorded real questions are shown. |
| 3 | Shows numbers with sources: which contract and block each figure came from. | Every figure shows its source: the contract, the call, the block and whether the public RPC confirmed it; the contract links to the explorer. |
| 4 | Says clearly when it doesn't know or can't read a protocol, rather than guessing. | It says so when it does not know: another protocol is refused by name, “what have I earned” is explained as unknowable from a balance, a vault it cannot read is named and left out, and a missing price withholds the total. |
| 5 | Read-only: never initiates transactions. | It is read-only: it holds no key, every call is an eth_call, and a test checks the only tools it ever asks of the chain are reads. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "Where is my USDC?"
… --question "What am I earning?"
… --question "How much do I have on Aave?"
… --block 21115337
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
Where is my USDC?
wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f · block 21,115,337

Your USDC is in 3 places: 942,942.429833 USDC in the wallet; 1,736,877.466879 USDC in R25 VRPC Weekly; 2,402,278.047197 USDC in R25 VRPC Quarterly.

Figures
  USD Coin in the wallet: 942,942.429833 USDC   [source 1]
  R25 VRPC Weekly (R25): 1,736,877.466879 USDC   [source 2]
  R25 VRPC Quarterly (R25): 2,402,278.047197 USDC   [source 3]

Sources
  [1] 0xc879c018…  balanceOf(address)  block 21,115,337  (Chain MCP eth_call via Multicall3; confirmed on the public RPC)
  [2] 0x1c2bc8b5…  convertToAssets(uint256): what these shares are worth  block 21,115,337  (… confirmed …)
  [3] 0x94f7ebc6…  convertToAssets(uint256): what these shares are worth  block 21,115,337  (… confirmed …)

Note: Not all of this can be taken out at will: R25 VRPC Quarterly (the vault will not preview a redemption, so exits may be restricted).
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/questions.json](examples/questions.json)
- [examples/wallets.json](examples/wallets.json)
- [references/portfolio-assistant.md](references/portfolio-assistant.md)
- [scripts/ask.mjs](scripts/ask.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/portfolio.js](../../lib/portfolio.js)
- [lib/tasks/portfolio-assistant.js](../../lib/tasks/portfolio-assistant.js)
- [scripts/portfolio-demo.mjs](../../scripts/portfolio-demo.mjs)
- [public/js/tasks/portfolio-assistant.js](../../public/js/tasks/portfolio-assistant.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/portfolio-demo.json](../../reports/portfolio-demo.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/defi.js](../../lib/defi.js) (also tasks 15, 16, 17, 18, 19, 22), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 15, 16, 17, 18, 19, 20, 21, 22), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 15, 16, 17, 18, 19, 22), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 15, 16, 17, 18, 19, 22), [lib/trace.js](../../lib/trace.js) (all tasks), [lib/yields.js](../../lib/yields.js) (also task 15)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/portfolio.test.js test/portfolio-task.test.js
```

## Verify it yourself

- **Check a balance yourself.** USDC in the demo wallet at the recorded block, straight from the public RPC. It should read 942942429833 (942,942.429833 USDC).
- **Check what the vault shares are worth.** The weekly vault’s own conversion of the wallet’s shares into USDC.
- **Replay a recorded question.** In the recorded card press Replay: the same question is asked again at the recorded block and every figure and position is compared with the recording.
- **Run it from the command line.** Needs only Node.js 20+.
- **Read the skill itself.** SKILL.md, the reference, the script and the examples are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
