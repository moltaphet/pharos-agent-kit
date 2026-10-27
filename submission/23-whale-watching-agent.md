# 23. Whale-Watching Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/whale-watching-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/whale-watching-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/whale-watching-agent
- **What the proof shows:** An agent that follows a watchlist on Pharos mainnet and reports every token move above a per-token or dollar threshold, explained (what, how much, to whom, why it matters), plus new positions, exits and balance changes, and a summary across all addresses. The recorded run watches eight addresses over 2,000 real blocks: 205 significant moves at default thresholds, 3 at stricter ones, the biggest re-read from the chain.

## Requirements it was built against (the Arena’s own list)

1. Tracks at least 5 configurable addresses.
   - Met by: The recorded run watches eight addresses on Pharos mainnet; the CLI and the Try tab accept any list.
2. A configurable "significant" threshold per token or in value terms.
   - Met by: Thresholds are set per token (USDC, WPROS, PROS) and in dollars; the same blocks give 205 moves at 100 and 3 moves at 1,000 per token.
3. Each report explains the move: what moved, how much, and where to (labelled where known).
   - Met by: Every report line names what moved, the amount and dollar value, and the counterparty with its label or kind, plus reasons; the biggest moves are re-read from mainnet when this page loads.
4. Produces a summary view of recent activity across all watched addresses.
   - Met by: The summary view lists, for every watched address, its significant moves, dollars in and out, position changes, and the overall biggest move.

Code and notes: [agents/whale-watching-agent/README.md](../agents/whale-watching-agent/README.md)
