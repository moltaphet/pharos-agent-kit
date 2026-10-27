# 27. dApp Support Agent

> Paste the hash of a failed transaction and get why it failed, in plain words, and what you can do about it.

**Arena task:** Support / Reporting · Easy · [brief](https://pharos-agent-arena.vercel.app/tasks/dapp-support-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/dapp-support-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/dapp-support-agent

## What it does

A wallet says “transaction failed” and nothing else. The agent takes the hash, fetches the transaction and its receipt through Chain MCP, and finds out why: it replays the exact call on the state just before its block, so the contract answers in its own words (a message, a built-in panic, a custom error, or silence), and it checks the numbers behind the usual causes.

## What is real

A support agent that takes a failed transaction hash, fetches the transaction and receipt through Chain MCP, replays the call on the block before it to get the contract’s own revert data, checks the numbers behind the usual causes (token balance, allowance, native value, gas used against the limit, the function selector) and explains the cause and the fix in plain words. Thirteen real failures of eleven kinds are recorded: four on Pharos mainnet and nine made on purpose on Atlantic testnet.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Accepts a tx hash and fetches the transaction and receipt via Chain MCP. | The agent takes a transaction hash and fetches the transaction and receipt through Chain MCP (the Try tab and the CLI do this on mainnet; the first step of every diagnosis lists the call). |
| 2 | Identifies the failure cause: revert reason, out of gas, insufficient balance or allowance, etc. | It identifies the cause from the contract’s own revert data and the numbers behind it: revert message, custom error, panic, out of gas, token balance, allowance, authorisation, paused contract, slippage, native value sent to a non-payable function, and a missing function. |
| 3 | Explains it without jargon and suggests a fix. | Each diagnosis is a short headline, a plain paragraph with the numbers (for example how much the spender was approved for and how much it needed), and a list of fixes. |
| 4 | Demonstrated on at least 3 different failure types. | Thirteen real failed transactions across eleven kinds are recorded, four on mainnet and nine made on purpose on Atlantic; their failed status is re-read from the chain when this page loads. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/support-run.mjs
node agents/dapp-support-agent/pharos-support.js 0xf7fc5fcc273c9dd0fdbbb3e15ba90d4f902409f50ac5f812fffa108b73d797b1
node agents/dapp-support-agent/pharos-support.js 0x393c87d70c904916c74c780b3498a492a2b636cc1f912b69594b281ff9f301c9 --chain atlantic
```

## Sample output

Output of node scripts/support-run.mjs:

```text
mainnet-slippage         slippage                   The price moved too much
mainnet-allowance        insufficient-allowance     The contract was not approved to spend enough
mainnet-state            state-changed              It would work now: something changed just before it was mined
not-authorized           not-authorized             This account is not allowed to do that
insufficient-balance     insufficient-token-balance Not enough tokens
paused                   paused-or-blocked          The contract is paused or the account is blocked
out-of-gas               out-of-gas                 It ran out of gas
panic                    panic                      The contract hit a bug-like error
wrong-function           wrong-function             The contract has no such function
wrote reports/support-run.json: 13 failures, 11 different categories
```

## What is in this folder

- [pharos-support.js](pharos-support.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/support.js](../../lib/support.js)
- [lib/tasks/dapp-support-agent.js](../../lib/tasks/dapp-support-agent.js)
- [scripts/support-run.mjs](../../scripts/support-run.mjs)
- [public/js/tasks/dapp-support-agent.js](../../public/js/tasks/dapp-support-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [contracts/FailLab.sol](../../contracts/FailLab.sol)
- [config/support-demo.json](../../config/support-demo.json)
- [reports/support-run.json](../../reports/support-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25, 26, 28), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 28, 30), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 28, 29, 30), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 29), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 28), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19, 22, 23, 25, 26, 28), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19, 22, 23, 25, 26, 28), [lib/risk.js](../../lib/risk.js) (also task 25), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 25, 26, 28), [lib/rpc-batch.js](../../lib/rpc-batch.js) (also tasks 25, 26, 28, 30), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 22, 23, 25, 26, 28), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19, 22, 23, 25, 26, 28), [lib/testnet-contracts.js](../../lib/testnet-contracts.js) (also tasks 6, 8, 10, 20), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22, 23, 25, 26, 28), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10, 11, 20, 24, 25, 29), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/support.test.js
```

## Verify it yourself

- **Open a failed transaction.** Each recorded case links to the explorer, which shows the failed status the agent started from.
- **Diagnose your own.** The Try tab takes any hash on mainnet or Atlantic.
- **Run it.** The CLI prints the explanation and every step it took.
- **Read the tests.** Each cause is tested against a fake chain, including the numbers that tell balance and allowance failures apart.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
