---
name: pharos-portfolio-assistant
description: Answer plain-English questions about a wallet on Pharos mainnet (total balance, what it holds, where its USDC is, what a token is worth, its biggest position, a named vault, which protocols it uses, what it is earning), reading native PROS, USDC, WPROS and the four ERC-4626 vaults of R25 and RockawayX/Morpho at one pinned block, confirming every read on the public RPC, and showing each figure with its contract, call and block. Says so when it does not know. Read-only; never signs or sends.
---

# Pharos Portfolio Assistant

A skill for "what do I have, where is it, what is it doing?". It reads one wallet's positions, then answers one question in a sentence, followed by every figure and the numbered source it came from.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- **No private key.** The assistant only reads.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through Chain MCP and repeats every batch on the public RPC. See `assets/networks.json`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "What do I have?", "where is my USDC?", "what's my biggest position?", "how much is in R25 Quarterly?", "which protocols am I using?" | Ask about a wallet | → references/portfolio-assistant.md#ask-about-a-wallet |
| "What am I earning?" | Earnings of the vault positions | → references/portfolio-assistant.md#earnings |
| "Where did that number come from?", "can I trust it?" | Sources and confirmation | → references/portfolio-assistant.md#sources-and-confirmation |

## Write Operation Pre-checks

Nothing is written. There is no transaction to check.

## Security Reminders

- **Say what you do not know.** Another protocol, what the wallet earned since it deposited, or anything outside the eight question types is refused, not estimated.
- A figure without a source is not shown. A total is withheld if any holding has no price.
- A vault position that cannot be redeemed (or only in part) is counted but flagged; never describe it as freely available.
- Rates are what a vault paid recently, not what it will pay.
