# 28. Weekly Digest Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/weekly-digest-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/weekly-digest-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/weekly-digest-agent
- **What the proof shows:** An agent that builds a digest of the last N days (7 by default) of Pharos mainnet against the N before: PROS price, USDC supply, the Morpho syzUSD/USDC market, four USDC vaults, network activity and every Morpho event log, picks the three notable things, and delivers it to Discord, Telegram, ntfy or a webhook once per digest and channel, and as a published page. It runs on a schedule (a Vercel cron on Mondays, or --every on the CLI). Recorded for the real last week with delivery over real HTTP to local receivers; sending to Discord or Telegram needs the owner’s webhook or token.

## Requirements it was built against (the Arena’s own list)

1. Runs on a schedule (weekly by default, configurable).
   - Met by: The CLI runs on a schedule with --every (7 days by default, 1 to 31 configurable), and a Vercel cron runs it every Monday at 08:00 UTC; a state file stops the same period from being sent twice.
2. Covers key metrics with a comparison to the previous period.
   - Met by: Fourteen metrics are shown with the value for the previous period and the change: price, USDC supply, the Morpho market’s supply, borrow and utilisation, vault value locked and return, blocks, and the Morpho event volumes.
3. Highlights the top 3 notable events of the period.
   - Met by: The digest always lists three notable events, chosen by size against what they are measured against, with the transaction link when there is one; quiet weeks say what stayed steady.
4. Delivers to a real channel (email, Telegram, Discord) or as a published page.
   - Met by: Delivery to Discord, Telegram, ntfy and webhook channels is recorded with the exact requests the receivers got, and a second run sent nothing; the digest is also published as a page at /digests/latest.html.

Code and notes: [agents/weekly-digest-agent/README.md](../agents/weekly-digest-agent/README.md)
