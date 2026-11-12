# Treasury Copilot

A separate payment workspace at `/treasury` for teams and freelancers who need to turn an invoice into a checked payment and a verifiable receipt. It shares the existing site's deployment and visual tokens; the 30 agent demonstrations keep their current URLs.

## Current status

The page, API, contracts and deployment script are implemented. The contracts are deployed on Atlantic (token `0x83f0e9a24160e91b670029f6c65f3734bb434503`, router `0x5b95c09b2a2bf9e7ee3662dbf76d9db442844d4e`) and one exact demo payment was verified on-chain (`reports/treasury-run.json`, 9 checks). The planning endpoint was exercised live against Docs MCP and SkillEngine reads: valid invoice, duplicate invoice and over-limit invoice. The public release and the capstone video remain outstanding.

## User flow

Connect an Ethereum-compatible wallet, switch to Atlantic, obtain testnet PHRS for gas, and mint free demonstration tUSDC. Enter an invoice reference, recipient and amount; optionally set a per-invoice limit and recipient allowlist. The agent checks the invoice and policy, consults Pharos documentation, reads live wallet/router state, and prepares either an exact-amount token approval or the invoice payment. The user's wallet signs each step. After approval the invoice is reviewed again; after payment the receipt must match the exact invoice event.

`tUSDC` is a custom demonstration currency with no monetary value. It is not Circle USDC. Only this token is supported by this first-release router.

## Components

| Component | Responsibility |
|---|---|
| `public/treasury.html`, `public/css/treasury.css` | Accessible standalone payment workspace using existing site tokens. |
| `public/js/treasury/main.js` | Invoice review, policy controls, clear errors, signing and recovery. |
| `public/js/treasury/wallet.js` | EIP-1193 wallet access; verifies account/network before signature. |
| `public/js/treasury/storage.js` | Saves intent before signature, then hash/outcome; unresolved and mismatched requests block another signature. |
| `api/treasury.js` | Public configuration, unsigned planning, receipt verification and recorded proof. |
| `lib/treasury/validation.js` | Exact decimal conversion, checksum/reference validation, deterministic policy checks and calldata encoding. |
| `lib/treasury/agent.js` | Composes documentation and SkillEngine reads into a decision; prepares but never sends. |
| `lib/treasury/tools.js` | Executes the pinned official SkillEngine's public Foundry query templates. |
| `lib/treasury/chain.js` | Simulation, gas estimation and exact receipt/event verification on Atlantic RPC. |
| `contracts/InvoicePaymentRouter.sol` | Transfers the fixed token directly from payer to recipient and prevents duplicate references per payer. |
| `contracts/TreasuryDemoToken.sol` | Six-decimal demo token with a public 100-token faucet. |

## Pharos AI tools

**Developer Docs MCP** (`https://docs.pharos.xyz/~gitbook/mcp`) receives a generic network/payment-procedure question through `askQuestion`. No invoice or private key is sent. The agent requires cited Atlantic facts, including chain 688689 and PHRS gas, before offering a signature. Missing or unsupported documentation stops preparation.

**Pharos SkillEngine** is a skill/Foundry toolkit, not an MCP server or a hosted inference endpoint. The runtime executes its actual `cast balance` and `cast call` templates on Atlantic, with a pinned block, and uses their balances, allowance and invoice state to decide whether the payment is possible. Official source is pinned to commit `a873387c9e34e9ae8e71360d43dc33329a335a24`; unmodified skill/query/network references are in `skills/pharos-treasury-engine/`. Additional native Foundry reads check code and chain identity. Local runs require installed `cast`; Vercel runs use a short-lived Foundry-equipped Sandbox based on the existing project snapshot. Sandboxes have a restricted Atlantic network allowlist, timeout and concurrency/hourly checks and are stopped after the reads.

The final simulation and receipt verifier use Atlantic JSON-RPC directly and are labelled **Atlantic RPC**, not Chain MCP. Live execution of these two official tools still needs verification before submission.

The agent is a bounded workflow: it uses AI-backed documentation with deterministic invoice/policy checks and on-chain state. It does not claim unrestricted chat understanding, autonomous spending or production compliance.

## Contracts and safety

Network: Atlantic Testnet, chain ID 688689. RPC: `https://atlantic.dplabs-internal.com`. Contracts are listed in `config/treasury.json` after deployment.

The router has an immutable token and no treasury balance or delegated signer. `payInvoice(bytes32,address,uint256)` requires caller allowance; the token moves directly to the recipient. Invoice IDs are Keccak-256 of `pharos-treasury:v1:` plus the exact reference, scoped by payer. The router marks the reference before transfer and relies on transaction rollback if transfer fails; a reentrancy guard and safe token-return handling protect the transfer.

Policy caps and allowlists are checks for the user's current plan, not autonomous on-chain authority. Every funding action still requires a wallet signature. Plans are invalidated after account, chain, invoice or policy changes. Pending requests are saved before opening the wallet; unknown submission outcomes are never retried automatically. A mismatched attached hash cannot clear the pending lock. The verifier checks payer, router, calldata, native value, receipt status and exact event fields before calling a payment confirmed.

## Setup and verification

```sh
npm ci
npm run web
# http://localhost:3000/treasury
node --test test/treasury.test.js
forge test --offline --root contracts --match-contract TreasuryTest -vv
```

Local planning needs Foundry `cast` and network access to Atlantic and Docs MCP. Production planning needs Vercel Sandbox access and the existing Foundry snapshot in `config/saga-snapshot.json`; Vercel supplies its OIDC credentials to the Sandbox SDK. Snapshot availability and the production path must be smoke-tested after deployment. Upstream unavailability is shown as an error with no prepared transaction.

Deployment uses a **separate** CLI script and the existing ignored throwaway Atlantic wallet; neither the API nor frontend imports a signer:

```sh
node scripts/treasury-deploy.mjs --check
node scripts/treasury-deploy.mjs --live
```

The script verifies chain identity, demands at least 0.025 test PHRS, bounds estimated gas against that budget and saves public deployment checkpoints. It deploys contracts, mints demo tokens, approves exactly 25 tUSDC, pays one invoice and verifies event/balance changes and duplicate rejection. Public output is written to `config/treasury.json` and `reports/treasury-run.json` only after the corresponding actions have actually occurred.

## Submission evidence still required

A verified public deployment; live tool traces; contract addresses; an actual user payment/receipt; setup and architecture documentation; and a required short video showing the complete real flow. Do not submit a deployment-pending page as a completed capstone.
