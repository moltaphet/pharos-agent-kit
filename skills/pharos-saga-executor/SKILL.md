---
name: pharos-saga-executor
description: Run a multi-step on-chain workflow (approve, deposit, transfer) where each step is verified before the next, transient failures are retried, and a permanent failure undoes what already happened. Proven on Pharos Atlantic testnet with deployed test contracts, and rehearsed on a local fork of Pharos mainnet; never needs a real private key.
---

# Pharos Saga Executor

A skill for workflows where steps depend on each other and a half-finished run would strand funds: "approve, then deposit, then move the shares". It runs each step, **checks the receipt and the resulting state** before starting the next, retries only what is worth retrying, and **undoes completed steps in reverse order** if a later step fails for good. It keeps a state log of everything it did.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- Foundry's `anvil` (for the fork runner): `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- For the Atlantic runner: Foundry's `cast` and `forge`, plus a throwaway Atlantic wallet in the git-ignored `.wallet/atlantic-testnet.json` with a little PHRS from the testnet faucet. **No real key, ever.** The fork runner uses anvil's built-in dev accounts and impersonation, which exist only on the local fork. Never paste a real key into this skill.

## Network Configuration

`assets/networks.json` lists the endpoints. The fork runner forks **Pharos mainnet** (`https://rpc.pharos.xyz`, chain 1672): real contracts and balances, but every transaction only changes the local fork.

The Atlantic runner (`scripts/testnet-vault-saga.mjs`) runs the same vault saga on **Pharos Atlantic Testnet** (chain 688689). The mainnet vault does not exist there, so the runner deploys TestUSDC and TestVault (`contracts/TestUSDC.sol`, `contracts/TestVault.sol`) first, then runs one full success and one forced failure with recovery, and writes `reports/testnet-vault-saga.json` with every transaction hash. A fork hash cannot be opened on the explorer; an Atlantic hash can, which is why the Atlantic run is the proof and the fork run is only a rehearsal.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Run a multi-step flow safely", "approve then deposit then …", "do these steps in order and undo if one fails" | Run the vault saga on a fork (success and forced failure) | → references/saga-executor.md#run-a-saga-on-a-fork |
| "Run it for real on Atlantic", "show me the on-chain proof" | Run the vault saga on Atlantic testnet (success and forced failure with recovery) | → references/saga-executor.md#run-the-vault-saga-on-atlantic |
| "What happens if a step fails halfway?", "will my funds get stuck?", "show me the rollback" | Read the state log and the final check | → references/saga-executor.md#read-the-state-log |
| "Retry if the transaction drops", "what counts as a transient error?" | Retry policy | → references/saga-executor.md#retry-policy |
| "Add my own steps", "make a saga for …" | Define a saga | → references/saga-executor.md#define-a-saga |
| "Run it for real", "send it on mainnet" | Going live | → references/saga-executor.md#going-live |

## Write Operation Pre-checks

The fork runner sends transactions, but only to a throwaway local fork. **Going live is different**: before any real transaction, complete the pre-checks (key set by the user in their own environment, address valid, correct network, sufficient balance) and get the user's explicit approval for the exact amounts. The Atlantic runner only ever uses the throwaway wallet in `.wallet/atlantic-testnet.json`, only on chain 688689 (the signer refuses any other chain), and only inside its PHRS budget. This skill never reads, stores or asks for a private key.

## Security Reminders

- A revert is never retried: sending the same failing transaction again cannot fix it.
- Verify the **state**, not only the receipt. A transaction can succeed and still not do what the next step needs.
- If an undo fails, say so plainly and list what is stranded. Never report "rolled back" unless the final check agrees.
