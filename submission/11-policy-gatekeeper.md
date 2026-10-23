# 11. Policy Gatekeeper

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-policy-gatekeeper
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x6dfe7b23afd362bf2119c0b651db91af61c33ef7f5573c945b46e9feabedd79f
- **What the proof shows:** Policy (spend limit, allowlist, time window) in front of a real wallet: 2 requests allowed and sent on Atlantic, 6 denied by named rules and never sent; the chain confirms it. Hash-chained audit log, re-verified on load.

## Requirements it was built against (the Arena’s own list)

1. A policy file or config with at least 3 rule types: spend limit, allowlist, time window.
   - Met by: A policy file with all three rule types: spend limit (per request and per window), allowlist (target, recipient, selector) and time window (UTC days and hours). A policy with fewer is rejected.
2. Every request returns allow or deny with the specific rule that decided it.
   - Met by: Every request returns allow or deny with the deciding rule’s id and type, a one-sentence reason with the numbers, and the check of every rule.
3. Denied actions are never executed. Shows at least one deny per rule type.
   - Met by: Denied requests never reach the executor: shown for each rule type on the live panel (executor calls vs denials) and on Pharos Atlantic, where the chain confirms no denied request was sent.
4. Keeps an audit log of all decisions.
   - Met by: A hash-chained audit log of every decision and its outcome, verified again when the page loads; editing an entry is detected and shown.

Code and notes: [skills/pharos-policy-gatekeeper/README.md](../skills/pharos-policy-gatekeeper/README.md)
