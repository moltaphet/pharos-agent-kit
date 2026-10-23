---
name: pharos-dry-run-executor
description: Simulate a Pharos transaction before it is sent: predict success or revert (with the decoded reason), the gas cost, and what would change (balances, allowances), and block execution automatically if the simulation fails. Read-only; never holds a key.
---

# Pharos Dry-Run Executor

A skill for "will this work, and what will it do?" before any transaction is sent. It simulates the call with `eth_call` and `estimate_gas` on the live chain at one block, decodes why it would revert, costs the gas, predicts the before/after for transfers and approvals, and **blocks execution automatically when the simulation fails**.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- For `--fork`: Foundry's `anvil` (`foundryup`).
- **No private key.** The simulation needs only the sender's *address*.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through the Chain MCP server. `assets/networks.json` has the endpoints. With `cast`, always pass `--rpc-url https://rpc.pharos.xyz`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Will this transaction work?", "check it before I send", "simulate this transfer" | Dry-run a transaction | → references/dry-run-executor.md#dry-run-a-transaction |
| "Why would it fail?", "what does this revert mean?" | Read the decoded revert | → references/dry-run-executor.md#read-the-result |
| "What will change?", "what will my balance be after?" | Predicted before/after | → references/dry-run-executor.md#read-the-result |
| "Send it if it's safe", "don't send it if it would fail" | Guarded execution | → references/dry-run-executor.md#guarded-execution |
| "Show me the real state change", "test it for real without risk" | Run it on a local fork | → references/dry-run-executor.md#run-on-a-fork |

## Write Operation Pre-checks

Dry-running sends nothing. **Sending for real** is a separate step: complete the pre-checks (key set by the user in their own environment, address valid, correct network, sufficient balance) and get explicit approval first. This skill never reads or asks for a key; a passing simulation is a reason to proceed, not a substitute for approval.

## Security Reminders

- A passing simulation is a prediction about *now*. State can change before the transaction is mined; do not treat it as a guarantee.
- A revert with no reason is still a failure. Never send anyway.
- Estimated gas is a guide, not a bound: real usage is often lower, but an estimate can also undershoot (nested calls), so send with headroom.
