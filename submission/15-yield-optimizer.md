# 15. Yield Optimizer

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/yield-optimizer/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/yield-optimizer
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-yield-optimizer
- **What the proof shows:** Compares the four USDC vaults on measured yield, tests with simulations whether the wallet can get in and out, counts gas measured by really executing the steps on a mainnet fork plus fees, and answers MOVE (with unsigned transactions) or STAY PUT with the reason. Recorded decisions pinned to a block, replayable.

## Requirements it was built against (the Arena’s own list)

1. Compares at least 3 yield sources using live on-chain data.
   - Met by: It compares five yield sources from live on-chain data: the four vaults (R25 weekly, quarterly, semi-yearly and the RockawayX Morpho vault) and USDC left idle in the wallet, each rate measured from the vault’s share price at three blocks, confirmed on the public RPC.
2. Accounts for gas, entry/exit fees, and a minimum holding period before recommending a move.
   - Met by: It accounts for gas (units measured by really executing the steps on a mainnet fork, priced at the live gas price and PROS/USD), entry and exit fees (from previewDeposit and previewRedeem against the share price), and a minimum holding period you set, over which the net gain is worked out.
3. Outputs a clear recommendation with expected net gain, or "stay put" with the reason.
   - Met by: The output is a clear MOVE with the expected net gain split into extra yield, gas and fees and a break-even in days, or STAY PUT with the reason for every vault; a fork run of a real wallet checks the previews against what the vaults really paid.
4. If executing: prepares transactions for user signature only. The agent never holds keys.
   - Met by: A MOVE prepares unsigned transactions (redeem, approve, deposit) for the user to sign; the agent holds no key, sends nothing, and a test checks that only reads are asked of the chain.

Code and notes: [skills/pharos-yield-optimizer/README.md](../skills/pharos-yield-optimizer/README.md)
