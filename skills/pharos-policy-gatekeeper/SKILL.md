---
name: pharos-policy-gatekeeper
description: Put a policy in front of an agent's on-chain actions. Each request (native transfer, ERC-20 transfer/approve/transferFrom, or any contract call) is checked against spend limits, allowlists and time windows, answered allow or deny with the exact rule that decided it, never executed when denied, and written to a tamper-evident audit log. Decides and records only; never signs or sends.
---

# Pharos Policy Gatekeeper

A skill for "should the agent be allowed to do this?". It reads a policy file, checks one requested action against every rule, and returns **allow** or **deny** plus the specific rule that decided. A denied action never reaches the executor. Every decision, allowed or not, is appended to a hash-chained audit log that `--verify` can check later.

## Prerequisites

- Node.js 20+ and a clone of the `pharos-agent-kit` repository (run from its root).
- **No private key.** The gate decides; whoever calls it executes.

## Network Configuration

Requests without an explicit `at` time are checked at the timestamp of the latest confirmed Pharos block (Chain MCP), so the clock is the chain's, not the machine's. See `assets/networks.json`.

## Capability Index

| User need | Capability | Detailed instructions |
|-----------|------------|----------------------|
| "Can the agent do this?", "check these requests against my policy" | Check requests | → references/policy-gatekeeper.md#check-requests |
| "Write me a policy", "what rule types exist?" | Write a policy | → references/policy-gatekeeper.md#write-a-policy |
| "Show me what was decided", "has the log been changed?" | Audit log | → references/policy-gatekeeper.md#audit-log |

## Write Operation Pre-checks

The gate sends nothing. The caller that executes an **allowed** request must still complete its own pre-checks (key, network, balance for value and gas) and must call the gate through `guardedExecute`, which records the decision first and never runs the executor after a deny.

## Security Reminders

- **Fail closed.** A request that cannot be read, a policy that is invalid, or an audit log that fails verification produce a deny or an error. Nothing is guessed.
- The **first failing rule in policy order decides**; the full per-rule trace lists every failure.
- An ERC-20 `approve` counts as spending its full amount, because the spender can take up to that much.
- The audit log proves entries were not altered, reordered or removed in the middle. It cannot prove the last entries were not cut off: keep the head hash `--verify` prints.
- A spend limit sees only requests that went through the same gate and log. It cannot stop spending that bypasses the gate.
