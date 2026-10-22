---
name: pharos-batch-executor
description: Bundle several independent on-chain actions (native transfers, or contract calls that do not depend on who sends them) into ONE prepared transaction through Multicall3, report the real gas and step change against sending them one by one, and say exactly which action fails and what happens to the rest. Prepares only; never signs or sends.
---

# Pharos Batch Executor

A skill for "do these three or more independent things in one go". It simulates every action first, bundles what passes into a single `Multicall3.aggregate3Value` transaction, and reports the **measured** gas against sending them separately. A batch is not automatically cheaper, so the report says plainly when it costs more.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- For `--fork`: Foundry's `anvil`.
- **No private key.** The batch is prepared unsigned; signing is the user's step.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through Chain MCP; Multicall3 is `0xcA11bde05977b3631167028862bE2a173976CA11`. See `assets/networks.json`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Do these in one transaction", "batch these transfers / calls", "bundle several actions" | Plan a batch | → references/batch-executor.md#plan-a-batch |
| "Is batching cheaper?", "how much gas does it save?" | Compare with sending one by one | → references/batch-executor.md#read-the-comparison |
| "What if one of them fails?", "which one failed?" | Failure policy | → references/batch-executor.md#failure-policy |
| "Prove it on a copy of the chain" | Run on a fork | → references/batch-executor.md#run-on-a-fork |

## Write Operation Pre-checks

Planning sends nothing. Before **sending** the prepared transaction, the user must complete the pre-checks (their own key, valid addresses, correct network, enough balance for the value **and** gas) and approve the exact total. Never ask for a key.

## Security Reminders

- Through Multicall3 the inner sender is **Multicall3, not the user**. ERC-20 `transfer`, `approve` and `transferFrom` are therefore refused. **Never approve Multicall3**: anyone could then spend the approved tokens.
- Batches are all-or-nothing (`allowFailure=false`), so a failing call can never strand the value meant for it.
- A passing simulation is a prediction about now.
