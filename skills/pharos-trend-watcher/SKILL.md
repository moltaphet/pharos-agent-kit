---
name: pharos-trend-watcher
description: A watcher with memory. It records on-chain readings between runs in a state file and acts only when a trend holds over several consecutive observations (for example "falling for 3 checks in a row"), never on a single noisy reading. Survives restarts without losing or duplicating history. Read-only.
---

# Pharos Trend Watcher

A skill for "tell me when it's really moving". One reading proves nothing: a lending pool's liquidity can drop and come back. This skill **stores every observation on disk**, and fires only when the last N observations all move the same way. It remembers across runs, so it can be started, stopped and restarted without gaps or duplicates.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- A writable path for the state file (default `trend-state.json`).
- No private key. Read-only.

## Network Configuration

Reads **Pharos mainnet** (chain 1672) through the Chain MCP server (`assets/networks.json`). Historical blocks are readable, so a history can be back-filled in one command.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Tell me if X keeps falling", "alert me only on a real trend, not a blip", "watch the trend over time" | Observe on a schedule and test the trend rule | → references/trend-watcher.md#observe-and-test-the-rule |
| "Show me the history", "when did the trend start?", "what did you record?" | Show stored history and trigger moments | → references/trend-watcher.md#show-the-history |
| "Build up a history now", "look back over the last few days" | Back-fill from past blocks | → references/trend-watcher.md#back-fill-history |
| "Make it stricter / looser", "how many readings before it fires?" | Change the rule | → references/trend-watcher.md#change-the-rule |
| "Start over" | Reset the state | → references/trend-watcher.md#reset |

## Write Operation Pre-checks

None: read-only, no transactions. If the user wants an action when the trend fires, report it and ask; do not act.

## Security Reminders

- A rule must need **at least 3** observations. Never lower it to make an alert fire.
- The state file is the memory. Do not delete or hand-edit it unless the user asks to reset.
- A single spike or dip is noise by design. Say so when asked why nothing fired.
