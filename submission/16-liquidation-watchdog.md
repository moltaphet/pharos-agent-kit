# 16. Liquidation Watchdog

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/liquidation-watchdog/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/liquidation-watchdog
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/liquidation-watchdog
- **What the proof shows:** Watches a real borrower in Morpho Blue on Pharos mainnet (three of the four recent borrowers are within 3.5% of liquidation), grades it against warn and critical thresholds, alerts to the console with a timestamp (and Discord or Telegram if configured) with the exact amount to repay or add. The real Morpho contract, asked to liquidate on a fork, agrees with the health factor on both sides of 1.

## Requirements it was built against (the Arena’s own list)

1. Reads the position's collateral, debt and health factor (or equivalent) from chain.
   - Met by: It reads the position’s collateral, debt and health factor from Morpho Blue on Pharos mainnet (collateral and borrow shares, the market totals, the oracle price and the interest rate model), in two Multicall3 batches at one pinned block, each confirmed on the public RPC.
2. Configurable warning thresholds, e.g. warn at 1.3 and critical at 1.1.
   - Met by: Thresholds are configurable (warn 1.3 and critical 1.1 by default, validated); the same recorded loan is OK, a warning or critical under different thresholds.
3. Sends alerts through at least one channel: Telegram, Discord, email, or a console with timestamps.
   - Met by: Alerts go to the console with a timestamp, and to Discord or Telegram when a webhook or bot token is set in the environment; an alert is raised when the level worsens or recovers, not on every look.
4. Suggests a concrete action in each alert, e.g. "repay X or add Y collateral".
   - Met by: Every alert carries a concrete action: how much to repay, or how much collateral to add, to get back to a safe health factor, plus how far the price may fall and how long interest alone would take.

Code and notes: [agents/liquidation-watchdog/README.md](../agents/liquidation-watchdog/README.md)
