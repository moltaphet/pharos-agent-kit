# Multi-Protocol Aggregator: architecture

One interface over several Pharos protocols. A user asks a question ("what do I earn, where is my money?") or gives an instruction ("put 2,500 USDC to work", "take 1,000 out"); the aggregator reads every protocol, chooses a venue, says why, and returns unsigned transactions. It holds no key and sends nothing.

## The shape

```
            request: query | deposit | withdraw        (CLI, web page, API)
                              │
                       ┌──────▼───────┐
                       │   snapshot   │  reads every venue in parallel, each on its own
                       └──┬─────┬──┬──┘
        ┌─────────────────┘     │  └─────────────────┐
┌───────▼────────┐   ┌──────────▼─────────┐   ┌──────▼──────────────┐
│ adapter:       │   │ adapter:           │   │ adapter:            │
│ erc4626        │   │ erc4626            │   │ morpho-market       │
│ R25 ×3 vaults  │   │ RockawayX (Morpho  │   │ Morpho Blue         │
│                │   │ Vault V2)          │   │ syzUSD/USDC supply  │
└───────┬────────┘   └──────────┬─────────┘   └──────┬──────────────┘
        └───────────────────────┴──────┬─────────────┘
                                       │ per venue: { status, rates, position, probe } or { status: unavailable, error }
                              ┌────────▼────────┐
                              │      route      │  picks the venue, lists every venue with the reason it was or was not chosen
                              └────────┬────────┘
                              ┌────────▼────────┐
                              │     prepare     │  unsigned transactions (approve + deposit / withdraw) + a simulation of the last one
                              └─────────────────┘
```

## The venue interface

An adapter is three functions and a list of calls. Nothing else in the system knows what a vault or a market is.

| | what it gives | ERC-4626 vault | Morpho Blue market |
|---|---|---|---|
| `rates` | return (APY), value locked, free liquidity | share price now against two days ago, annualised | the interest-rate model's borrow rate × utilisation × (1 − fee) |
| `position` | the wallet's assets and what it can withdraw | `balanceOf` × share price | `position()` shares × (assets + 1) / (shares + 10⁶) |
| `probe` | what the venue says to this exact request | the deposit or withdrawal simulated from the wallet | the same |
| `prepare` | the unsigned transactions | `approve`, `deposit(assets, receiver)` / `withdraw(assets, receiver, owner)` | `approve`, `supply(marketParams, assets, 0, onBehalf, "")` / `withdraw(marketParams, assets, 0, onBehalf, receiver)` |

To add a protocol, write an adapter (for example an AMM LP position or another lending market) and add its venues to `VENUES`. The router, the outage handling and the exports do not change.

## Routing

* **Deposit:** among the venues whose own simulation accepts the deposit from this wallet, the one with the best measured return. Every other venue is listed with its reason: refused by the venue (the R25 vaults are permissioned), return could not be measured, unavailable.
* **Withdraw:** among the venues where the wallet has money that can be paid out now, the one that earns the least, so the money left behind keeps the higher returns. A market can only pay out what is not lent, so its free liquidity limits it. If no single venue can pay the amount, it is split from the lowest return up; if the wallet does not hold the amount, the answer says how much it does hold.
* The venue's own answer to the exact request (the **probe**) decides eligibility, not a guess from `maxDeposit`/`maxWithdraw`: Morpho Vault V2 reports zero for both by design, and the R25 vaults refuse some wallets with no message.

## One protocol down

Each venue is read inside its own `try`, with its own timeout, against its own endpoint. A venue that fails comes back as `{ status: "unavailable", error }`, is shown in the answer and is left out of the choice; the answer says which protocols could not be read and that the choice is among the others. If every venue is down the answer is "no venue can take this right now", not an error. The demo makes an outage by pointing a protocol's reads at an unreachable endpoint (a real connection failure); a real outage takes the same path.

## Reading the chain safely

* All reads go to the public RPC in JSON-RPC batches (`lib/rpc-batch.js`), pinned to one block three behind the head.
* The RPC is load-balanced, and a node now and then answers a block-pinned read from other state (one such answer was seen while building: the same venue's return came out 5.46% in one request and 5.88% in the next at the same block). Every venue's reads are therefore made twice and must agree; a third read breaks a tie; a venue whose reads never agree is reported as unavailable.
* Rates are measured, not quoted: a vault's return is its share price over two days; a market's is computed from its rate model at that block.

## What it does not do

It never signs and never sends; there is no key anywhere in it. The transactions it returns are for the user's wallet. Returns are measured over two days and are a guide, not a promise. The R25 vaults accept only some wallets and the aggregator finds that out from the venue instead of assuming.
