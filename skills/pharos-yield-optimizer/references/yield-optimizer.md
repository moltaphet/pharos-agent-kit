# Yield Optimizer Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. The optimizer prepares unsigned transactions.

---

## Compare and decide

### Overview

Takes a wallet and a bucket of USDC to move (idle in the wallet, a vault, or the largest one). For each other vault it measures the realised rate (share price at three blocks), simulates the deposit as the wallet, as if it had approved the vault, simulates the redemption from the source, reads the entry and exit skim from the previews, prices the gas, and works out the net gain over the holding period. The result is one MOVE or STAY PUT.

### Command Template

```bash
node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from idle
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--wallet` | address | Yes | The wallet whose USDC would move. |
| `--from` | `auto` \| `idle` \| vault id | No (default `auto`) | `idle` is USDC in the wallet; vault ids: `r25-weekly`, `r25-quarterly`, `r25-semi-yearly`, `rockaway-usdc`; `auto` is the largest USDC position. |
| `--amount` | decimal | No | USDC to move (default: all of the bucket). |
| `--min-hold-days` | integer | No (default 30) | How long you will keep it there, 1 to 365. The net gain is for this long. |
| `--min-net-gain` | number | No (default 10) | Dollars; a move below this is not worth making. |
| `--block` | integer | No | Pin to a block (at most the head minus two) to repeat a run exactly. |
| `--out` / `--json` | path / flag | No | Write or print the full run. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `✓` / `✗` per vault | Viable or not, with its yearly rate (and the two halves of the window), whether this wallet is let in, whether it can be redeemed, gas, fees and the net over the holding period. |
| `- reason` lines | Why a vault is not viable, in plain words. |
| `MOVE …` / `STAY PUT …` | The decision and its reason. A MOVE has the net gain split into extra yield, gas and fees, and a break-even in days. |
| Exit code | `0` move, `10` stay put, `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `amount is more than the … USDC this wallet has` | Asked to move more than the bucket holds | Lower the amount. |
| `from must be "auto", "idle" or one of …` | Unknown source | Use a listed id. |
| `minHoldDays must be from 1 to 365` | Out of range | Fix it. |
| `Chain MCP and the public RPC disagree on whether … succeeds` | The two sources disagree about a simulation | Retry; the move was not assessed. |
| `this wallet holds no USDC` | Nothing to move | Nothing to do. |

> **Agent Guidelines**:
> 1. Confirm the wallet, the amount and the holding period before running it.
> 2. State the decision first, then the one-line reason, then the table.
> 3. If it says STAY PUT, give the reason and do not suggest splitting the amount or changing the holding period to force a move.
> 4. Say these are recent rates, not forecasts.

---

## Read the rejections

### Overview

Each rejected vault says why. The reasons that matter: the vault refuses this wallet's deposit even with the allowance in place (the error is custom; what it carries is reported), it caps the deposit below the amount, its redemption cannot be previewed (the money could be locked), its rate was uneven, it pays no more than where the money is now, no gas was measured for it, or the net gain is below your minimum. If the source cannot be redeemed there is one reason: nothing can be moved out of it.

### Command Template

```bash
node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from r25-quarterly
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--from` | vault id | Yes | The vault whose redemption is being tested. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `custom error 0x… (it carries this wallet’s address, …)` | The refusal names this wallet, which suggests an access check; the vault does not say which. |
| `caps this wallet's deposit at …` | A positive `maxDeposit` below the amount. (A `maxDeposit` of 0 is not a cap: Morpho Vault V2 reports 0 and still accepts deposits.) |
| `will not preview a redemption … (funds may be locked)` | `previewRedeem` reverts; getting out is not assured. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `the source cannot be redeemed` | The wallet cannot redeem from the source vault | It is stuck there for now; nothing to move. |

> **Agent Guidelines**:
> 1. Never present a refusal as permanent or explain it with a guess ("whitelist", "KYC"): you know only what the error carries.
> 2. Never recommend a vault that cannot be redeemed just because it pays the most.

---

## The plan and the transactions

### Overview

A MOVE ends with the transactions to sign, in order: `redeem` on the source vault (if the money is in one), `approve` USDC to the target, `deposit` into the target. Each has its calldata, a gas limit (the gas measured on the fork plus 30%), and what was checked about it. They are unsigned. Gas comes from `reports/yield-fork-run.json`, made by really executing approve, deposit and redeem against every vault on a mainnet fork.

### Command Template

```bash
node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from idle --out plan.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--out` | path | No | The full plan as JSON: `prepared.transactions[]` with `to`, `data`, `value`, `gasLimit`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `Transactions to sign, in order` | The plan. Sign them from the wallet, in this order. |
| `checked:` | What was verified for that step at the pinned block. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| The deposit "stops only at the allowance" | A deposit simulated before the approval cannot succeed | Expected: the approval is the step before it. |

> **Agent Guidelines**:
> 1. Hand over the transactions for the user to sign; never ask for a key and never claim anything was sent.
> 2. Tell the user to run the optimizer again just before signing.
