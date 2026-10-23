# 1. Read Contract State

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/read-contract-state/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/read-contract-state
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/read-contract-state
- **What the proof shows:** Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.

## Requirements it was built against (the Arena’s own list)

1. Reads at least 3 different values from one contract via Chain MCP (e.g. name, totalSupply, owner, a balance).
   - Met by: name, symbol, decimals, totalSupply and owner are read with eth_call through Chain MCP; the Try-it table shows each one.
2. Shows the contract address and the block number the data was read at.
   - Met by: The header shows the contract address and the block (with its time) that every read is pinned to.
3. Formats raw values for humans: token decimals applied, addresses labelled.
   - Met by: Decimals applied and thousands grouped with the raw value kept; addresses labelled from the Pharos registry, as wallet or contract, or with your own label.
4. Includes a short README: which contract you chose, how to run it, sample output.
   - Met by: This page and the README document the contract chosen, how to run it, and real sample output.

Code and notes: [agents/read-contract-state/README.md](../agents/read-contract-state/README.md)
