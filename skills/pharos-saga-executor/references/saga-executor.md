# Saga Executor Operation Instructions

> Network Configuration: RPC and chain ID are read from `assets/networks.json` (use `mainnet` as the fork source).
> Private Key: not used. The fork runner signs with anvil's local dev accounts only.

---

## Run a saga on a fork

### Overview

Starts a fresh anvil fork of Pharos mainnet for each scenario, funds a test account with USDC (by impersonating a USDC holder, on the fork only), and runs the vault saga: **approve** USDC to the vault, **deposit** into the real RockawayX USDC vault, **transfer** the shares to a treasury. Scenario `success` also injects one transient fault to show the retry policy; scenario `failure` sends the shares to the zero address so step 3 fails for good and the saga must undo steps 2 and 1. Three more scenarios exist for demos: `plain` (nothing injected), `retry` (the deposit is dropped twice, then lands) and `stuck` (step 3 reverts, and the undo of the deposit is blocked by an injected "vault paused"). With `--stream` the script prints one JSON object per line as the run happens, which is how the website's live demo reads it from a Vercel Sandbox.

### Command Template

```bash
node skills/pharos-saga-executor/scripts/saga.mjs [--scenario success|failure|both|plain|retry|stuck] [--max-attempts 1..5] [--out run.json] [--stream]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--scenario` | string | No (default `both`) | `both` (success then failure, the recorded pair), `success`, `failure`, `plain`, `retry` or `stuck`. |
| `--max-attempts` | integer | No (default 3) | Retry policy limit, 1 to 5. |
| `--stream` | flag | No | Print JSON lines (`phase`, `event`, `result`, `error`) while the run happens. |
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
| `failed to parse block hash or number` while forking | The newest Foundry (1.8.x) sends a block parameter the Pharos RPC rejects | Use Foundry 1.4.0: `foundryup --install v1.4.0`. |
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
| `step:retry` | A transient error; waiting `waitMs` (exponential backoff) before trying again. If the transaction had already been sent, the `why` says it is asked about again, not sent twice; only a transaction the network lost (dropped, replaced, underpriced) is sent again. |
| `step:failed` | Permanent failure (revert or failed state check), with the reason. |
| `compensation:*` | Undoing steps, newest first. A step that executed but failed its check (`step:failed` with `mined: true`) is undone too, because its effect is on chain; a step that reverted changed nothing. |
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
> 1. Always write the compensation together with the step: it is used both for steps that were confirmed and for one that executed but failed its post-condition.
> 2. Write `verify` against chain state (balances, allowances), not just the receipt.

---

## Run the vault saga on Atlantic

### Overview

This is the on-chain proof, and it is different from the fork run in exactly one way that matters: its transaction hashes exist on a public explorer. The runner deploys TestUSDC and TestVault on Pharos Atlantic Testnet (chain 688689), mints 1,000 test USDC to the throwaway wallet, then runs the same vault saga twice with the same engine, step order, state checks and compensations as the fork run: a full success (approve → deposit → transfer to a treasury) and a forced failure (approve → deposit → transfer to the zero address, which reverts on chain, then redeem → revoke approval). There are no injected faults in this run. The report is the evidence: `reports/testnet-vault-saga.json`, with the token and vault addresses, both scenarios' state logs, their final checks, and every transaction hash, each openable at `https://atlantic.pharosscan.xyz/tx/<hash>`.

Why test contracts, and why this does not weaken the proof: the mainnet vault the fork uses (RockawayX USDC) does not exist on Atlantic, so there is no mainnet address to reuse. TestVault is a 1:1 deposit/redeem vault with ERC-20 shares, so the amounts a reviewer checks are exact (100 USDC in, 100 shares out, 100 USDC back on redeem), with no share price to dispute. What is being proved is the saga — dependent steps, receipt plus state verification, no retry of a revert, compensation in reverse order — not the vault's yield.

### Command Template

```bash
node scripts/testnet-vault-saga.mjs [--scenario both|success|failure] [--out reports/testnet-vault-saga.json]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--scenario` | string | No (default `both`) | `both` (success then failure), `success` or `failure` alone. |
| `--out` | path | No (default `reports/testnet-vault-saga.json`) | Where the full run report is written. |

### Prerequisites

- A throwaway Atlantic wallet at `.wallet/atlantic-testnet.json` (git-ignored, test tokens only), funded with a little PHRS from the testnet faucet. The signer refuses any chain but 688689 and stops over a 0.05 PHRS budget.
- Foundry: `cast` for sending, `forge` for building TestUSDC and TestVault on demand.
- Never use a real key, and never point this runner at mainnet: the signer and the test contracts both exist to make that impossible by construction, not by care.

### Output Parsing

| Field | Description |
|-------|-------------|
| `scenarios[].status` | `completed` (success) or `compensated` (failure, then fully undone). Anything else means the run did not prove what it claims. |
| `scenarios[].finalCheck.clean` | `true` only if the end state matches the outcome: success leaves the shares with the treasury and the USDC spent; failure leaves shares 0, allowance 0, treasury shares 0, USDC spent 0. |
| `scenarios[].transactions[].tag` | The step each hash belongs to, in order. Failure must read `approve > deposit > transfer to zero address (forced failure) > redeem > revoke approval`. |
| `transactions[]` | Every transaction the run sent, including the two deploys and the mint, with the wallet as `from`. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `cannot read the Atlantic testnet wallet` | `.wallet/atlantic-testnet.json` is missing | Create a throwaway wallet there and fund it from the faucet; do not reuse a real wallet. |
| `refusing to send: this is not Pharos Atlantic testnet` | The RPC is not chain 688689 | Stop. Do not override the guard; fix the RPC URL. |
| `stopping: spent …, over the … budget` | Gas cost exceeded the budget guard | Stop and check the gas price; do not raise the budget without saying why. |
| `estimate failed … using the … fallback` | A transaction cannot be estimated — expected for the forced failure, which is meant to revert | Nothing to fix, as long as the transaction then reverts on chain and the compensation runs. |

> **Agent Guidelines**:
> 1. Rehearse on the fork first, then run Atlantic.
> 2. Never present a fork hash as on-chain proof, and never present the earlier Ledger run (`reports/testnet-saga.json`, credit/debit only) as the vault saga: it proves the engine's retry and undo rules, not approve → deposit → transfer.
> 3. Check every hash in the report on the explorer before resubmitting.

---

## Going live

### Overview

Mainnet live execution is not shipped in this version, deliberately. Live execution needs a funded wallet that only the user controls, and the hosted Chain MCP server is read-only. The engine takes an `exec` object (`send`, `receipt`), so a live signer can be plugged in by the user. The Atlantic runner above is the testnet exception to this rule, not a mainnet path: it only ever uses a throwaway testnet wallet, only on chain 688689.

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
