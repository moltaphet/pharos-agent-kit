# Security

Treasury Copilot (`/treasury`) is a testnet product on Pharos Atlantic (chain 688689) with a valueless demonstration token. It still follows the rules a real payment tool needs.

## Threat model

| Threat | Mitigation |
|---|---|
| The agent, API or page leaks or misuses a private key | None exists there. The only signer is the user's wallet; deployment uses a separate script and an ignored throwaway testnet wallet that neither the API nor the page imports. |
| A prepared transaction differs from what the user intended | The plan is built from validated input with exact decimal math, simulated on Atlantic, and discarded when account, chain, invoice or policy changes. The wallet shows the transaction before signing. |
| Unlimited token allowance | Approvals are for the exact invoice amount. |
| Paying the wrong or a risky recipient | A per-invoice cap and optional allowlist apply first. The agent also inspects the recipient on chain (smart contract, never-used address, earlier payments) and asks for confirmation when something looks off. |
| Paying the same invoice twice | The router records `paid[payer][invoiceId]` before the transfer and refuses a repeat; the UI checks the same registry before offering a payment. |
| A wallet or RPC reports success that did not happen | A payment is confirmed only when payer, router, calldata, native value, receipt status and the exact `InvoicePaid` event all match. |
| Unknown outcome after a closed tab or wallet error | The request is saved before the wallet opens and blocks another signature until its outcome is checked. Nothing is retried automatically. |
| Router abuse or reentrancy | Immutable token, no balance, no owner, a reentrancy guard and strict handling of token return data (see `contracts/test/Treasury.t.sol`, including fuzz tests). |
| Cross-site scripting or framing of the page | Strict Content-Security-Policy with no inline script or style, `frame-ancestors 'none'`, `nosniff`, `no-referrer` (see `vercel.json`). All dynamic text is escaped before it is rendered. |
| Upstream (Docs MCP, RPC) failure or tampering | The flow fails closed: documentation must be cited and state chain 688689 and PHRS, chain identity is checked, and nothing is prepared on failure. |

## Reporting

Open an issue on the repository, or contact the maintainers privately through the GitHub profile. Please do not include real funds or keys in reports; this project only handles testnet tokens.
