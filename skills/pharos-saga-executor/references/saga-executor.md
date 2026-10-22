# Saga Executor Operation Instructions

> Network Configuration: RPC and chain ID are read from `assets/networks.json` (use `mainnet` as the fork source).
> Private Key: not used. The fork runner signs with anvil's local dev accounts only.

---

## Run a saga on a fork

### Overview

Starts a fresh anvil fork of Pharos mainnet for each scenario, funds a test account with USDC (by impersonating a USDC holder, on the fork only), and runs the vault saga: **approve** USDC to the vault, **deposit** into the real RockawayX USDC vault, **transfer** the shares to a treasury. Scenario `success` also injects one transient fault to show the retry policy; scenario `failure` sends the shares to the zero address so step 3 fails for good and the saga must undo steps 2 and 1.

### Command Template

```bash
node skills/pharos-saga-executor/scripts/saga.mjs [--scenario success|failure|both] [--out run.json]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--scenario` | string | No (default `both`) | `success`, `failure`, or `both`. |
| `--out` | path | No | Write the full run record (state log, steps, final check) as JSON. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `=== <name> → STATUS ===` | `COMPLETED`, `COMPENSATED` (failed, then fully undone) or `COMPENSATION-FAILED` (stuck). |
| State log lines | `t ms`, event, step, attempt, tx hash (see *Read the state log*). |
| `final state` / `expected` | Balances and allowance at the end, and whether they match what the outcome requires. |
| Exit code | `0` if every scenario ended as expected, `1` otherwise. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `anvil did not start` | Foundry is not installed or the fork RPC is unreachable | Install Foundry; check `https://rpc.pharos.xyz`. |
| `command not found: anvil` | Foundry missing | Run `foundryup`. |
| `execution reverted: ZeroAddress` | The forced failure in scenario `failure` (expected) | Nothing to fix; this is the demo. |
| `HTTP 429` from the RPC | Fork source is rate limiting | Wait and re-run. |
| `transaction reverted: out of gas (used N of a N limit)` | The gas limit was too tight. A vault withdrawal calls into a lending market and needs more gas than `eth_estimateGas` reports | The harness already adds 30% headroom to every estimate; for your own transactions do the same. |

> **Agent Guidelines**:
> 1. Confirm the user understands this runs on a local fork and moves no real funds.
> 2. Run both scenarios and show the state log of each.
> 3. Read the final check: say whether the account ended where the outcome requires.
> 4. Explain any rounding (the vault can differ by 1 unit, 0.000001 USDC).
> 5. Add headroom (about 30%) to any gas estimate before sending. An exactly-estimated limit made this vault's redeem run out of gas with no revert reason, although the same call succeeds with `eth_call`.
> 6. A revert with no reason that used its whole gas limit is an out-of-gas, not a logic error: raise the limit, do not retry the same limit.

---

## Read the state log

### Overview

Every transition is logged with a timestamp, so you can say exactly where the saga was at any moment.

### Command Template

```bash
node skills/pharos-saga-executor/scripts/saga.mjs --scenario failure --out run.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--out` | path | Yes (for JSON) | `run.json` holds `log[]`, `steps[]`, `failure`, `finalCheck`. |

### Output Parsing

| Event | Meaning |
|-------|---------|
| `step:start` / `step:attempt` / `step:sent` | A step began; an attempt was made; the transaction was submitted. |
| `step:confirmed` | Receipt is `success` **and** the step's state check passed. |
| `step:retry` | A transient error; waiting `waitMs` (exponential backoff) before trying again. |
| `step:failed` | Permanent failure (revert or failed state check), with the reason. |
| `compensation:*` | Undoing confirmed steps, newest first. |
| `saga:completed` / `saga:compensated` / `saga:stuck` | The final outcome. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `saga:stuck` in the log | An undo failed, so some steps were not reversed | Read `stuck[]`, list the stranded steps first, and ask the user. Never report "rolled back". |
| `compensation:failed` on a step | The undo reverted or its state check failed | Read the error on that line; investigate before retrying. |
| `EACCES` / `ENOENT` for `--out` | The output path is not writable | Choose another path. |

> **Agent Guidelines**:
> 1. Summarise as a timeline: which step, what happened, what was undone.
> 2. For `saga:stuck`, list the stranded steps first and ask the user what to do.

---

## Retry policy

### Overview

`maxAttempts` (default 3) with exponential backoff starting at 400 ms, capped at 4 s. **Transient** errors are retried: `nonce too low`, `replacement transaction underpriced`, `gas price too low`, timeouts, dropped transactions, `429`/`503`. **Permanent** errors are never retried: reverts and failed state checks.

### Command Template

```js
const result = await runSaga({ name, steps, exec, policy: { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 8000 } });
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `maxAttempts` | integer | No | Attempts per transaction, including the first. |
| `baseDelayMs` | integer | No | First backoff; doubles each retry. |
| `maxDelayMs` | integer | No | Backoff ceiling. |

### Output Parsing

`steps[].attempts` shows how many tries each step needed.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `retries exhausted` | Still failing after `maxAttempts` | The saga compensates; investigate the network or fee settings. |

> **Agent Guidelines**:
> 1. Do not raise `maxAttempts` to push through a revert.
> 2. For a gas spike, retry with a higher fee only with the user's approval.

---

## Define a saga

### Overview

A saga is a list of steps. Each has a transaction, an optional state check (`verify`), and a `compensate` that undoes it. See `lib/saga-scenario.js` for the vault example.

### Command Template

```js
{
  id: 'deposit',
  title: 'Deposit 100 USDC into the vault',
  tx: () => ({ from, to: vault, data: calldata }),
  verify: async (receipt) => (await sharesOf(from)) > 0n || 'no shares were issued',
  compensate: { title: 'Redeem the shares', tx: () => ({ from, to: vault, data: redeemCalldata }) },
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tx()` | function | Yes | Returns `{ from, to, data, value? }`; evaluated at send time so it can use earlier results. |
| `verify(receipt)` | function | No | Return `true`, or a string explaining what is wrong. |
| `compensate` | object | No | If missing, the step is reported as `not-undoable`. |

### Output Parsing

`steps[].state`: `confirmed`, `failed`, `compensated`, `compensation-failed`, `not-undoable`.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `not-undoable` | A step has no compensation | Add one, or make the step the last in the saga. |

> **Agent Guidelines**:
> 1. Always write the compensation together with the step.
> 2. Write `verify` against chain state (balances, allowances), not just the receipt.

---

## Going live

### Overview

Not shipped in this version, deliberately. Live execution needs a funded wallet that only the user controls, and the hosted Chain MCP server is read-only. The engine takes an `exec` object (`send`, `receipt`), so a live signer can be plugged in by the user.

### Command Template

```text
Run the Write Operation Pre-checks from SKILL.md, then ask the user to approve the exact amounts.
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Key | n/a | n/a | Set by the user in their own shell; never typed into chat or stored in files. |

### Output Parsing

Same state log as the fork.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `insufficient funds` | Not enough PROS for gas | Ask the user to top up; do not continue. |

> **Agent Guidelines**:
> 1. Rehearse on the fork first.
> 2. Never proceed without explicit approval of amounts and addresses.
