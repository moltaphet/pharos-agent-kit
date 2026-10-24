# 18. Recurring Payment Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/recurring-payment-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/recurring-payment-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/recurring-payment-agent
- **What the proof shows:** A weekly or monthly schedule on Pharos mainnet: every period is upcoming, pending, submitted, paid or failed from the chain’s own receipts and Transfer logs, the next payment and the history are shown, and the whole lifecycle (sign, fail, retry, unreported payment found on chain, short balance) ran on a mainnet fork with exactly one payment per period.

## Requirements it was built against (the Arena’s own list)

1. Supports a schedule (weekly or monthly) with amount, token and recipient.
   - Met by: A schedule is weekly or monthly with an amount, a token and a recipient (and a start date and an optional count); the due times are exact (a month without the 31st takes its last day), and the next payment is shown.
2. Prepares each payment on time and tracks paid, pending and failed status.
   - Met by: Each payment is prepared as an unsigned transaction when it is due, and every period is tracked as upcoming, pending, submitted, paid or failed, from the receipt and the token’s Transfer log on Pharos mainnet.
3. Handles insufficient balance or a failed transaction without double-paying.
   - Met by: A payer without enough balance gets nothing prepared and a reason; a reverted transaction is failed and retried (at most three times); a transaction that landed unreported is found on chain and never prepared again; reporting a paid period again is refused. On a fork the payee ended with exactly one payment per period.
4. Shows a payment history and the next scheduled payment.
   - Met by: The page and the CLI show the payment history (every prepared, reported, paid, failed and blocked event with its transaction) and the next scheduled payment.

Code and notes: [agents/recurring-payment-agent/README.md](../agents/recurring-payment-agent/README.md)
