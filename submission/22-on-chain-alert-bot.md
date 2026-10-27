# 22. On-Chain Alert Bot

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/on-chain-alert-bot/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/on-chain-alert-bot
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/on-chain-alert-bot
- **What the proof shows:** A bot that watches Pharos mainnet for a price crossing on the PROS/USD feed, large USDC/WPROS transfers, contract events and contract calls, and delivers each alert (what, value, explorer link) to Discord, Telegram, ntfy or a webhook. Each event goes to each channel once; a channel outage loses nothing. The recorded run scans 1,000 real mainnet blocks and delivers over real HTTP to local Discord-style, ntfy and webhook receivers (sending to Discord/Telegram itself needs the owner’s webhook or bot token).

## Requirements it was built against (the Arena’s own list)

1. At least one configurable alert condition.
   - Met by: Four condition types (price crossing, large transfer, contract event, contract call) are configured from JSON; the recorded run uses five conditions on Pharos mainnet.
2. Delivers alerts to a real channel: Telegram, Discord or similar.
   - Met by: The bot delivers by HTTP to Discord, Telegram, ntfy and webhook channels; the recorded run shows the exact requests received by Discord-style, ntfy and webhook endpoints.
3. Each alert includes what happened, the value, and a tx or explorer link.
   - Met by: Each message carries what happened, the value, the block and an explorer link; the recorded alerts are re-read from mainnet when this page loads.
4. No repeat spam for the same event.
   - Met by: Rescanning the same blocks, and restarting from the saved state, sent nothing twice; during a channel outage nothing was lost and the recovered channel got only what it missed.

Code and notes: [agents/on-chain-alert-bot/README.md](../agents/on-chain-alert-bot/README.md)
