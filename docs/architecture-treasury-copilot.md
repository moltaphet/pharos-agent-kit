# Treasury Copilot: architecture

An invoice payment desk with an AI agent at its core, live at https://pharos-agent-kit.vercel.app/treasury on Pharos Atlantic Testnet (chain 688689). It is a standalone page in the same deployment as the 30 agent demonstrations; their URLs are unchanged.

**Audience and problem.** Small teams, DAOs and freelancers who pay contributors and vendors on Pharos. Turning an invoice into a correct payment means checking the recipient, amount, token, balance, allowance and payment history across separate tools. The copilot does those checks, shows its evidence and prepares one exact transaction for the user's wallet.

## System

```
 Browser (static page, no keys)                     Server (Vercel function)                     Pharos
 ┌──────────────────────────────┐   plan / parse   ┌──────────────────────────┐    ┌──────────────────────────────┐
 │ invoice form + policy        │ ───────────────► │ api/treasury.js          │    │ Developer Docs MCP           │
 │ wallet (EIP-1193)            │                  │  intake.js   read text   │ ──►│  askQuestion: network facts  │
 │ receipt ledger (localStorage)│ ◄─────────────── │  validation  exact math  │    │  and signing procedure       │
 │                              │   plan + proof   │  agent.js    decision    │    ├──────────────────────────────┤
 │                              │                  │  tools.js    SkillEngine │ ──►│ SkillEngine (cast, pinned    │
 │                              │                  │  chain.js    simulate    │    │  block): balance, allowance, │
 │                              │                  │              verify      │    │  invoice registry            │
 └──────────────┬───────────────┘                  └────────────┬─────────────┘    ├──────────────────────────────┤
                │ eth_sendTransaction (user signs)              │ eth_call / receipts│ Atlantic RPC                 │
                └───────────────────────────────────────────────┴──────────────────►│ InvoicePaymentRouter, tUSDC  │
                                                                                    └──────────────────────────────┘
```

## The agent

The agent is a bounded workflow, not an open-ended chatbot. Every decision rests on a tool result, and every result that gates a signature is deterministic to check.

| Step | Component | What it decides |
|---|---|---|
| Intake | `lib/treasury/intake.js` | Reads pasted text into reference, recipient and amount. Missing or ambiguous fields become questions; nothing is guessed. |
| Validation | `lib/treasury/validation.js` | Exact decimal amounts, address checksum, reference shape, per-invoice cap, recipient allowlist. A failed check prepares nothing. |
| Documentation | Developer Docs MCP via `lib/treasury/agent.js` | Asks for the Atlantic chain ID, gas token and the approve/transferFrom procedure. Preparation stops unless the answer is cited and states chain 688689 and PHRS. |
| Chain state | Pharos SkillEngine via `lib/treasury/tools.js` | Runs the official Foundry read templates (`cast balance`, `cast call`) at a pinned block: native balance, tUSDC balance, allowance, `paid(payer, invoiceId)`, router token, deployed code. These reads decide between *needs approval*, *ready*, *already paid* and *blocked*. |
| Recipient | `lib/treasury/recipient.js` | Reads the recipient's code, transaction count and PHRS balance, and this wallet's earlier payments to it from the router's events. A contract or never-used address becomes an advisory and the plan requires the user's confirmation before the signing button unlocks. |
| Simulation | Atlantic RPC (`lib/treasury/chain.js`) | `eth_call` and gas estimate of the exact approval or payment, plus a fee check against the wallet's PHRS. |
| Ledger | `lib/treasury/history.js` | Reads the router's `InvoicePaid` events (Atlantic's RPC allows 1,000 blocks per `eth_getLogs`, so the newest ~28 hours are scanned in parallel chunks and the response states the covered block range). Events from another token or a malformed log are ignored. |
| Verification | `lib/treasury/chain.js` | After signing: payer, router address, calldata, native value, receipt status and the exact `InvoicePaid` event fields must match before a payment is called confirmed. |

The final simulation and receipt verification use Atlantic JSON-RPC directly and are labelled **Atlantic RPC** in the UI, never Chain MCP (the hosted Chain MCP does not serve Atlantic).

**Pharos AI tools used:** Developer Docs MCP (`https://docs.pharos.xyz/~gitbook/mcp`) and the Pharos SkillEngine (official repository, pinned to commit `a873387c9e34e9ae8e71360d43dc33329a335a24`; unmodified reference files in `skills/pharos-treasury-engine/`). The docs question is generic, so no invoice data or key is sent. Locally the SkillEngine reads run through installed `cast`; on Vercel they run in a short-lived Sandbox with a restricted network allowlist, a timeout and concurrency limits, and are stopped after the reads.

## Contracts

- `InvoicePaymentRouter`: immutable token, no balance, no owner. `payInvoice(bytes32 invoiceId, address recipient, uint256 amount)` pulls the token from the caller straight to the recipient with `transferFrom`, so it needs the payer's allowance. The invoice ID is the Keccak-256 of `pharos-treasury:v1:` plus the reference, and a reference can be paid once per payer. State is marked before the external call and rolled back if the transfer fails; a reentrancy guard and strict handling of token return data protect the transfer. Emits `InvoicePaid(payer, invoiceId, recipient, token, amount)`.
- `TreasuryDemoToken`: six-decimal **tUSDC** with a public 100-token faucet. It has no monetary value and is not Circle USDC.

Both contracts' source is verified on Sourcify (exact match for creation and runtime code; links in `config/treasury.json`). Addresses and the verified proof payment are in `config/treasury.json` and `reports/treasury-run.json`. Deployment and the proof run use `scripts/treasury-deploy.mjs`, which refuses any network other than Atlantic, caps gas spend at 0.025 PHRS and checks nine conditions (receipt, sender, exact calldata, event, balances, router holding nothing, duplicate rejection).

## Safety

- **No keys.** The agent, API and frontend never hold or request a private key. The only signer is the user's wallet. Deployment is a separate script with an ignored throwaway testnet wallet that neither the API nor the page imports.
- **User signs, exactly.** Approvals are for the exact invoice amount, never unlimited. The wallet account and chain are re-checked immediately before every signature, and any change to account, chain, invoice or policy discards the prepared plan.
- **Policy before approval.** A per-invoice cap and an optional recipient allowlist are applied before a transaction is prepared. The recipient is also inspected on chain and unusual addresses need an explicit confirmation.
- **Fail closed.** Documentation, chain-read or simulation failures stop with a reason and prepare nothing.
- **Recoverable.** The request is saved before the wallet opens. An unknown outcome is kept as unresolved and blocks another signature until it is checked; a mismatched pasted hash cannot clear it.
- **Hardened page.** `/treasury` is served with a strict Content-Security-Policy (`default-src 'self'`, no inline script or style), `frame-ancestors 'none'`, `nosniff` and `no-referrer` (see `vercel.json`).

## Setup and tests

```sh
npm ci
npm run web                      # http://localhost:3000/treasury
npm test                         # full suite, includes test/treasury.test.js (also run by CI)
forge test --offline --root contracts --match-contract TreasuryTest -vv
node scripts/treasury-deploy.mjs --check     # read-only readiness check
```

Local planning needs Foundry `cast` and network access to Atlantic and the Docs MCP. Production planning needs the Vercel Sandbox and the Foundry snapshot in `config/saga-snapshot.json`.

## Limits

This is a testnet product with a demonstration token, a single supported token and no custody. The agent does not claim unrestricted language understanding, autonomous spending or production compliance. Policy limits are checks on the user's current plan, not on-chain authority.
