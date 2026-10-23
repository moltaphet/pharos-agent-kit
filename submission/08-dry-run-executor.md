# 8. Dry-Run Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/dry-run-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/dry-run-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-dry-run-executor
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x79363e34be685e5bff405cd648ab3c68a6a27243ca0905cc50f644003f2fd565
- **What the proof shows:** Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.

## Requirements it was built against (the Arena’s own list)

1. Uses a call or gas estimation to simulate the transaction without broadcasting it.
   - Met by: Uses eth_call and estimate_gas on the live chain at a pinned block to simulate the transaction without broadcasting it.
2. Reports predicted success or revert, including the revert reason when available, and estimated gas cost.
   - Met by: Reports predicted success or revert, including the decoded revert reason (string, panic, or known custom error), and the estimated gas and its cost in PROS.
3. Shows the expected outcome, e.g. balances or state before and after where possible.
   - Met by: Shows the expected before/after for ERC-20 transfers, approvals and native value; the real testnet run and the fork run produce the actual outcome to compare against.
4. Blocks execution automatically if the simulation fails.
   - Met by: The gate blocks execution automatically when the simulation fails: the executor’s send is never called (unit-tested), and the CLI prints “EXECUTION BLOCKED”.

Code and notes: [skills/pharos-dry-run-executor/README.md](../skills/pharos-dry-run-executor/README.md)
