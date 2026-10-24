# 11. Policy Gatekeeper

> A policy in front of an agent: every request is allowed or denied by a named rule, denied requests never run, and every decision is logged.

**Arena task:** SkillEngine · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/policy-gatekeeper)  
**Try it:** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper

## What it does

An agent that can spend money needs limits it cannot talk its way past. The Policy Gatekeeper is a Pharos Skill that sits in front of every action the agent wants to take and checks it against a policy file: how much it may spend, which addresses and functions it may touch, and during which hours. The answer is always allow or deny, with the specific rule that decided and the numbers behind it.

## What is real

Policy (spend limit, allowlist, time window) in front of a real wallet: 2 requests allowed and sent on Atlantic, 6 denied by named rules and never sent; the chain confirms it. Hash-chained audit log, re-verified on load.

Real transaction to open: https://atlantic.pharosscan.xyz/tx/0x6dfe7b23afd362bf2119c0b651db91af61c33ef7f5573c945b46e9feabedd79f

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | A policy file or config with at least 3 rule types: spend limit, allowlist, time window. | A policy file with all three rule types: spend limit (per request and per window), allowlist (target, recipient, selector) and time window (UTC days and hours). A policy with fewer is rejected. |
| 2 | Every request returns allow or deny with the specific rule that decided it. | Every request returns allow or deny with the deciding rule’s id and type, a one-sentence reason with the numbers, and the check of every rule. |
| 3 | Denied actions are never executed. Shows at least one deny per rule type. | Denied requests never reach the executor: shown for each rule type on the live panel (executor calls vs denials) and on Pharos Atlantic, where the chain confirms no denied request was sent. |
| 4 | Keeps an audit log of all decisions. | A hash-chained audit log of every decision and its outcome, verified again when the page loads; editing an entry is detected and shown. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy skills/pharos-policy-gatekeeper/examples/policy.json --requests skills/pharos-policy-gatekeeper/examples/requests.json --log audit.jsonl
node skills/pharos-policy-gatekeeper/scripts/gate.mjs --verify audit.jsonl
node scripts/testnet-gatekeeper.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
1  ALLOW r1-pay-treasury        rule: all-rules-passed
      allowed: all 4 rules passed (3 applied)
 2  DENY  r2-too-big             rule: native-spend
      denied by rule "native-spend" (spend-limit): 0.05 PROS is over the per-request limit of 0.01 PROS
 4  DENY  r4-over-the-day        rule: native-spend
      denied by rule "native-spend" (spend-limit): 0.009 PROS on top of 0.013 PROS already allowed in the last 24 h would be 0.022 PROS, over the window limit of 0.02 PROS
 5  DENY  r5-stranger            rule: known-targets
 7  DENY  r7-weekend             rule: office-hours
      denied by rule "office-hours" (time-window): sat 10:00 UTC is outside the allowed window (mon/tue/wed/thu/fri 08:00-18:00 UTC)

2 allowed, 6 denied (native-spend: 2, known-targets: 1, known-functions: 1, office-hours: 1, request-shape: 1); denied requests that reached the executor: 0
audit log: intact, 16 entries
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/policy.json](examples/policy.json)
- [examples/requests.json](examples/requests.json)
- [references/policy-gatekeeper.md](references/policy-gatekeeper.md)
- [scripts/gate.mjs](scripts/gate.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/policy-gatekeeper.js](../../lib/tasks/policy-gatekeeper.js)
- [scripts/testnet-gatekeeper.mjs](../../scripts/testnet-gatekeeper.mjs)
- [public/js/tasks/policy-gatekeeper.js](../../public/js/tasks/policy-gatekeeper.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/testnet-gatekeeper.json](../../reports/testnet-gatekeeper.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/audit-log.js](../../lib/audit-log.js) (also task 12), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/policy.js](../../lib/policy.js) (also tasks 12, 15), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 12), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 3, 5, 6, 7, 8, 10, 12, 13, 14, 15), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 15), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 12), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

3 test files cover this task (run all of them with `npm test`):

```bash
node --test test/policy.test.js test/audit-log.test.js test/gatekeeper-task.test.js
```

## Verify it yourself

- **Open the real transactions.** The two allowed payments on Atlantic. Every hash on the testnet card links to the explorer, and the card re-reads each one from the chain when it loads.
- **Ask the chain about a denied request yourself.** The stranger address on the card was denied and must hold nothing. Replace the address with the one shown on the card.
- **Check the wallet sent only what was allowed.** The nonce is the number of transactions the wallet has ever sent; compare it with the recorded value on the card (plus anything sent since).
- **Reproduce the decisions.** Runs the same engine on the example policy; needs only Node.js and, for requests without a time, Chain MCP.
- **Read the skill itself.** SKILL.md, the reference, the script and the example policy are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
