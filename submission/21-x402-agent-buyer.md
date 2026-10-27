# 21. x402 Agent Buyer

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/x402-agent-buyer
- **What the proof shows:** A plan-driven x402 buyer reads each endpoint’s price, compares it with an explicit value estimate, a per-call cap and a cumulative budget, and signs only offers that pass. Run for real on Pharos Atlantic against the task-20 server: 4 real settlements across three jobs (completed, stopped by the budget, skipped as not worth it), each read back from the chain, and the payer’s balance moved by exactly the ledger total.

## Requirements it was built against (the Arena’s own list)

1. Calls at least 2 different x402 endpoints. They can be your own or another dev's.
   - Met by: The plan buys two distinct routes of the task-20 server (/api/info and /data) in one job; both settle on Atlantic and are re-read from the chain on this page.
2. Enforces a spend budget and a per-call price cap, and refuses calls over either one.
   - Met by: The engine checks an exact per-call cap and the cumulative budget before signing; the recorded budget-stop job buys one endpoint and refuses the other with 2,000 units left against a 10,000 price.
3. Logs every payment with the price, what it bought and the tx hash, plus a running total.
   - Met by: The confirmed-payment ledger records the item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are reserved separately.
4. Handles payment failures with retries that are safe: the same payment never counts twice.
   - Met by: Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the job, and repeated transaction hashes or authorization nonces cannot raise the paid total.
5. Includes a demo task where the agent completes the job, and one where it stops because it hit the budget.
   - Met by: Three real jobs are recorded: one completed, one stopped by the budget, one that skipped an endpoint priced above its estimated value. In each the payer’s balance moved by exactly the ledger total.

Code and notes: [agents/x402-agent-buyer/README.md](../agents/x402-agent-buyer/README.md)
