# 25. Wallet Risk Checker

> Looks at a wallet’s or contract’s history on Pharos and flags red flags before you interact with it.

**Arena task:** Compliance / Security · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/wallet-risk-checker)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/wallet-risk-checker/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/wallet-risk-checker

## What it does

Paste an address. The checker reads the chain, no one else’s opinion, and runs a set of signals. For a contract: how old its code is, whether it is an upgradeable proxy and who can change it, who owns it and what the owner can do (mint, freeze, change fees, pause, drain), and whether the bytecode contains instructions that can destroy the contract or run outside code as its own. For a wallet: how old its first transaction is, how much history it has, whether it was only just funded, and which unlimited token approvals it still has outstanding.

## What is real

A pre-transaction check that reads the chain and returns low, medium or high with every flag in plain language: contract age (binary search over history), proxy/upgradeability, owner and administrator powers read from the bytecode, dangerous instructions, wallet age and activity, outstanding unlimited approvals (judging the spender too), and contact with a flag list. Five recorded examples: WPROS and an established wallet are low, USDC (an upgradeable proxy) is medium, and a deliberately risky token and a brand-new wallet with an unlimited approval to it, both created on Atlantic testnet for the demo, are high.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Checks at least 4 signals, e.g. contract age, verified code, interaction with flagged addresses, unusual approval patterns, freshly funded wallet. | Eight signals: contract age, upgradeability, admin powers, dangerous instructions, wallet age and activity, outstanding unlimited approvals, and contact with a flag list. Each check shows which were read. |
| 2 | Outputs a risk level (low, medium or high) with the specific reasons. | The result is low, medium or high, with each flag listed with its severity, a title and its evidence. USDC, for example, is medium: “Upgradeable proxy”. |
| 3 | Explains each flag in plain language. | Every flag has a plain-language paragraph saying what was found and why it matters; clean signals say what was checked and found fine. |
| 4 | Demonstrated on at least 1 clean and 1 risky example. | Five recorded examples: WPROS and an established wallet (both low), USDC (medium), a deliberately risky token and a brand-new wallet with an unlimited approval to it (both high). |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node scripts/risk-run.mjs
node agents/wallet-risk-checker/pharos-risk.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0
node agents/wallet-risk-checker/pharos-risk.js 0x7d7abe8bf2de1191ce659f997869434510a18d32 --chain atlantic
```

## Sample output

Output of node scripts/risk-run.mjs:

```text
→ low: LOW risk: none of the 4 signals checked raised a flag.
  → low: LOW risk: none of the 3 signals checked raised a flag.
  → medium: MEDIUM risk: Upgradeable proxy.
  → high: HIGH risk: Deployed 6 minutes ago; One key controls the contract; The contract can destroy itself; Runs outside code as its own.
  → high: HIGH risk: Unlimited USDC (demo) approval to 0x7d7a…8d32; New wallet: first activity 6 minutes ago.
```

## What is in this folder

- [pharos-risk.js](pharos-risk.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/risk.js](../../lib/risk.js)
- [lib/tasks/wallet-risk-checker.js](../../lib/tasks/wallet-risk-checker.js)
- [scripts/risk-run.mjs](../../scripts/risk-run.mjs)
- [public/js/tasks/wallet-risk-checker.js](../../public/js/tasks/wallet-risk-checker.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [contracts/RiskyToken.sol](../../contracts/RiskyToken.sol)
- [config/risk-demo.json](../../config/risk-demo.json)
- [reports/risk-run.json](../../reports/risk-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 26, 27, 28), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 26, 27, 28, 30), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 19, 22, 23, 26, 27, 28), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 19, 22, 23, 26, 27, 28), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 19, 22, 23, 26, 27, 28), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 20, 21, 22, 23, 26, 27, 28), [lib/rpc-batch.js](../../lib/rpc-batch.js) (also tasks 26, 27, 28, 30), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 19, 22, 23, 26, 27, 28), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 19, 22, 23, 26, 27, 28), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 20, 22, 23, 26, 27, 28), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10, 11, 20, 24, 27, 29), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

1 test file covers this task (run all of them with `npm test`):

```bash
node --test test/risk.test.js
```

## Verify it yourself

- **Check an address yourself.** Use the Try tab: any address on mainnet or Atlantic.
- **Look at the risky token.** Open its address on the Atlantic explorer: owner, mint and the rest are in its code (contracts/RiskyToken.sol).
- **Repeat a signal by hand.** The owner of a contract is one call away.
- **Read the tests.** The bytecode scanner, every flag and the level rules run against a fake chain.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
