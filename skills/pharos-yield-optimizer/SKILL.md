---
name: pharos-yield-optimizer
description: Decide whether a wallet should move USDC to a better vault on Pharos mainnet. Measures what each of the four vaults (R25 weekly, quarterly, semi-yearly, RockawayX/Morpho) actually paid from their share price, tests with simulations whether this wallet can get in and out, counts gas (measured by really executing the steps on a mainnet fork) and fees over a holding period you choose, and answers MOVE with the expected net gain and unsigned transactions, or STAY PUT with the reason. Read-only; never holds a key or sends.
---

# Pharos Yield Optimizer

A skill for "is there a better place for this USDC, once everything is counted?". It compares the vaults with live data, rejects the ones that cannot be used, and either prepares a move for you to sign or tells you to stay.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- **No private key.** A MOVE is prepared as unsigned transactions.
- To re-measure gas: Foundry's `anvil` (`node scripts/yield-fork-run.mjs`).

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through Chain MCP and repeats every batch on the public RPC. See `assets/networks.json`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Is there a better place for my USDC?", "should I move my money?" | Compare and decide | → references/yield-optimizer.md#compare-and-decide |
| "Why not the vault with the highest rate?" | Read the rejections | → references/yield-optimizer.md#read-the-rejections |
| "What would it cost?", "what do I sign?" | The plan and the transactions | → references/yield-optimizer.md#the-plan-and-the-transactions |

## Write Operation Pre-checks

The optimizer sends nothing. Before **signing** a prepared transaction the user must check the vaults and the amount, that the network is Pharos mainnet, that the wallet holds enough PROS for the gas limits, and run the optimizer again immediately before, because the share price and the rates move. Never ask for a key.

## Security Reminders

- **The best rate is not the best choice.** A vault that refuses this wallet, cannot be redeemed, or caps deposits below the amount is rejected however much it pays.
- Rates are what a vault paid recently, not a promise. A rate that was uneven across the window is not trusted.
- "Why" a vault refuses is usually unknown (its errors are custom): say what the error carries, and that the vault does not say why.
- Gas figures come only from steps that succeeded on the fork run. With none for a vault, the move is not priced and not recommended.
