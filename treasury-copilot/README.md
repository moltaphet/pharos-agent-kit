# Treasury Copilot

**Pay the invoice. Prove the payment.**

An AI agent for paying invoices on Pharos. It reads the Pharos docs and the chain, checks the recipient and your limits, and prepares one exact transaction. You sign it in your wallet, and the receipt is matched on-chain.

- **Live:** https://pharos-agent-kit.vercel.app/treasury (Pharos Atlantic Testnet, chain 688689)
- **Built for:** small teams, DAOs and freelancers who pay contributors and vendors on Pharos and want every payment checked, limited and provable.
- **Submission for:** the Pharos Agent Arena task [Agent-Native dApp](https://pharos-agent-arena.vercel.app/tasks/agent-native-dapp).

This folder is the whole product on its own: the page, the API, the agent, the contracts, the tests and the deployment scripts. It lives inside the [Pharos Agent Kit](https://github.com/moltaphet/pharos-agent-kit) repository, and `lib/` holds the shared Pharos helpers (RPC, MCP client, ABI, Keccak, tracing) it builds on. `lib/treasury/` is the product.

## What the agent does

1. **Reads** pasted invoice text into reference, recipient and amount. When something is missing or ambiguous it asks; it never guesses.
2. **Asks the Pharos Developer Docs MCP** for the Atlantic network facts and the approve/transferFrom signing procedure. It stops unless the answer is cited and states chain 688689.
3. **Reads chain state with the official Pharos SkillEngine** (Foundry read templates, pinned block): balance, allowance, and whether the invoice reference is already paid.
4. **Inspects the recipient on-chain:** smart contract or wallet, ever used, paid before. A contract or never-used address makes the agent ask you to confirm before the sign button unlocks.
5. **Applies your policy** (per-invoice cap, optional recipient allowlist), simulates the call on Atlantic RPC, and prepares either an exact-amount approval or the payment.
6. **Verifies the receipt** against payer, router, calldata, amount and the `InvoicePaid` event before it calls a payment confirmed.

Every tool call is listed on the page with its timing. The receipt ledger is read straight from the chain, so every visitor sees the same record.

## On-chain (Atlantic Testnet)

| | |
|---|---|
| `InvoicePaymentRouter` | [`0x5b95c09b2a2bf9e7ee3662dbf76d9db442844d4e`](https://atlantic.pharosscan.xyz/address/0x5b95c09b2a2bf9e7ee3662dbf76d9db442844d4e) · [source verified on Sourcify](https://repo.sourcify.dev/688689/0x5b95C09b2a2bF9e7Ee3662DbF76d9dB442844D4e) |
| `TreasuryDemoToken` (tUSDC, valueless) | [`0x83f0e9a24160e91b670029f6c65f3734bb434503`](https://atlantic.pharosscan.xyz/address/0x83f0e9a24160e91b670029f6c65f3734bb434503) · [source verified on Sourcify](https://repo.sourcify.dev/688689/0x83F0E9a24160E91b670029F6c65F3734bB434503) |
| Verified demo payment | [`0x99e5b41a…a4be`](https://atlantic.pharosscan.xyz/tx/0x99e5b41aa03ebf7b7d42ab47265c01debffa38f0e409c62382fc7fc66451a4be) (9 checks, `reports/treasury-run.json`) |

The router holds no balance, has an immutable token and no owner, and refuses a repeated invoice reference for the same payer. More than a dozen real payments are recorded on-chain (`reports/treasury-seed.json`, `reports/treasury-demo-recording.json`).

## Run it

You need Node 20 or newer. For the agent's SkillEngine reads on your own machine you also need Foundry's `cast` ([install](https://book.getfoundry.sh/getting-started/installation)).

```sh
npm install
npm start          # http://localhost:3000
```

To try the full flow you need an EVM wallet on Pharos Atlantic Testnet (chain 688689) with a little test PHRS for gas ([testnet docs](https://docs.pharos.xyz/getting-started/network/atlantic-testnet)). The page mints free demonstration tUSDC. Without a wallet you can still inspect the recorded payment and review invoices read-only.

The agent needs network access to the Atlantic RPC and the Pharos Docs MCP. No API keys or environment variables are required. A review takes about 10 to 30 seconds because the public RPC is rate limited and the Docs MCP is an AI-backed service.

## Tests

```sh
npm test                 # 22 tests: validation, intake, history, recipient inspection, agent plan, wallet and storage
npm run test:contracts   # 14 Solidity tests with fuzzing (needs Foundry)
```

## Layout

| Path | What it is |
|---|---|
| `public/treasury.html`, `public/css/`, `public/js/treasury/` | The page: invoice form, agent console, ledger, wallet connection |
| `api/treasury.js` | One endpoint: `config`, `parse`, `plan`, `verify`, `proof`, `history` |
| `lib/treasury/` | The agent: `intake`, `validation`, `agent`, `tools` (SkillEngine), `recipient`, `chain`, `history` |
| `contracts/` | `InvoicePaymentRouter.sol`, `TreasuryDemoToken.sol`, Foundry tests |
| `scripts/treasury-deploy.mjs` | Deploys to Atlantic and proves one payment (bounded gas budget, Atlantic only) |
| `scripts/treasury-seed.mjs` | Sends a set of real payments so the ledger has history |
| `config/treasury.json` | Deployed addresses, invoice-ID to reference map |
| `skills/pharos-treasury-engine/` | The pinned official SkillEngine reference files |
| `docs/` | Architecture write-up and the demo-video script |
| `SECURITY.md` | Threat model |

## Deploy your own copy

```sh
cast wallet new --json        # save the address and private key into .wallet/atlantic-testnet.json as {"address": "...", "privateKey": "..."}
npm run deploy:check          # read-only: network and balance
npm run deploy:atlantic       # deploys both contracts, mints, approves, pays one invoice, verifies
```

`.wallet/` is git-ignored. The key is only ever read by these scripts; the API and the page never import a signer. Use a throwaway testnet wallet. Deploy the site to Vercel as a normal project with this folder as its root (`vercel.json` sets the security headers). On Vercel the SkillEngine reads run in a short-lived Sandbox created from the snapshot named in `config/saga-snapshot.json`; that snapshot belongs to the original Vercel team, so a fresh deployment needs its own (the reads fall back to local `cast` when run locally).

## Safety

No private key exists in the agent, the API or the frontend; the only signer is your wallet. Approvals are for the exact invoice amount. Limits and recipient checks come before anything is prepared. If the docs, the chain reads or the simulation fail, the agent stops and says why. Unknown outcomes are saved and never retried automatically. The page is served with a strict Content-Security-Policy. Full threat model: [SECURITY.md](SECURITY.md); architecture: [docs/architecture-treasury-copilot.md](docs/architecture-treasury-copilot.md).

tUSDC is a demonstration token with no monetary value. This is a testnet product, not financial advice.

## License

MIT
