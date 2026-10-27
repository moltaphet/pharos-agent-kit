# 27. dApp Support Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/dapp-support-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/dapp-support-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/dapp-support-agent
- **What the proof shows:** A support agent that takes a failed transaction hash, fetches the transaction and receipt through Chain MCP, replays the call on the block before it to get the contract’s own revert data, checks the numbers behind the usual causes (token balance, allowance, native value, gas used against the limit, the function selector) and explains the cause and the fix in plain words. Thirteen real failures of eleven kinds are recorded: four on Pharos mainnet and nine made on purpose on Atlantic testnet.

## Requirements it was built against (the Arena’s own list)

1. Accepts a tx hash and fetches the transaction and receipt via Chain MCP.
   - Met by: The agent takes a transaction hash and fetches the transaction and receipt through Chain MCP (the Try tab and the CLI do this on mainnet; the first step of every diagnosis lists the call).
2. Identifies the failure cause: revert reason, out of gas, insufficient balance or allowance, etc.
   - Met by: It identifies the cause from the contract’s own revert data and the numbers behind it: revert message, custom error, panic, out of gas, token balance, allowance, authorisation, paused contract, slippage, native value sent to a non-payable function, and a missing function.
3. Explains it without jargon and suggests a fix.
   - Met by: Each diagnosis is a short headline, a plain paragraph with the numbers (for example how much the spender was approved for and how much it needed), and a list of fixes.
4. Demonstrated on at least 3 different failure types.
   - Met by: Thirteen real failed transactions across eleven kinds are recorded, four on mainnet and nine made on purpose on Atlantic; their failed status is re-read from the chain when this page loads.

Code and notes: [agents/dapp-support-agent/README.md](../agents/dapp-support-agent/README.md)
