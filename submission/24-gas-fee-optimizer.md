# 24. Gas Fee Optimizer

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/gas-fee-optimizer/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/gas-fee-optimizer
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/gas-fee-optimizer
- **What the proof shows:** An agent that reads the base fee, quoted gas price and tip, holds a transaction until the price is at or under a ceiling (or the history’s cheap quarter) or until the deadline, then submits it as an EIP-1559 transaction. Run for real on Atlantic testnet: four transfers, each read back from the chain; the optimized ones paid 1 gwei where the naive legacy transaction at the quoted price paid 10 gwei, the held one was submitted before its deadline, and Pharos mainnet is only read and prepared. Gas on both networks is flat, which the report states.

## Requirements it was built against (the Arena’s own list)

1. Tracks gas price over time and shows recent history.
   - Met by: The history of both networks is sampled over 3,000 blocks (30 points) with minimum, quartiles and maximum; the Try tab shows it live for mainnet or Atlantic.
2. Accepts a transaction with a deadline and holds it until gas is favorable or the deadline is reached.
   - Met by: The recorded run holds a transaction with an unreachable ceiling, re-checks seven times, then submits at the deadline; the favourable-now and automatic-target runs submit within a second.
3. Reports the actual gas paid compared with the price at request time.
   - Met by: Each recorded transaction reports gas used, price paid and cost beside the request-time quote: 0.000021 PHRS against 0.00021 PHRS for the naive wallet’s identical transfer.
4. Never misses the deadline. It submits at the deadline even if gas is high.
   - Met by: All three optimized transactions were submitted before their deadlines (36.6 s of a 40 s deadline for the held one); a scripted-price test proves the deadline submission when the price never drops, and that a drop releases the hold.

Code and notes: [agents/gas-fee-optimizer/README.md](../agents/gas-fee-optimizer/README.md)
