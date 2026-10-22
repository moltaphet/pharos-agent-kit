# Dry-Run Executor Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. Only the sender's address is needed.

---

## Dry-run a transaction

### Overview

Pins one block, then runs `eth_call` (does it succeed?), `estimate_gas` (what would it use?) and reads the gas price. For ERC-20 `transfer`/`approve` and native value it also reads the balances/allowance and predicts the after-state.

### Command Template

```bash
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from <sender> --to <target> --data <0xcalldata> [--value <wei>]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--from` | address | Yes | The account that would send it. Only the address is used. |
| `--to` | address | Yes | Contract or recipient. |
| `--data` | hex | No (default `0x`) | Calldata. Build it with `cast calldata "transfer(address,uint256)" <to> <amount>`. |
| `--value` | wei | No | Native value to send, as a whole number of wei. |
| `--json` | flag | No | Full result as JSON. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `GO` / `BLOCKED` | Whether the simulation passed. |
| `revert:` line | Decoded reason: `Error("…")`, `Panic` (with meaning), a known custom error with its arguments, or "reverted without a reason". |
| `gas:` line | Units, a suggested limit (+20%), gas price, and cost in PROS. |
| `outcome:` + rows | What would change and each balance/allowance before → after. |
| Exit code | `0` GO, `10` BLOCKED, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `from must be a 0x address` | Missing or malformed `--from` | Pass the sender address. |
| `data must be 0x followed by whole bytes` | Odd-length or non-hex calldata | Re-generate with `cast calldata`. |
| `ERC20: transfer amount exceeds balance` | Sender holds too little | Reduce the amount or fund the sender. |
| `reverted without a reason` | Wrong selector, non-payable target, or a require without a message | Check the function and that value is allowed. |
| `Timed out` / `HTTP 429` | Chain MCP slow or rate limited | Retry. This is **not** a revert. |

> **Agent Guidelines**:
> 1. Ask for the sender, target and what the user wants to do; build the calldata; show it.
> 2. Run the dry run. Report GO/BLOCKED first, then the reason or the outcome, then the gas.
> 3. On BLOCKED, explain the revert in plain words and propose a fix. Do not suggest sending anyway.
> 4. Remind the user the simulation reflects the chain now.

---

## Read the result

### Overview

The result answers three questions: would it work, what would it cost, what would change.

### Command Template

```bash
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from <sender> --to <token> --data <transfer-calldata> --json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--json` | flag | Yes | `verdict`, `prediction`, `revert{kind,name,message}`, `gas{units,suggestedLimit,costPros}`, `outcome{kind,summary,rows[]}`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `outcome.kind` | `erc20-transfer`, `erc20-approve`, `native-transfer`, or `unknown` (no diff predictable from calldata; use a fork). |
| `outcome.rows[]` | `{ label, before, after }`; after reads "unchanged (it would revert)" when blocked. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `outcome.kind` is `unknown` | The call is not a plain transfer, approval or native value | Say a state diff cannot be predicted from the call data; offer a fork run. |
| `gas` is `null` | The call would revert, so there is nothing to estimate | Read the decoded `revert` instead. |
| `revert.kind` is `empty` | The call reverted without a reason | Check the selector, that the target is payable if you sent value, and the arguments. |

> **Agent Guidelines**:
> 1. For `unknown` outcomes, say plainly that the state change cannot be predicted from the call data, and offer a fork run.

---

## Guarded execution

### Overview

`guardedExecute` is the only path to an executor. It dry-runs first; if the simulation fails it returns `blocked: true` and **never calls `send`**. This skill ships no live signer, so without `--fork` a passing result means "hand it to your own signer".

### Command Template

```bash
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from <sender> --to <target> --data <calldata> --execute
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--execute` | flag | Yes | Run the gate. Without `--fork` no transaction can be sent. |

### Output Parsing

`EXECUTION BLOCKED: nothing was sent.` or, with `--fork`, `EXECUTED on the local fork: <hash>`.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `no executor` | `--execute` without `--fork` | Expected: use your own signer for a real send. |

> **Agent Guidelines**:
> 1. Never bypass the gate, and never describe a blocked run as sent.

---

## Run on a fork

### Overview

`--fork` starts a local anvil fork of Pharos mainnet, impersonates the sender there, and, after a passing simulation, **really executes** the transaction on the fork. It then reports the **actual** state change of the watched tokens, so you can compare it with the prediction. Nothing touches the real chain.

### Command Template

```bash
node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from <sender> --to <token> --data <calldata> --fork --execute --watch <token>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--fork` | flag | Yes | Needs Foundry's `anvil`. |
| `--watch` | addresses | No | Comma-separated token addresses whose sender balance is diffed before/after. |

### Output Parsing

`fork state diff <token>: before → after (change)` is the real change.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `anvil did not start` | Foundry missing or the fork RPC unreachable | Install Foundry; retry. |

> **Agent Guidelines**:
> 1. State clearly that this ran on a throwaway fork.
> 2. Compare the fork diff with the prediction; report any difference.
