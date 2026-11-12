# Agent-Native dApp: Treasury Copilot

Task: https://pharos-agent-arena.vercel.app/tasks/agent-native-dapp

**Live dApp:** https://pharos-agent-kit.vercel.app/treasury

**Repository:** https://github.com/moltaphet/pharos-agent-kit

**Demo video:** to be added (script: `docs/treasury-demo-script.md`).

## Notes for the form

Treasury Copilot is an invoice payment desk with an AI agent at its core, for small teams, DAOs and freelancers who pay contributors and vendors on Pharos. The agent reads pasted invoice text (and asks when something is missing or ambiguous), consults the Pharos Developer Docs MCP for the network and signing procedure, reads balance, allowance and the invoice registry through the official Pharos SkillEngine, applies the user's policy limits, simulates the call, and prepares one exact approval or payment for the user's wallet to sign. It then verifies the mined receipt against the expected payer, router, calldata, amount and event. A non-custodial router prevents paying the same invoice reference twice.

Network: Pharos Atlantic Testnet, chain 688689.

Contract addresses:
- InvoicePaymentRouter: `0x5b95c09b2a2bf9e7ee3662dbf76d9db442844d4e` (source verified on Sourcify, exact match: https://repo.sourcify.dev/688689/0x5b95C09b2a2bF9e7Ee3662DbF76d9dB442844D4e)
- tUSDC demo token (valueless): `0x83f0e9a24160e91b670029f6c65f3734bb434503` (source verified on Sourcify, exact match: https://repo.sourcify.dev/688689/0x83F0E9a24160E91b670029F6c65F3734bB434503)
- Verified proof payment: `0x99e5b41aa03ebf7b7d42ab47265c01debffa38f0e409c62382fc7fc66451a4be`

## Requirements checklist

| # | Requirement | Where it is met |
|---|---|---|
| 01 | Deployed on Pharos with a working UI and contract addresses | Live page above; addresses above and in `config/treasury.json`; explorer links on the page |
| 02 | Agent is central; at least 2 Pharos AI tools | Developer Docs MCP and Pharos SkillEngine both gate the decision (`lib/treasury/agent.js`, `lib/treasury/tools.js`); Atlantic RPC is labelled separately |
| 03 | Clear user problem; README says who and why | README section "Treasury Copilot" and the page header |
| 04 | Safe: no keys, user signs or policy limits, error handling | No signer in agent, API or frontend; exact-amount approvals; cap and allowlist; fail-closed errors; strict CSP; see architecture doc "Safety" |
| 05 | Open-source repo, setup instructions, architecture write-up | MIT repository; README "Run it"; `docs/architecture-treasury-copilot.md` |
| 06 | Demo video of a real flow | Recorded separately; link added to the form and to `config/treasury.json` |

Test evidence: `reports/treasury-tests.md` and `reports/treasury-run.json`.
