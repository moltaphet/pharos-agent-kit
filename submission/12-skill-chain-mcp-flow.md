# 12. Skill + Chain MCP Flow

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-transfer-preflight
- **What the proof shows:** One sentence runs Chain MCP and two Skills end to end on Pharos mainnet; the same request is READY at a Thursday block and STOP at a Saturday block because the chain’s clock decides. Five recorded runs pinned to blocks, replayable.

## Requirements it was built against (the Arena’s own list)

1. The Skill's output depends on live data fetched via Chain MCP in the same flow.
   - Met by: The verdict depends on live Chain MCP data: the block’s time picks the time-window rule (the same request is READY at a Thursday block and STOP by office-hours at a Saturday block), the token’s decimals set the amount, and the sender’s balance decides the simulation.
2. The flow runs end to end from a single user request.
   - Met by: One sentence (“send 1 USDC from A to B”) runs the whole flow end to end: parse, read the chain, check the token, decide, simulate, prepare. One call, one verdict.
3. A diagram or short write-up of the flow: what calls what, and in what order.
   - Met by: A sequence diagram on this page and a Mermaid one in the Skill’s reference show what calls what and in what order; every run also lists each step in order with the earlier steps it used.
4. A demo run showing real data moving through both tools.
   - Met by: The recorded demo is five real runs pinned to Pharos mainnet blocks, with every Chain MCP answer; Replay asks the chain again at the same blocks and shows the answers are identical.

Code and notes: [skills/pharos-transfer-preflight/README.md](../skills/pharos-transfer-preflight/README.md)
