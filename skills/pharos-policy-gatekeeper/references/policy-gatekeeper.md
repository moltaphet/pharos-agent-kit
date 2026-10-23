# Policy Gatekeeper Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. The gate decides and records; it never signs or sends.

---

## Check requests

### Overview

Reads a policy and a list of requests. Each request is read (native transfer, ERC-20 `transfer`/`approve`/`transferFrom`, or a generic contract call), checked against every rule, and answered with `allow` or `deny`, the deciding rule, a plain-language reason and the check of every rule. Decisions are appended to the audit log; the executor (here a counter) is called only for allowed requests.

### Command Template

```bash
node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy skills/pharos-policy-gatekeeper/examples/policy.json --requests skills/pharos-policy-gatekeeper/examples/requests.json --log audit.jsonl
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--policy` | path | Yes | Policy JSON (see Write a policy). |
| `--requests` | path | Yes | JSON array of `{ "id", "at", "from", "to", "value", "data" }`. `value` is whole wei; `data` is 0x hex; `at` is a UTC time such as `2026-10-26T10:00:00Z` (default: latest confirmed block time). At most 50 per run. |
| `--log` | path | No | Append decisions to this JSONL audit log (kept across runs, so spend windows see earlier runs). Default: in memory. |
| `--json` | flag | No | Also print the full result. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `ALLOW` / `DENY` | The answer for each request. |
| `rule: <id>` | The rule that decided. An allow reports `all-rules-passed`; an unreadable request reports `request-shape`. |
| reason | One sentence with the numbers, e.g. the amount, what was already spent in the window, and the limit. |
| `denied requests that reached the executor` | Must always be `0`. |
| Exit code | `0` all allowed, `10` at least one denied, `2` audit log broken, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `a policy needs all three rule types` | Policy lacks a spend-limit, allowlist or time-window rule | Add the missing rule type. |
| `duplicate rule id` / `id must be` | Rule ids must be unique, lowercase letters, digits and `-` | Rename the rule. |
| `the audit log is not intact, so nothing is decided or executed` | The log fails verification | Investigate with `--verify`; do not continue on a broken log. |
| `"at" must be a UTC time` | Wrong time format | Use `YYYY-MM-DDTHH:MM:SSZ`. |
| `Timed out` / `HTTP 429` | Chain MCP busy while reading the block time | Retry, or give each request an `at`. |

> **Agent Guidelines**:
> 1. Show each request's answer **with the rule that decided it**; never summarise a deny as "not allowed".
> 2. Never execute a denied request, retry it with changed numbers, or suggest splitting it to slip under a limit.
> 3. Report the audit log status and the head hash.
> 4. For allowed requests, remind the user the gate decided only; executing is a separate step with its own pre-checks.

---

## Write a policy

### Overview

A policy is JSON: `version` 1, a `name`, and 1 to 50 `rules` with unique ids. It must contain all three rule types. Rules are checked in order and the first failing rule decides.

| Rule type | Fields |
|-----------|--------|
| `spend-limit` | `asset` (`"native"` or a token address, tokens also need `decimals`), optional `symbol`, `perRequest` and/or `perWindow: { amount, seconds }` (60 s to 31 days). Amounts are plain decimals like `"0.01"`. The window counts only earlier **allowed** requests in the same asset. |
| `allowlist` | `field` (`target`, `recipient` or `selector`) and `values` (addresses, or 4-byte selectors like `0xa9059cbb`). |
| `time-window` | `timezone` (`"UTC"` only), optional `days` (`mon`…`sun`), `from` and `to` as `HH:MM` with `from` earlier than `to`. Start-inclusive, end-exclusive. |

### Command Template

```bash
node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy my-policy.json --requests my-requests.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--policy` | path | Yes | A starting point: `skills/pharos-policy-gatekeeper/examples/policy.json`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `policy "<name>" sha256 …` | Identifies the exact policy; stored in every decision. Any edit changes it. |
| `rules:` | The rule ids and types in the order they are checked. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `perWindow.seconds` | Window outside 60 s to 31 days | Pick a window in range. |
| `needs "decimals"` | Token spend limit without decimals | Add the token's decimals. |
| `timezone must be "UTC"` | Other zones are not supported | Convert the window to UTC. |
| `"from" must be earlier than "to"` | A window cannot cross midnight | Use a different set of `days`, or two windows' worth of days. |

> **Agent Guidelines**:
> 1. Ask for the limits, the allowed addresses and the allowed hours before writing a policy; do not invent them.
> 2. Put the strictest, most specific rules first so the deciding rule is the informative one.
> 3. Show the user the final policy and its hash.

---

## Audit log

### Overview

Every decision is appended as `{ seq, kind, prev, body, hash }`, where `hash` covers the entry and the previous hash. Each allowed request is followed by an `execution` entry (`executed` or `failed`); each denied one by `not-executed`. `--verify` re-computes the chain and reports edited, removed, reordered or inserted entries, and any execution recorded for a denied request.

### Command Template

```bash
node skills/pharos-policy-gatekeeper/scripts/gate.mjs --verify audit.jsonl
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--verify` | path | Yes | The JSONL log to check. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `audit log intact: N entries, head <hash>` | The chain is valid. Keep the head hash somewhere else to detect truncation. |
| `audit log BROKEN:` | Lists each problem with the entry number. Exit code `2`. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `line N is not valid JSON` | The file was damaged | Restore it from a copy; do not edit it by hand. |
| `was changed after it was written` | An entry differs from its hash | Treat the log as untrustworthy from that entry on. |

> **Agent Guidelines**:
> 1. Run `--verify` before relying on a log, and quote the head hash.
> 2. If it is broken, say which entry first, and do not keep deciding on top of it.
