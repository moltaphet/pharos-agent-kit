# 12. Skill + Chain MCP Flow

> One sentence in, one verdict out: Chain MCP supplies live facts, two Skills decide with them, and the next question depends on the last answer.

**Arena task:** Composition · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/skill-chain-mcp-flow)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow

## What it does

A Skill that only reads, and a chain tool that only fetches, are two separate things. This flow makes them one. You say “send 1 USDC from A to B”. The flow asks Chain MCP for the latest block and then for that block’s header, because the header’s timestamp is the clock the policy will be checked against. It asks what the token really is (symbol and decimals), turns “1” into the integer the contract understands, and hands the request and the block’s time to the Policy Gatekeeper Skill.

## What is real

One sentence runs Chain MCP and two Skills end to end on Pharos mainnet; the same request is READY at a Thursday block and STOP at a Saturday block because the chain’s clock decides. Five recorded runs pinned to blocks, replayable.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | The Skill's output depends on live data fetched via Chain MCP in the same flow. | The verdict depends on live Chain MCP data: the block’s time picks the time-window rule (the same request is READY at a Thursday block and STOP by office-hours at a Saturday block), the token’s decimals set the amount, and the sender’s balance decides the simulation. |
| 2 | The flow runs end to end from a single user request. | One sentence (“send 1 USDC from A to B”) runs the whole flow end to end: parse, read the chain, check the token, decide, simulate, prepare. One call, one verdict. |
| 3 | A diagram or short write-up of the flow: what calls what, and in what order. | A sequence diagram on this page and a Mermaid one in the Skill’s reference show what calls what and in what order; every run also lists each step in order with the earlier steps it used. |
| 4 | A demo run showing real data moving through both tools. | The recorded demo is five real runs pinned to Pharos mainnet blocks, with every Chain MCP answer; Replay asks the chain again at the same blocks and shows the answers are identical. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-transfer-preflight/scripts/preflight.mjs --request "send 1 USDC from 0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb to 0x768b959191ce5876cabbbc014a08d72615bdde54"
… --block 20471429
… --out run.json
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
request: send 1 USDC from 0x18573fa1…4efb to 0x768b959…de54
block 20,918,892 (pinned by --block)  ·  thu 2026-10-22 10:00:01 UTC

 2  CHAIN MCP  get_block_number       →  {"blockNumber":"21023594", …}
 3  CHAIN MCP  get_block              {"block":20918892}  →  the header (timestamp 1792663201)
 4  CHAIN MCP  eth_call               symbol()    →  USDC
 5  CHAIN MCP  eth_call               decimals()  →  6
 6  SKILL      token-check            The chain confirms … is USDC with 6 decimals (the policy agrees).  (uses 4, 5)
 8  SKILL      policy-gate            Policy Gatekeeper: ALLOW … allowed: all 6 rules passed (5 applied)  (uses 3, 7)
 9  CHAIN MCP  eth_call               simulate transfer(…, 1000000)
10  CHAIN MCP  estimate_gas           58,620 gas
16  CHAIN MCP  eth_call               balanceOf(sender)  →  1,242,441.562141 USDC
18  SKILL      dry-run-verdict        Dry-Run Executor: GO. 1,242,441.562141 USDC → 1,242,440.562141 USDC.

READY: allowed, simulated, prepared (unsigned)
  prepared: to 0xc879…1815, value 0, gas limit 76,206 (estimate 58,620 + 30%)

what the chain’s data decided:
  step 3: the block’s time = thu 2026-10-22 10:00:01 UTC  →  the time-window rule “office-hours” passed
  13 Chain MCP calls; audit log intact (2 entries)
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/policy.json](examples/policy.json)
- [examples/requests.json](examples/requests.json)
- [references/transfer-preflight.md](references/transfer-preflight.md)
- [scripts/preflight.mjs](scripts/preflight.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/flow.js](../../lib/flow.js)
- [lib/tasks/skill-chain-mcp-flow.js](../../lib/tasks/skill-chain-mcp-flow.js)
- [scripts/flow-demo.mjs](../../scripts/flow-demo.mjs)
- [public/js/tasks/skill-chain-mcp-flow.js](../../public/js/tasks/skill-chain-mcp-flow.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/flow-demo.json](../../reports/flow-demo.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/audit-log.js](../../lib/audit-log.js) (also task 11), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 27), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/policy.js](../../lib/policy.js) (also tasks 11, 15), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 13, 15, 17, 18, 19, 22, 23, 25, 26, 27, 28), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 17, 18, 19, 22, 23, 25, 26, 27, 28), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 17, 18, 19, 20, 22, 23, 25, 26, 27, 28), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/flow.test.js test/flow-task.test.js
```

## Verify it yourself

- **Check the block’s time yourself.** The Saturday block’s timestamp, straight from the public RPC with none of our code in the path. 1792231200 is Saturday 17 October 2026, 10:00:00 UTC.
- **Check the sender’s balance at the pinned block.** The balance the simulation used for the READY run. It should read 1242441562141 (1,242,441.562141 USDC).
- **Replay a recorded run.** In the recorded demo card on this page, press Replay: the flow runs again at the recorded block and reports how many Chain MCP answers are identical to the recording.
- **Run it from the command line.** Needs only Node.js 20+. Add --block to repeat a recorded run exactly.
- **Read the skill itself.** SKILL.md, the reference with the Mermaid sequence diagram, the script and the example policy and requests are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
