---
name: pharos-saga-executor
description: Run a multi-step on-chain workflow (approve, deposit, transfer) where each step is verified before the next, transient failures are retried, and a permanent failure undoes what already happened. Proven on a local fork of Pharos mainnet with real contracts; never needs a private key.
---

# Pharos Saga Executor

A skill for workflows where steps depend on each other and a half-finished run would strand funds: "approve, then deposit, then move the shares". It runs each step, **checks the receipt and the resulting state** before starting the next, retries only what is worth retrying, and **undoes completed steps in reverse order** if a later step fails for good. It keeps a state log of everything it did.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- Foundry's `anvil` (for the fork runner): `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- **No private key.** The fork runner uses anvil's built-in dev accounts and impersonation, which exist only on the local fork. Never paste a real key into this skill.

## Network Configuration

`assets/networks.json` lists the endpoints. The fork runner forks **Pharos mainnet** (`https://rpc.pharos.xyz`, chain 1672): real contracts and balances, but every transaction only changes the local fork.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Run a multi-step flow safely", "approve then deposit then …", "do these steps in order and undo if one fails" | Run the vault saga on a fork (success and forced failure) | → references/saga-executor.md#run-a-saga-on-a-fork |
| "What happens if a step fails halfway?", "will my funds get stuck?", "show me the rollback" | Read the state log and the final check | → references/saga-executor.md#read-the-state-log |
| "Retry if the transaction drops", "what counts as a transient error?" | Retry policy | → references/saga-executor.md#retry-policy |
| "Add my own steps", "make a saga for …" | Define a saga | → references/saga-executor.md#define-a-saga |
| "Run it for real", "send it on mainnet" | Going live | → references/saga-executor.md#going-live |

## Write Operation Pre-checks

The fork runner sends transactions, but only to a throwaway local fork. **Going live is different**: before any real transaction, complete the pre-checks (key set by the user in their own environment, address valid, correct network, sufficient balance) and get the user's explicit approval for the exact amounts. This skill never reads, stores or asks for a private key.

## Security Reminders

- A revert is never retried: sending the same failing transaction again cannot fix it.
- Verify the **state**, not only the receipt. A transaction can succeed and still not do what the next step needs.
- If an undo fails, say so plainly and list what is stranded. Never report "rolled back" unless the final check agrees.
