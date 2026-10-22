# Arbitrage Scanner Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. Execution is simulated.

---

## Scan a pair

### Overview

Reads FaroSwap V2 reserves and V3 slot0 + liquidity for one pair in a single Multicall3 call at one block, plus the gas price. It prices the base token on both venues, picks the cheaper one to buy on and the dearer to sell on, then **searches trade sizes** (from 1e-12 x size up to `--size`) for the best net profit that stays inside V3's active tick range.

### Command Template

```bash
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --pair WPROS/DLP --size 1 --min-net 0.001
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--pair` | string | No (default `WPROS/DLP`) | `WPROS/DLP` or `UNI-V2/PDOG` (pairs that exist on both V2 and V3 with liquidity). |
| `--size` | number | No (default 1) | The **largest** trade considered, in the quote token. |
| `--min-net` | number | No (default 0.001) | Minimum net profit in the quote token. Below it the scan skips. |
| `--source` | string | No (default `live`) | `live`, or a labelled synthetic scenario (see below). |
| `--json` | flag | No | One JSON object per scan. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `gross spread` | Price gap between the two venues, in percent. Headline only: check depth. |
| `gross − fees − price impact − gas = net` | The working. Fees are each venue's tier; price impact is what is left of the edge after fees; gas is `(110k + 160k)` units at the live gas price, in the quote token. |
| `DECISION` | `EXECUTE-SIMULATED` (net ≥ threshold) or `SKIP`. |
| `skipped because` | The exact reason(s), with numbers. |
| Exit code | `0` a profitable simulated trade was found, `10` skipped, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `a venue did not answer` | A pool was drained or the address is wrong | Pick another pair. |
| `pair must be one of …` | Unknown pair | Use a listed pair. |
| `gas … cannot be converted` | Quote token is not WPROS | Use a WPROS-quoted pair; gas is paid in PROS. |
| `HTTP 429` / `503` notes | Chain MCP busy | Wait; the script retries. |

> **Agent Guidelines**:
> 1. Run the scan and quote the decision, the block and the working in the user's words.
> 2. If the spread is huge but the decision is SKIP, explain depth: "the pool holds almost nothing".
> 3. Never describe a simulated fill as a real trade.

---

## Scan repeatedly and log

### Overview

Runs N scans, each at a fresh block, and appends every scan (gross spread, costs, net, decision, reasons) to a JSON-lines file.

### Command Template

```bash
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --watch 10 --interval 5 --log scans.jsonl
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--watch` | integer | No (default 1) | Number of scans. |
| `--interval` | seconds | No (default 4) | Pause between scans. |
| `--log` | path | No | Append each scan as one JSON line. |

### Output Parsing

Each line of the log is a full scan. Filter with `jq 'select(.decision=="execute-simulated")'`.

### Error Handling

See *Scan a pair*.

> **Agent Guidelines**:
> 1. Keep the interval at 3 seconds or more: the Chain MCP rate limit is 120 requests a minute.
> 2. Summarise: how many scans, how many skipped, the best net seen.

---

## Read the decision

### Overview

A SKIP always carries its reasons. The common ones: net below the threshold (and by how much), V3 would leave its active range (with how much it can absorb), gas not convertible.

### Command Template

```bash
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--json` | flag | Yes | Fields: `decision`, `reasons[]`, `net`, `costs`, `depth`, `curve[]` (net at several sizes), `sources`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `depth.v2Quote` | Quote-token reserve in the V2 pool. |
| `depth.v3RangeSellBase` | Base tokens V3's active range can absorb when selling into it. |
| `curve[]` | Net profit at six sizes; `inRange:false` means the estimate is not trustworthy. |

### Error Handling

See *Scan a pair*.

> **Agent Guidelines**:
> 1. State what would have to be true for a trade: a smaller price gap is useless; deeper pools are what is missing.

---

## Synthetic scenarios

### Overview

Today's real FaroSwap pools are too thin for a profitable trade, so the "act" path is demonstrated on **clearly labelled synthetic pool states** that run the same maths: `profitable` (V3 prices the base 3% above V2, deep pools) and `marginal` (0.4% above, less than the fees).

### Command Template

```bash
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --source profitable --size 50   # exit 0
node skills/pharos-arbitrage-scanner/scripts/scan.mjs --source marginal   --size 50   # exit 10
```

### Parameters

See *Scan a pair* (`--source`).

### Output Parsing

The header prints `[Synthetic: …]`. Never present a synthetic result as a market observation.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `source must be live or one of …` | Unknown scenario | Use `profitable` or `marginal`. |

> **Agent Guidelines**:
> 1. Always say it is synthetic when you show it.
