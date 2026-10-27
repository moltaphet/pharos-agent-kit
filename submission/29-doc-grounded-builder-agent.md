# 29. Doc-Grounded Builder Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/doc-grounded-builder-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/doc-grounded-builder-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/doc-grounded-builder-agent
- **What the proof shows:** An agent that answers “how do I do X on Pharos?” end to end: it asks Developer Docs MCP and keeps only an answer the docs support, with its sources; reads the facts it needs (chain ID, the price feed address and heartbeat) from the docs pages; does X through Chain MCP (a balance, a price, and transfers or deployments prepared unsigned for the user’s signature); and verifies the outcome on chain against the plan. Nine real requests are recorded, including a transfer and a deployment signed on Atlantic testnet and verified, a mainnet transfer left unsigned, and requests the docs do not cover, which it refuses to improvise.

## Requirements it was built against (the Arena’s own list)

1. Uses Docs MCP to plan, with sources cited, before acting.
   - Met by: The docs answer comes first: a plan with the pages it cites, produced by Docs MCP and accepted only if the docs support the question; the facts the action uses come from the docs pages.
2. Executes the plan with Chain MCP and/or SkillEngine; anything that moves funds is prepared for signature.
   - Met by: Reads go through Chain MCP; the transfer and the deployment are prepared as unsigned transactions. The mainnet transfer was never signed or sent; the Atlantic ones were signed by the throwaway wallet standing in for the user.
3. Verifies the outcome on chain and reports success or failure against the plan.
   - Met by: Each run ends with a list of checks against the plan (chain ID, a second read, freshness; or sender, recipient, amount, nonce, code and a call) and a verdict of success or failure.
4. Works for at least 3 different "how do I…" requests.
   - Met by: Six different requests were done and verified or prepared: a balance, two price feeds, a transfer on mainnet (prepared), a transfer on Atlantic (signed, verified) and a deployment (signed, verified).
5. Handles a request the docs don't cover by saying so instead of improvising.
   - Met by: Two requests the docs do not cover (liquidity on FaroSwap, baking bread) were answered with “the docs do not cover this” and nothing was done; a third the docs explain but the agent cannot do (running a validator) was explained with sources and left there.

Code and notes: [agents/doc-grounded-builder-agent/README.md](../agents/doc-grounded-builder-agent/README.md)
