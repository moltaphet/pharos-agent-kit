# 13. Docs MCP + Chain MCP Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/docs-chain-mcp-agent
- **What the proof shows:** Explains a contract function from Developer Docs MCP (with sources), calls it on Pharos mainnet through Chain MCP, reads the value the way the docs say, cross-checked against decimals(), and confirms every read on the public RPC. Five recorded real cases pinned to a block, replayable.

## Requirements it was built against (the Arena’s own list)

1. The explanation comes from Docs MCP, with sources referenced.
   - Met by: The explanation comes from Developer Docs MCP (askQuestion) and is shown in full with its sources marked cited or related; it counts as documentation only if a documentation search for the contract’s address finds a page that lists it, and the answer names the function and links a docs page.
2. The agent then calls the same function on chain via Chain MCP.
   - Met by: The agent then calls the same function on chain through Chain MCP (eth_call at one pinned block, repeated on the public RPC to confirm it), built from the signature you give, and decodes the result by its declared type.
3. Interprets the result in the context of the explanation.
   - Met by: It interprets the value in the context of the explanation: it applies the scale the docs state, confirms it against the contract’s decimals(), reads the unit and the freshness the docs ask about, and reports a conflict if the docs and the chain disagree.
4. Works for at least 2 different functions or contracts.
   - Met by: It works for different functions and contracts: five recorded real cases (two price feeds with the same function, USDC totalSupply(), WPROS balanceOf(address), a pair’s token0()), four explained and applied and one the docs do not cover, shown raw.

Code and notes: [agents/docs-chain-mcp-agent/README.md](../agents/docs-chain-mcp-agent/README.md)
