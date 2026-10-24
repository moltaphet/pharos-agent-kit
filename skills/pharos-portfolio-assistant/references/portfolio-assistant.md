# Portfolio Assistant Operation Instructions

> Network Configuration: RPC, MCP and chain ID come from `assets/networks.json` (use `mainnet`).
> Private Key: not used. The assistant only reads.

---

## Ask about a wallet

### Overview

Takes a wallet address and one question. It reads the wallet in two Multicall3 batches at one block (native PROS, USDC and WPROS balances, shares and decimals in each vault, the USD price feeds, then what each held vault position is worth and whether it can be redeemed), classifies the question into one of eight types by its words, and answers in a sentence with the figures behind it.

### Command Template

```bash
node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "Where is my USDC?"
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--wallet` | address | Yes | The wallet to read. |
| `--question` | text | Yes | One of: total balance · what do I hold · where is my USDC · how much is my WPROS worth · biggest position · how much in R25 Quarterly (or Weekly, Semi-yearly, Rockaway) · which protocols am I using · what am I earning. At most 300 characters. |
| `--block` | integer | No | Read at this block (at most the head minus two). Default: the head minus two. |
| `--out` | path | No | Write the full run (positions, figures, sources, steps) as JSON. |
| `--json` | flag | No | Also print the full run. |

### Output Parsing

| Field | Description |
|-------|-------------|
| First paragraph | The answer in a sentence. |
| `Figures` | Each number, with `[source n]`. |
| `Sources` | `[n] contract · call · block (tool; confirmation)`. `confirmed on the public RPC` means the same batch was repeated there and matched. `NOT confirmed` means the public RPC could not answer. |
| `Note:` | Caveats: old prices, restricted vaults, anything unreadable. |
| Exit code | `0` answered, `10` the question is outside what it can answer (it says what it can), `1` error. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `wallet must be a 0x address` | Not a 40-hex-character address | Fix the address. |
| `I do not know how to answer that` | Not one of the eight question types | Ask one of the listed questions. |
| `I do not read Aave positions` | A protocol outside the registry | Nothing to do: it will not guess. |
| `Chain MCP and the public RPC disagree` | A backend returned inconsistent state and re-reading did not settle it | Retry; no figure was reported. |
| `Timed out` / `HTTP 429` | A server is busy | Retry. |

> **Agent Guidelines**:
> 1. Repeat the question and the wallet back before running it.
> 2. Give the sentence, then the sources for the numbers the user will act on.
> 3. Pass on every `Note:`; never drop a caveat about restricted vaults, old prices or an unreadable position.
> 4. If it says it cannot answer, say that. Do not fill the gap with an estimate.

---

## Earnings

### Overview

"What am I earning?" is answered from what each vault actually paid: its share price is read at three blocks over about four days (the start, the middle and the end of the window), annualised, and compared across the two halves. The amount held turns that into dollars a day. USDC idle in the wallet is said to earn nothing. These are rates from the past, not forecasts, and each vault's fees are already inside its share price.

### Command Template

```bash
node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "What am I earning?"
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--question` | text | Yes | Any earning, yield, APY or interest question. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `about N% a year, roughly $X a day` | The vault's measured rate and the dollars it implies for this position. |
| `(uneven: …)` | The two halves of the window differ a lot, so the rate is a poor guide. |
| `sitting in the wallet earns nothing` | Idle USDC. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `I cannot tell what you have earned so far` | The question asks for earnings since depositing | That needs deposit history, which the assistant does not read; ask "what am I earning?" instead. |
| `I could not measure its yield` | A share price could not be read at one of the three blocks | Retry, or pick a later block. |

> **Agent Guidelines**:
> 1. Always say these are what the vault paid, not what it will pay.
> 2. Do not turn a daily figure into a promise of a yearly one without saying "if the recent rate held".

---

## Sources and confirmation

### Overview

Each figure carries `[n]`, a source with the contract, the exact call, the block, and how it was read. Each batch of reads goes to Chain MCP and is then repeated on the public RPC. If the two answers differ, Chain MCP is asked again and the two that agree win; if nothing settles it, no figure is reported. If the public RPC cannot answer, the figures stand and are marked `NOT confirmed`.

### Command Template

```bash
node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "What do I hold?" --out run.json
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--out` | path | No | The run as JSON: `answer.sources[]` (contract, call, block, tool, integrity, explorer link), `steps[]`, `integrity`. |

### Output Parsing

| Field | Description |
|-------|-------------|
| `integrity` | `confirmed` (the public RPC matched), `resolved` (a second read settled a disagreement), `inconclusive` (the RPC could not answer). |
| `steps[]` | Every Chain MCP and public RPC call in order. |

### Error Handling

| Error Signature | Cause | Suggested Action |
|----------------|-------|----|
| `read-resolved` step | A backend answered differently the first time | Nothing: the disagreeing answer was discarded. |

> **Agent Guidelines**:
> 1. When asked "where did this come from", answer from `sources`, naming the contract and the block.
> 2. If any source is `inconclusive`, tell the user the figure was not independently confirmed.
