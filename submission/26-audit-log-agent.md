# 26. Audit-Log Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/audit-log-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/audit-log-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/audit-log-agent
- **What the proof shows:** An agent that turns a wallet’s activity over a date range into a plain-language report: it finds the blocks for the dates, reads the wallet’s token transfers and approvals (the node’s only per-address index) and the transactions behind them in JSON-RPC batches, groups them into transfers in and out, swaps, approvals and contract interactions with totals and notable transactions, and exports Markdown, CSV and PDF. Recorded for three real wallets over one whole day on Pharos mainnet; what the node cannot list (plain PROS transfers) is counted and stated.

## Requirements it was built against (the Arena’s own list)

1. Accepts a wallet address and a date range.
   - Met by: The report takes any wallet address and a start and end date or time (UTC); the recorded reports cover one whole day, and the Try tab takes any range up to 12 hours.
2. Groups activity into categories: transfers in and out, swaps, approvals, contract interactions.
   - Met by: Events are grouped into transfers in, transfers out, swaps, approvals and contract interactions; across the three recorded wallets all of them occur.
3. Includes totals per category and notable transactions with links.
   - Met by: Each report has totals per category (counts and dollar values), per-token transfer totals, and notable transactions with explorer links that are re-read from mainnet when this page loads.
4. Exports the report as Markdown, PDF or CSV.
   - Met by: Each report is exported as Markdown, CSV and PDF; the downloads on this page are generated from the same data.

Code and notes: [agents/audit-log-agent/README.md](../agents/audit-log-agent/README.md)
