---
name: pharos-threshold-guardian
description: Decide whether an on-chain action should fire by checking several live Pharos conditions together (gas, balances, vault share price) against configurable thresholds, and explain the decision condition by condition. Read-only: it never sends a transaction.
---

# Pharos Threshold Guardian

A skill for the Pharos agent toolkit. Use it when an action should only happen if **several things are true at once**, for example "only rebalance if gas is cheap, the venue has liquidity, and the vault has actually moved". It evaluates the conditions, prints a clear trace, and answers **FIRE** or **HOLD**. Acting on the answer is a separate step the user approves.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (the script runs from the repository root).
- No private key. This skill is read-only and must never be given one.
- Optional, for manual checks: Foundry (`cast`).

## Network Configuration

Endpoints are in `assets/networks.json`. Conditions are read from **Pharos mainnet** (chain 1672) through the Chain MCP server (`https://mcp.pharos.xyz/mcp`). Always pass the RPC explicitly when using `cast`: `--rpc-url https://rpc.pharos.xyz`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Should I do X now?", "only do X if A and B and C", "check the conditions before rebalancing / swapping / claiming" | Evaluate a guardian config → FIRE or HOLD | → references/threshold-guardian.md#evaluate-a-guardian |
| "Why didn't it fire?", "which condition failed?", "explain the decision" | Read the decision trace | → references/threshold-guardian.md#read-the-decision-trace |
| "Set up a guardian for …", "change the thresholds", "make it stricter" | Write or edit a guardian config | → references/threshold-guardian.md#write-a-guardian-config |
| "Is gas cheap right now?", "does this vault have enough USDC?", "has the vault price moved?" | Check one condition by hand with `cast` | → references/threshold-guardian.md#check-one-condition-by-hand |

## Write Operation Pre-checks

This skill has **no write operations**. If the user asks to act on a FIRE decision (send a transaction, deploy, transfer), stop, hand over to the transaction skills, and run their pre-checks (key set, address valid, network, balance) first. Never read or ask for a private key here.

## Security Reminders

- A condition that cannot be read counts as **not met**. The guardian fails safe: when in doubt it holds.
- Thresholds are the user's decision. Do not loosen them to make a run fire.
- Report the real block number the decision was made at; decisions go stale quickly.
