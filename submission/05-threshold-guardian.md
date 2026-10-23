# 5. Threshold Guardian

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/threshold-guardian/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/threshold-guardian
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-threshold-guardian
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0xfd9df7e9dfefb2d0c67b5717d739aa840e6c333fbfd5e8ab7a5425fdc7d4695d
- **What the proof shows:** Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.

## Requirements it was built against (the Arena’s own list)

1. Evaluates at least 3 independent conditions read from chain.
   - Met by: Three independent conditions are read from chain: gas price (get_gas_price), a token balance (eth_call balanceOf), and a vault’s share-price change (eth_call convertToAssets now versus N blocks earlier).
2. Conditions and thresholds are configurable, not hard-coded.
   - Met by: Condition types, operators, thresholds, addresses, the look-back window and the rule are all in the JSON config; edit it above and run again. Nothing is hard-coded.
3. Logs a clear decision trace each run: each condition's value, pass/fail, and the final decision.
   - Met by: Every run prints a trace: each condition’s value, threshold and pass/fail, the rule, and the final decision. The same lines are recorded in the run log.
4. Demonstrates both outcomes: one run where it fires and one where it holds.
   - Met by: examples/fires.json fires and examples/holds.json holds, both on live data; each is a chip above. The testnet card shows both outcomes acting for real: the FIRE sent a real transaction and the HOLD sent nothing.

Code and notes: [skills/pharos-threshold-guardian/README.md](../skills/pharos-threshold-guardian/README.md)
