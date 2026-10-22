# Threshold Guardian Operation Instructions

> Network Configuration: RPC, MCP and chain ID are read from `assets/networks.json` (use `mainnet`).
> Private Key: not used. This skill is read-only.

---

## Evaluate a guardian

### Overview

Reads every condition in a config at **one pinned block**, compares each with its threshold, applies the rule (`all`, `any` or `atLeast`), and prints a decision trace ending in `DECISION  FIRE` or `DECISION  HOLD`.

### Command Template

```bash
node skills/pharos-threshold-guardian/scripts/guardian.mjs <config.json> [--json]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.json` | path | Yes | A guardian config (see *Write a guardian config*). Examples: `examples/fires.json`, `examples/holds.json`. |
| `--json` | flag | No | Print the full result as JSON instead of the text trace. |

### Output Parsing

| Field | Description |
|-------|-------------|
| Exit code | `0` = FIRE, `10` = HOLD, `1` = error (bad config or network failure). Branch on it. |
| `PASS` / `FAIL` / `ERROR` line | One per condition: value read, operator, threshold, and whether it is met. `ERROR` means it could not be read and counts as not met. |
| `RULE` line | How many conditions were met and how many the rule needs. |
| `DECISION` line | `FIRE: <action>` or `HOLD: n more conditions needed`. |
| `block` (header / JSON) | The block every condition was read at. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `config.conditions must list at least one condition` | Empty or missing `conditions` | Add conditions; a guardian needs at least 3 independent ones. |
| `a guardian needs at least 3 independent conditions` | Fewer than 3 conditions | Add more, or set `"allowFewConditions": true` only if the user insists. |
| `unknown type "…"` | Condition `type` not supported | Use `gas-price`, `native-balance`, `token-balance` or `share-price-change`. |
| `threshold must be a number` | Threshold given as a string | Use a bare number, in the condition's unit. |
| `"token" must be a 0x address` | Missing or malformed address | Use a 42-character `0x…` address. |
| `ERROR` on one condition | The vault/token did not answer the call | Check the address is the right contract on mainnet; the guardian holds meanwhile. |
| `HTTP 429` / `503` retry notes | Chain MCP is rate limiting or at capacity | Wait; the script retries with the server's `Retry-After`. |

> **Agent Guidelines**:
> 1. Confirm which config to use; if the user described conditions in words, write the config first (next section) and show it.
> 2. Run the command from the repository root.
> 3. Read the exit code and the trace. Report the decision, the block, and each condition's value against its threshold.
> 4. On HOLD, name the conditions that failed. Do not change thresholds to force a FIRE.
> 5. On FIRE, say what would fire and **ask** before doing anything; this skill never acts.

---

## Write a guardian config

### Overview

A config lists the action, the rule, and the conditions. Everything that decides the outcome (types, operators, thresholds, addresses, block window) is in the file; nothing is hard-coded in the script.

### Command Template

```json
{
  "name": "rebalance-gate",
  "action": "prepare the vault rebalance",
  "require": "all",
  "conditions": [
    { "id": "gas-is-cheap", "type": "gas-price", "op": "<=", "threshold": 20 },
    { "id": "venue-has-liquidity", "type": "token-balance", "token": "0xc879c018db60520f4355c26ed1a6d572cdac1815", "holder": "0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb", "op": ">=", "threshold": 100000 },
    { "id": "vault-moved", "type": "share-price-change", "vault": "0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268", "blockWindow": 1500000, "op": ">=", "threshold": 0.1 }
  ]
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Label shown in the output. |
| `action` | string | No | What would fire; shown in the decision line. Never executed. |
| `require` | `"all"` \| `"any"` \| `{ "atLeast": n }` | No (default `all`) | How many conditions must be met. |
| `conditions[].id` | string | No | Name in the trace (defaults to `type-n`). Must be unique. |
| `conditions[].type` | string | Yes | `gas-price` (gwei), `native-balance` (PROS; needs `address`), `token-balance` (token units; needs `token`, `holder`), `share-price-change` (percent over `blockWindow`; needs `vault`). |
| `conditions[].op` | string | Yes | One of `>=` `>` `<=` `<` `==`. |
| `conditions[].threshold` | number | Yes | In the condition's unit. |
| `conditions[].blockWindow` | integer | No | For `share-price-change`: blocks to look back (default 100000; a block is about 1 second). |

### Output Parsing

The config itself has no output. Validate it by running *Evaluate a guardian*; the script rejects a bad config with a precise message.

### Error Handling

See *Evaluate a guardian*.

> **Agent Guidelines**:
> 1. Translate the user's words into conditions, and repeat them back with units ("gas at most 20 gwei").
> 2. Use real addresses from the Pharos registries; do not invent them.
> 3. Keep at least 3 independent conditions.
> 4. Save the config next to the user's other files and run it.

---

## Read the decision trace

### Overview

The trace is the explanation. Each condition is one line; the last two lines are the rule and the decision.

### Command Template

```bash
node skills/pharos-threshold-guardian/scripts/guardian.mjs <config.json> --json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--json` | flag | Yes | Machine-readable result: `decision`, `passed`, `total`, `block`, `results[]` (`id`, `value`, `unit`, `op`, `threshold`, `pass`, `error`), `trace[]`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `results[].pass` | Whether this condition was met. |
| `results[].value` | The value read, in `results[].unit`. `null` when it could not be read. |
| `decision` | `fire` or `hold`. |

### Error Handling

See *Evaluate a guardian*.

> **Agent Guidelines**:
> 1. Explain a HOLD in plain words: "gas is 10 gwei, you wanted at most 1".
> 2. Offer to change the threshold only if the user asks.

---

## Check one condition by hand

### Overview

Equivalent `cast` commands, for an agent that only has Foundry. Use them to double-check a single value; they do not replace the guardian.

### Command Template

```bash
# gas price (wei)
cast gas-price --rpc-url https://rpc.pharos.xyz

# ERC-20 balance of a holder (raw units; divide by 10^decimals)
cast call <token> "balanceOf(address)(uint256)" <holder> --rpc-url https://rpc.pharos.xyz

# ERC-4626 share price now and N blocks ago (compare the two)
cast call <vault> "convertToAssets(uint256)(uint256)" 1000000 --rpc-url https://rpc.pharos.xyz
cast call <vault> "convertToAssets(uint256)(uint256)" 1000000 --rpc-url https://rpc.pharos.xyz --block <head-N>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `<token>`, `<vault>`, `<holder>` | address | Yes | `0x…` addresses on Pharos mainnet. |
| `1000000` | uint | Yes | One share unit (`10^decimals` of the vault; 6 decimals here). |
| `<head-N>` | integer | Yes | Latest block minus the look-back window (`cast block-number`). |

### Output Parsing

| Field | Description |
|-------|-------------|
| `cast gas-price` | Wei. `10000000000` = 10 gwei. |
| `balanceOf` | Raw integer; divide by `10^decimals`. |
| `convertToAssets` pair | `now / then - 1` is the share-price change. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| Empty / `0x` result | Contract does not implement the function | Check the address and that it is on mainnet. |
| `connection refused` | `--rpc-url` missing | Always pass `--rpc-url`. |

> **Agent Guidelines**:
> 1. Use these only to cross-check a guardian value.
> 2. Pass `--rpc-url` every time; Foundry does not default to Pharos.
