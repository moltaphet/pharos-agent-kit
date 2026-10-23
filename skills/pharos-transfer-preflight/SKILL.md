---
name: pharos-transfer-preflight
description: One request in, one verdict out. Takes a sentence like "send 1 USDC from 0x… to 0x…", reads the chain through Chain MCP (the block, its time, the token, the sender's balance), has the Policy Gatekeeper decide at that block's time, has the Dry-Run Executor simulate only what the policy allowed, and returns READY (an unsigned transaction) or STOP (which rule, or which revert). A composition of Chain MCP and two Pharos Skills; never signs or sends.
---

# Pharos Transfer Pre-flight

A skill for "can this transfer go out right now, and if so what exactly do I sign?". It is a flow, not a lookup: Chain MCP supplies live facts, the Skills decide with them, and what is asked of Chain MCP next depends on what the Skills decided.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- **No private key.** The result is an unsigned transaction.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through Chain MCP. See `assets/networks.json`. Everything is pinned to one block (two behind the head by default, or `--block N`).

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Can I send 1 USDC from A to B?", "check this transfer before I sign" | Run the flow | → references/transfer-preflight.md#run-the-flow |
| "What called what, in what order?", "show me the flow" | Read the flow diagram | → references/transfer-preflight.md#flow-diagram |
| "Run it again exactly", "what would it have said on Saturday?" | Repeat a run at a block | → references/transfer-preflight.md#repeat-a-run-at-a-block |

## Write Operation Pre-checks

The flow sends nothing. Before **signing** a READY result the user must check the recipient and amount, that the network is Pharos mainnet, that the sender has enough PROS for the gas limit, and that the simulation is a prediction about a block that has already passed: state can change before the transaction is mined. Never ask for a key.

## Security Reminders

- **Fail closed.** An unreadable request, a token whose on-chain symbol is not the one named, a policy counted in other decimals than the token has, a denied policy rule, or a failing simulation each end in STOP. Nothing is guessed.
- A denied request is never simulated: the policy decides before Chain MCP is asked to simulate.
- The clock is the block's timestamp, not the machine's. The policy's time window is UTC.
- A passing simulation is a prediction. The prepared gas limit carries 30% headroom because estimates can undershoot.
