# Trend Watcher Operation Instructions

> Network Configuration: RPC and MCP come from `assets/networks.json` (use `mainnet`).
> Private Key: not used.

---

## Observe and test the rule

### Overview

Reads one metric at the latest block, appends it to the state file (identified by its block, so it can never be added twice), then tests the rule against the stored history.

### Command Template

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --observe --direction down --observations 3
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--state` | path | No (default `trend-state.json`) | The persistent state file. Created on first use. |
| `--metric` | string | Yes (first run) | `morpho-usdc`, `usdc-supply`, `wpros-supply`, `vrpcw-share`. |
| `--observe` | flag | Yes | Record the reading at the latest block. |
| `--direction` | `down` \| `up` | No (default `down`) | Which trend to watch for. |
| `--observations` | integer ≥ 3 | No (default 3) | Consecutive observations that must all move the same way. |
| `--min-step` | number | No (default 0) | Each step must move at least this many percent. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `N new observation(s), M already stored` | M > 0 means the same blocks were seen again and skipped (never duplicated). |
| `◀ TREND MET HERE` | The observation that completed the trend. |
| `status:` | `TREND ACTIVE` or `no trend`, with the reason. |
| Exit code | `0` no trend, `10` trend active, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `observations must be a whole number of at least 3` | Rule too weak | Use 3 or more. |
| `not a trend-watcher state file` | The path holds something else | Use a different `--state` path. |
| `metric must be one of …` | Unknown metric | Use a listed one. |
| `HTTP 429` / `503` notes | Chain MCP busy | Retry; the script waits. |

> **Agent Guidelines**:
> 1. Run it on a schedule (for example every hour). Each run adds one observation.
> 2. Report the status, the latest value, and how many observations are stored.
> 3. If the trend is active, give the exact block and values where it was met.
> 4. Do not act on it yourself; ask.

---

## Back-fill history

### Overview

Samples past blocks on a **fixed grid** (multiples of `--step`), so running it again later picks the same blocks and adds nothing twice.

### Command Template

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --backfill 8 --step 20000
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--backfill` | integer 1–20 | Yes | How many past samples. |
| `--step` | integer ≥ 100 | No (default 20000) | Blocks between samples (about 1 second each). |

### Output Parsing

Same as above. The history is stored oldest to newest.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `count must be a whole number from 1 to 20` | `--backfill` out of range | Use 1 to 20. |
| `step must be a whole number of at least 100 blocks` | `--step` too small | Use 100 or more (default 20000). |
| `… gave 3 different answers in a row … inconsistent historical state` | The node returned inconsistent history for a block | Retry later; nothing wrong is stored. |

> **Agent Guidelines**:
> 1. Say how far back the history reaches in time (the table shows each block's timestamp).

---

## Show the history

### Overview

Prints the stored observations and every trigger and clear event. Needs no network.

### Command Template

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --show
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--show` | flag | Yes | Print only. |
| `--json` | flag | No | The raw state. |

### Output Parsing

`triggered at block …; values a → b → c` is the exact moment and the readings that satisfied the rule. `cleared at block …` is when it stopped holding.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `not a trend-watcher state file` | The path holds a different JSON file | Use the right `--state` path. |
| `Unexpected token` while loading | The state file is corrupt | Restore it from a copy, or `--reset` only if the user agrees. |

> **Agent Guidelines**:
> 1. Quote the trigger block and the values, not a paraphrase.

---

## Change the rule

### Overview

The rule in the command overrides the stored one from that run on. History is kept.

### Command Template

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --show --direction up --observations 4 --min-step 0.5
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--direction` | `down` \| `up` | No | Which trend to watch for. |
| `--observations` | integer ≥ 3 | No | Consecutive observations that must all move the same way. |
| `--min-step` | number ≥ 0 | No | Each step must move at least this many percent. |

### Output Parsing

Re-evaluated against the stored history.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `observations must be a whole number of at least 3` | Rule too weak | Use 3 or more. |
| `direction must be "down" or "up"` | Unknown direction | Use `down` or `up`. |
| `minStepPct must be 0 or more` | Negative step | Use 0 or a positive number. |

> **Agent Guidelines**:
> 1. Confirm with the user before loosening a rule.

---

## Reset

### Overview

Starts a fresh state at the same path. Only on the user's request.

### Command Template

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --reset
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--reset` | flag | Yes | Discards stored history. |

### Output Parsing

An empty state.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `EACCES` on the state path | The file or folder is not writable | Choose another `--state` path. |
| The user did not ask to reset | Resetting discards history | Do not run it; ask first. |

> **Agent Guidelines**:
> 1. Never reset without being asked.
