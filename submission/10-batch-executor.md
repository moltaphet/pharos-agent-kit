# 10. Batch Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/batch-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/batch-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-batch-executor
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x37fd3313534ab882ddc5f5e35ebdc8f5efb5aee62474dd2e352fc9bfec0e34e3
- **What the proof shows:** Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.

## Requirements it was built against (the Arena’s own list)

1. Accepts a list of at least 3 independent actions.
   - Met by: Accepts a list of at least 3 independent actions (up to 25), validated one by one.
2. Executes them as a batch: multicall, a single prepared transaction, or an equivalent.
   - Met by: Executes them as one batch: a single Multicall3.aggregate3Value transaction, prepared unsigned, whose encoding matches `cast calldata`.
3. Reports the gas saving or step reduction compared with running them individually.
   - Met by: Reports the gas and step change against sending them one by one: estimated here, and measured on a real-EVM fork (178,977 → 150,762 gas for the sync workload; and honestly +70% for plain transfers).
4. Handles partial failure clearly: which action failed and what happened to the rest.
   - Met by: Handles partial failure by name: each failing action is listed with its reason, the policy decides whether to exclude it or abort, and forcing it in makes the whole batch revert with nothing changed.

Code and notes: [skills/pharos-batch-executor/README.md](../skills/pharos-batch-executor/README.md)
