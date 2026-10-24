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
| `--size` | number, 0 < size ≤ 1,000,000,000 | No (default 1) | The **largest** trade considered, in the quote token. |
| `--min-net` | number ≥ 0 | No (default 0.001) | Minimum net profit in the quote token. Below it the scan skips. A negative value is refused: it would accept a losing trade. |
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

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `EACCES` / `ENOENT` for `--log` | The log path is not writable | Choose another path. |
| `HTTP 429` notes | Chain MCP rate limit (120 requests a minute) | Use `--interval 3` or more. |
| `a venue did not answer` | A pool was drained mid-run | Pick another pair; the scan reports it and the loop stops. |

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

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `reasons[]` mentions the V3 tick range | No trade size stays inside the active range | Explain depth: the pool can absorb only a tiny amount. |
| `net` is `null`, reason mentions gas | The quote token cannot be converted to PROS | Use a WPROS-quoted pair. |
| Exit code `10` | Not an error: the scan skipped | Read `reasons[]`. |

> **Agent Guidelines**:
> 1. State what would have to be true for a trade: a smaller price gap is useless; deeper pools are what is missing.

---

## Real-EVM fork run

### Overview

Proves the "act" path against the **real FaroSwap contracts** instead of a model. The live pools hold less than the gas of one swap, so the run happens on a **local anvil fork** of Pharos mainnet: it re-prices the dust V2 pair to the V3 price with a real swap, deposits its own liquidity into both venues with real `mint` calls, moves the V2 price with another real swap, lets this skill's scanner decide on that state, and executes both legs with the helper contract `contracts/ArbLab.sol`. Predicted and actual profit are recorded side by side in `reports/arbitrage-runs.json`. Two scenarios: a 6% gap (the scanner acts) and a 0.3% gap (it skips, and a forced 5 WPROS trade is executed anyway to show it loses). Nothing touches a real network.

### Command Template

```bash
node scripts/arb-fork-run.mjs                       # rewrites reports/arbitrage-runs.json
node scripts/arb-fork-run.mjs --out /tmp/runs.json  # write somewhere else
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--out` | path | No | Where to write the report (default `reports/arbitrage-runs.json`). |

Requires Foundry (`anvil`, `forge`, `cast`) and a reachable `https://rpc.pharos.xyz`. No key is read: anvil's dev accounts are unlocked and balances are set on the fork.

### Output Parsing

Per scenario: `scan.decision`, `execution.predictedGrossProfit` against `execution.actualGrossProfit`, `execution.predictionErrorPct`, the measured `execution.gasUsed` against the assumed `predictedGasUnits`, and `rescan.decision` (the scan after the trade). `honesty` states that the liquidity and the price gap were created by the run itself.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `anvil did not start` | Foundry missing, or the public RPC is rate-limiting forks | Install Foundry; wait a minute and retry. |
| `could not find the balance storage slot of …` | A token with an unusual storage layout | Add the layout to `setTokenBalance` in `lib/arb-fork.js`. |
| `transaction reverted: …` | A setup step failed on the fork | Read the reason; it names the failing call. |

> **Agent Guidelines**:
> 1. Never present the fork run as a market opportunity: say the liquidity and the price gap were created by the run.
> 2. Quote profit as "before gas" and "net after gas" separately; they are different rows in the report.
> 3. The transaction hashes exist only on the local fork, so do not link them to the explorer.

