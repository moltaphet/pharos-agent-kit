# Batch Executor Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. The batch is prepared unsigned.

---

## Plan a batch

### Overview

Takes at least 3 independent actions. Each is simulated on its own (`eth_call`, `estimate_gas`); the passing ones are encoded into one `aggregate3Value` call whose single payment is the sum of the values; the whole batch is simulated and costed.

### Command Template

```bash
node skills/pharos-batch-executor/scripts/batch.mjs --from <sender> --actions skills/pharos-batch-executor/examples/sync-pairs.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--from` | address | Yes | The account that would send the batch. Only the address is used. |
| `--actions` | path | Yes | JSON array of `{ "to": "0x…", "amountPros": "0.001", "data": "0x…" }` (amount and data optional). At least 3, at most 25. |
| `--on-failure` | `exclude` \| `abort` | No (default `exclude`) | What to do if an action would fail. |
| `--out` | path | No | Write the plan as JSON. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `IN` / `out` / `FAILS` | Whether each action is in the batch, left out, or would fail alone, with the reason. |
| `1 transaction instead of N` | The step reduction and the estimated gas before and after. |
| `left out <id>` | Why an action was excluded. |
| Exit code | `0` ready, `10` nothing to send, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `a batch needs at least 3 independent actions` | Too few | Add actions, or send them singly. |
| `is an ERC-20 transfer … cannot be batched through Multicall3` | Sender-dependent action (ERC-20 transfer, approval or allowance change; NFT transfers and approvals; a wrapped-token deposit or withdrawal; a vault deposit, mint, withdrawal or redemption) | Send it on its own. Never approve Multicall3. |
| `action N must be an object` / `"id" must be a short label` / `the id "x" is used twice` / `"data" must be a 0x hex string` | An action of the wrong shape, an id that is not a short plain label, or two actions with the same id | Fix the file; ids are optional (a1, a2, … are used) but must be unique. |
| `the batch would fail: Multicall3: call failed` | Every action passes alone but the batch fails | Reduce the batch or use `--on-failure abort` to investigate. |
| `Timed out` / `HTTP 429` | Chain MCP busy | Retry. |

> **Agent Guidelines**:
> 1. Confirm the actions and amounts; repeat the total value back.
> 2. Run the plan and show which actions are in, left out, or failing, and why.
> 3. Quote the measured gas comparison. If the batch costs more, say so.
> 4. Hand over the prepared transaction for the user to sign; never sign it.

---

## Read the comparison

### Overview

Step reduction is always N → 1. Gas is different: plain native transfers are already the 21,000 minimum, so batching them **costs more** (a fork run: 63,000 one by one vs 107,196 batched). Contract calls with real work save the 21,000 per-transaction base: four FaroSwap `sync()` calls saved about 22% (estimate) and 15.8% measured on a fork.

### Command Template

```bash
node skills/pharos-batch-executor/scripts/batch.mjs --from <sender> --actions skills/pharos-batch-executor/examples/native-transfers.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--from` | address | Yes | The account that would send the batch. |
| `--actions` | path | Yes | JSON list of actions; try `examples/native-transfers.json` and `examples/sync-pairs.json`. |

### Output Parsing

`saves` or `costs` with the gas amount and percent.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| Summary says `costs … gas` | The batch is more expensive than sending singly | Batch only for convenience (one signature), not to save gas. |
| `amountPros must be a decimal number of PROS` | Bad amount | Use a plain decimal with at most 18 places. |

> **Agent Guidelines**:
> 1. Recommend batching for gas only when the comparison shows a saving; otherwise offer it for convenience (one signature, one approval of the total).

---

## Failure policy

### Overview

`exclude` batches the actions that pass and **names** each one left out with its reason. `abort` prepares nothing if any action would fail. If a failing action is forced into the batch anyway, the **whole batch reverts** (`Multicall3: call failed`) and no recipient changes: nothing is half-done and no value is stranded.

### Command Template

```bash
node skills/pharos-batch-executor/scripts/batch.mjs --from <sender> --actions <file> --on-failure abort
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--on-failure` | string | No | `exclude` or `abort`. |

### Output Parsing

`left out <id>: would fail: <reason>`; under `abort`, `Aborted: <ids> would fail`.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `Aborted: aN would fail, so nothing was prepared` | Policy is `abort` and an action fails | Fix or drop the action, or use `--on-failure exclude`. |
| `the batch would fail: Multicall3: call failed` | Every action passes alone but the batch fails | Reduce the batch and re-plan. |
| `onFailure must be "exclude" or "abort"` | Unknown policy | Use one of the two. |

> **Agent Guidelines**:
> 1. Always say which action failed and what happens to the others.
> 2. Do not retry a failing action inside the batch; fix or drop it.

---

## Run on a fork

### Overview

`--fork` really executes the plan on a throwaway local fork: sends the actions one by one, reverts, sends the batch, reports **actual** gas for both, and forces the failing action into the batch to show the all-or-nothing revert.

### Command Template

```bash
node skills/pharos-batch-executor/scripts/batch.mjs --from <sender> --actions <file> --fork --out run.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--fork` | flag | Yes | Needs `anvil`. |

### Output Parsing

`one by one used … gas; the batch used … gas`, and the forced-failure line.

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `anvil did not start` | Foundry missing or RPC unreachable | Install Foundry. |

> **Agent Guidelines**:
> 1. Say it ran on a throwaway fork.
