# 20. x402 Paywalled API

> An API that charges per request with x402 on Pharos Atlantic testnet: two paid routes, one free, its own facilitator, and a client that pays and gets the data, with every settlement on the explorer.

**Arena task:** Payments · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/x402-paywalled-api)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/x402-paywalled-api/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/x402-paywalled-api

## What it does

x402 puts a price on an HTTP request. A client asks for a paid route, the server answers 402 Payment Required with what it wants (how much, in which token, to whom), the client signs a payment and asks again, and this time it gets a 200 and, in a PAYMENT-RESPONSE header, the hash of the transaction that settled the payment. No account, no API key: the payment is the credential.

## What is real

x402 on Pharos Atlantic testnet built from the protocol: two paid routes and one free, its own facilitator (/verify, /settle, /supported), a client that pays; the real run shows 402, a signed payment, 200 with PAYMENT-RESPONSE and the settlement on the explorer, and nine cheats all refused with 402.

Real transaction to open: https://atlantic.pharosscan.xyz/tx/0x9eb8e6a214bc3dfd6a4ca5b6bc9e4b4d2cac5be84589350d305dc89f9a7694b1

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Runs on Atlantic Testnet (eip155:688689), priced in test USDC. | It runs on Pharos Atlantic testnet (eip155:688689): the requirements name the network and the test USDC, and the prices are 0.005 and 0.01 USDC. |
| 2 | Has at least 2 paid routes at different prices and 1 free route, such as /health. | There are two paid routes at different prices (GET /api/info at 0.005 USDC, GET /data at 0.01 USDC) and one free route (GET /health). |
| 3 | Runs its own facilitator with /verify, /settle and /supported. | It runs its own facilitator with GET /supported, POST /verify and POST /settle, as a separate process the server talks to over HTTP. |
| 4 | Shows the full flow in the demo: a 402, then a signed payment, then a 200 with a PAYMENT-RESPONSE header and its tx hash, linked on the explorer. | The demo shows the full flow over real HTTP: a 402, a signed payment, then a 200 with a PAYMENT-RESPONSE header and the transaction hash, linked on the explorer and re-read from the chain on this page. |
| 5 | Rejects a bad or underpaid payment with another 402. | It rejects a bad or underpaid payment with another 402: nine attempts (underpaid, wrong recipient, expired, forged and tampered signatures, no funds, a replay, garbage, a payment for the wrong route) were all refused and moved no token. |
| 6 | Keeps private keys in env vars or a file, never in code or prompts. | Private keys are read from the environment or a file (FACILITATOR_PRIVATE_KEY and EVM_PRIVATE_KEY, or the _FILE form), never from code or prompts; the recorded run started the facilitator with only a file path. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
FACILITATOR_PRIVATE_KEY_FILE=… node agents/x402-paywalled-api/facilitator.js
node agents/x402-paywalled-api/server.js
EVM_PRIVATE_KEY_FILE=… node agents/x402-paywalled-api/client.js http://localhost:4021/data
node scripts/x402-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
GET /health            → 200 {"status":"ok"}   (free)
GET /data              → 402 PAYMENT-SIGNATURE header is required
                         accepts: exact · eip155:688689 · 10000 base units of the test USDC · payTo 0x2629…8b13
GET /data + payment    → 200 {"message":"Hello, paid user!"}   PAYMENT-RESPONSE: success · tx 0x9eb8e6a2…94b1
GET /data, underpaid   → 402 invalid_exact_evm_payload_authorization_value: underpaid: 5000 base units were signed but the price is 10000
```

## What is in this folder

- [client.js](client.js)
- [facilitator.js](facilitator.js)
- [server.js](server.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/x402.js](../../lib/x402.js)
- [lib/tasks/x402-paywalled-api.js](../../lib/tasks/x402-paywalled-api.js)
- [api/x402.js](../../api/x402.js)
- [agents/x402-paywalled-api/server.js](server.js)
- [agents/x402-paywalled-api/facilitator.js](facilitator.js)
- [agents/x402-paywalled-api/client.js](client.js)
- [scripts/x402-setup.mjs](../../scripts/x402-setup.mjs)
- [scripts/x402-run.mjs](../../scripts/x402-run.mjs)
- [public/js/tasks/x402-paywalled-api.js](../../public/js/tasks/x402-paywalled-api.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/x402-run.json](../../reports/x402-run.json)
- [reports/x402-token-check.json](../../reports/x402-token-check.json)
- [config/x402.json](../../config/x402.json)
- [contracts/TestUSDC.sol](../../contracts/TestUSDC.sol)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 19, 21, 22, 23, 25, 26, 27, 28), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 28, 29), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 19, 21, 22, 23, 25, 26, 27, 28), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29), [lib/secp256k1.js](../../lib/secp256k1.js) (also tasks 17, 19, 21), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/testnet-contracts.js](../../lib/testnet-contracts.js) (also tasks 6, 8, 10, 27), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 19, 22, 23, 25, 26, 27, 28), [lib/testnet-signer.js](../../lib/testnet-signer.js) (also tasks 5, 6, 8, 10, 11, 24, 25, 27, 29), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

3 test files cover this task (run all of them with `npm test`):

```bash
node --test test/x402.test.js test/x402-task.test.js test/x402-audit.test.js
```

## Verify it yourself

- **Read the paywall’s 402 yourself.** The hosted paywall answers a real 402 with its requirements in the PAYMENT-REQUIRED header.
- **Open a settlement on the explorer.** Each paid request in the recorded run links to its settlement transaction on Atlantic; its sender is the facilitator, and the token’s Transfer log shows payer → payee for exactly the price.
- **Read the token balances.** The recipient’s balance of the demo token, from the Atlantic RPC.
- **See why the docs’ token cannot be used.** It has no transferWithAuthorization: this call reverts.
- **Run it yourself.** Start the facilitator, the server and the client in three terminals (the keys come from files or the environment).
- **Read the code.** The protocol, the three processes, the token and the recordings are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
