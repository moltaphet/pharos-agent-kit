# 20. x402 Paywalled API

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/x402-paywalled-api/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/x402-paywalled-api
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/x402-paywalled-api
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x9eb8e6a214bc3dfd6a4ca5b6bc9e4b4d2cac5be84589350d305dc89f9a7694b1
- **What the proof shows:** x402 on Pharos Atlantic testnet built from the protocol: two paid routes and one free, its own facilitator (/verify, /settle, /supported), a client that pays; the real run shows 402, a signed payment, 200 with PAYMENT-RESPONSE and the settlement on the explorer, and nine cheats all refused with 402.

## Requirements it was built against (the Arena’s own list)

1. Runs on Atlantic Testnet (eip155:688689), priced in test USDC.
   - Met by: It runs on Pharos Atlantic testnet (eip155:688689): the requirements name the network and the test USDC, and the prices are 0.005 and 0.01 USDC.
2. Has at least 2 paid routes at different prices and 1 free route, such as /health.
   - Met by: There are two paid routes at different prices (GET /api/info at 0.005 USDC, GET /data at 0.01 USDC) and one free route (GET /health).
3. Runs its own facilitator with /verify, /settle and /supported.
   - Met by: It runs its own facilitator with GET /supported, POST /verify and POST /settle, as a separate process the server talks to over HTTP.
4. Shows the full flow in the demo: a 402, then a signed payment, then a 200 with a PAYMENT-RESPONSE header and its tx hash, linked on the explorer.
   - Met by: The demo shows the full flow over real HTTP: a 402, a signed payment, then a 200 with a PAYMENT-RESPONSE header and the transaction hash, linked on the explorer and re-read from the chain on this page.
5. Rejects a bad or underpaid payment with another 402.
   - Met by: It rejects a bad or underpaid payment with another 402: nine attempts (underpaid, wrong recipient, expired, forged and tampered signatures, no funds, a replay, garbage, a payment for the wrong route) were all refused and moved no token.
6. Keeps private keys in env vars or a file, never in code or prompts.
   - Met by: Private keys are read from the environment or a file (FACILITATOR_PRIVATE_KEY and EVM_PRIVATE_KEY, or the _FILE form), never from code or prompts; the recorded run started the facilitator with only a file path.

Code and notes: [agents/x402-paywalled-api/README.md](../agents/x402-paywalled-api/README.md)
