# 29. Doc-Grounded Builder Agent

> Ask “how do I do X on Pharos?”: it finds the answer in the docs, does X through Chain MCP, and checks on chain that it worked.

**Arena task:** Cross-tool / Advanced · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/doc-grounded-builder-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/doc-grounded-builder-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/doc-grounded-builder-agent

## What it does

You ask a question the way a developer would: “How do I read the BTC/USD price on Pharos?”, “How do I send 0.001 PROS to…?”, “How do I deploy a contract to the Atlantic testnet?”. The agent first asks Developer Docs MCP, keeps only an answer the documentation really supports, and lists the pages it cites. That is the plan.

## What is real

An agent that answers “how do I do X on Pharos?” end to end: it asks Developer Docs MCP and keeps only an answer the docs support, with its sources; reads the facts it needs (chain ID, the price feed address and heartbeat) from the docs pages; does X through Chain MCP (a balance, a price, and transfers or deployments prepared unsigned for the user’s signature); and verifies the outcome on chain against the plan. Nine real requests are recorded, including a transfer and a deployment signed on Atlantic testnet and verified, a mainnet transfer left unsigned, and requests the docs do not cover, which it refuses to improvise.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Uses Docs MCP to plan, with sources cited, before acting. | The docs answer comes first: a plan with the pages it cites, produced by Docs MCP and accepted only if the docs support the question; the facts the action uses come from the docs pages. |
| 2 | Executes the plan with Chain MCP and/or SkillEngine; anything that moves funds is prepared for signature. | Reads go through Chain MCP; the transfer and the deployment are prepared as unsigned transactions. The mainnet transfer was never signed or sent; the Atlantic ones were signed by the throwaway wallet standing in for the user. |
| 3 | Verifies the outcome on chain and reports success or failure against the plan. | Each run ends with a list of checks against the plan (chain ID, a second read, freshness; or sender, recipient, amount, nonce, code and a call) and a verdict of success or failure. |
| 4 | Works for at least 3 different "how do I…" requests. | Six different requests were done and verified or prepared: a balance, two price feeds, a transfer on mainnet (prepared), a transfer on Atlantic (signed, verified) and a deployment (signed, verified). |
| 5 | Handles a request the docs don't cover by saying so instead of improvising. | Two requests the docs do not cover (liquidity on FaroSwap, baking bread) were answered with “the docs do not cover this” and nothing was done; a third the docs explain but the agent cannot do (running a validator) was explained with sources and left there. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/builder-run.mjs
node agents/doc-grounded-builder-agent/pharos-build.js "How do I read the BTC/USD price on Pharos?"
node agents/doc-grounded-builder-agent/pharos-build.js "How do I send 0.001 PROS to 0x… from 0x…?" --save-prepared prepared.json
node agents/doc-grounded-builder-agent/pharos-build.js --verify 0x<hash of the transaction you signed> --prepared prepared.json
```

## Sample output

Output of node scripts/builder-run.mjs:

```text
balance: → success: Done and verified: 0x1159105d… holds 2.995240515625 PROS
price-pros: → success: Done and verified: PROS/USD is $0.5986, observed 241 s before block 21,397,235
send-mainnet: → prepared: Prepared for your signature: 0.001 PROS to 0x000000…00dEaD
send-atlantic: → prepared → success
deploy: → prepared → success
not-covered-1: → not-covered: The docs do not cover this, so I did nothing
explained-only: → explained-only: The docs explain this, but it is not something I can do myself
```

## What is in this folder

- [pharos-build.js](pharos-build.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/builder.js](../../lib/builder.js)
- [lib/builder-artifacts.js](../../lib/builder-artifacts.js)
- [lib/tasks/doc-grounded-builder-agent.js](../../lib/tasks/doc-grounded-builder-agent.js)
- [scripts/builder-run.mjs](../../scripts/builder-run.mjs)
- [public/js/tasks/doc-grounded-builder-agent.js](../../public/js/tasks/doc-grounded-builder-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/builder-run.json](../../reports/builder-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30), [lib/docs.js](../../lib/docs.js) (also tasks 3, 4, 13), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 30), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 27), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10, 11, 20, 24, 25, 27), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/builder.test.js
```

## Verify it yourself

- **Ask your own.** The Try tab takes any question; the examples are the recorded ones.
- **Check the docs’ facts.** The agent’s chain ID and feed address are on these pages.
- **Open the two Atlantic transactions.** The Run tab links the signed transfer and deployment; the deployed Counter’s code is on the explorer.
- **Read the tests.** Understanding the request, the docs-support gate, each recipe, and the verification of a signed outcome run against fake docs and chain clients.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
