---
name: pharos-arbitrage-scanner
description: Compare the price of one token pair on two Pharos venues (FaroSwap V2 and V3) in the same scan, net out swap fees, price impact and gas, and report whether a trade is still profitable. Simulated execution only; never sends a transaction or needs a key.
---

# Pharos Arbitrage Scanner

A skill for "is there a real arbitrage right now?". One scan reads the same pair from **two independent venues at one block**, simulates buying on the cheaper and selling on the dearer, subtracts **fees, price impact and gas**, and acts only if the net profit clears a threshold the user set. Acting means a **simulated fill**: the skill never signs or sends anything.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- No private key, and none must ever be requested.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through the Chain MCP server using one batched Multicall3 call per scan. See `assets/networks.json`. Pools are listed in `lib/protocols.js` (`ARB_PAIRS`).

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Is there an arbitrage on WPROS?", "compare prices on the two DEX versions", "is this spread real?" | Scan a pair once | → references/arbitrage-scanner.md#scan-a-pair |
| "Keep checking", "log every scan", "watch for an opportunity" | Scan repeatedly and log | → references/arbitrage-scanner.md#scan-repeatedly-and-log |
| "Why didn't it trade?", "what would it need to be profitable?" | Read the decision and the skip reasons | → references/arbitrage-scanner.md#read-the-decision |
| "Show me what a profitable one looks like" | Run a labelled synthetic scenario | → references/arbitrage-scanner.md#synthetic-scenarios |
| "Does the act path really work?", "prove the maths on the real contracts" | Run both legs on a local fork and compare prediction with outcome | → references/arbitrage-scanner.md#real-evm-fork-run |

## Write Operation Pre-checks

None: this skill is read-only. If the user wants to trade for real, stop and hand over to the transaction skills with their pre-checks (key set by the user, address, network, balance). A swap needs a router and approvals that this skill does not prepare.

## Security Reminders

- A huge headline spread on a nearly empty pool is **not** money. Always report depth next to the spread.
- If a trade would push the V3 price out of its active tick range the estimate is not trustworthy, so the skill skips instead of guessing.
- Never loosen the profit threshold to make a scan "succeed".
