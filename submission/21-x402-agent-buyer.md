# 21. x402 Agent Buyer

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/x402-agent-buyer
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/x402-agent-buyer
- **What the proof shows:** A plan-driven x402 buyer evaluates two endpoint prices against explicit value estimates, a per-call cap and a cumulative budget. The offline fixture demonstrates both a completed job and a budget stop; live purchases require the user’s funded Atlantic testnet key and endpoints.

## Requirements it was built against (the Arena’s own list)

1. Calls at least 2 different x402 endpoints. They can be your own or another dev's.
   - Met by: The example plan buys two distinct routes (/api/info and /data); the offline demo exercises both in one completed job.
2. Enforces a spend budget and a per-call price cap, and refuses calls over either one.
   - Met by: The engine checks an exact per-call cap and cumulative budget before signing, and demonstrates stopping before the second purchase when only 2,000 units remain.
3. Logs every payment with the price, what it bought and the tx hash, plus a running total.
   - Met by: The confirmed-payment ledger records the endpoint/item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are separately reserved.
4. Handles payment failures with retries that are safe: the same payment never counts twice.
   - Met by: Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the workflow, and repeated transaction hashes or authorization nonces cannot increase the paid total.
5. Includes a demo task where the agent completes the job, and one where it stops because it hit the budget.
   - Met by: Two deterministic task demos are included: a completed two-endpoint job and a job that stops at its budget. Both are explicitly labelled simulated and make no network calls.

Code and notes: [agents/x402-agent-buyer/README.md](../agents/x402-agent-buyer/README.md)
