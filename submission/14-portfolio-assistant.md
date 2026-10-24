# 14. Portfolio Assistant

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/portfolio-assistant/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/portfolio-assistant
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-portfolio-assistant
- **What the proof shows:** Answers eight kinds of plain-English question about a wallet from native PROS, USDC, WPROS and the four R25 / RockawayX vaults at one pinned block; every figure carries its contract, call and block, every read is repeated on the public RPC, and what it cannot know (other protocols, earnings since depositing) is refused. Recorded real wallets pinned to a block, replayable.

## Requirements it was built against (the Arena’s own list)

1. Reads positions from at least 2 protocols or vaults, plus wallet token balances.
   - Met by: It reads positions from two protocols (R25 and the RockawayX Morpho vault, four vaults in all) plus the wallet’s PROS, USDC and WPROS balances, in two Multicall3 batches at one pinned block, each confirmed on the public RPC.
2. Answers at least 5 different natural-language question types correctly.
   - Met by: It answers eight question types: total balance, what you hold, where a token is, what a token is worth, the biggest position, a named vault, which protocols you use, and what you are earning. Each is covered by tests, and eleven recorded real questions are shown.
3. Shows numbers with sources: which contract and block each figure came from.
   - Met by: Every figure shows its source: the contract, the call, the block and whether the public RPC confirmed it; the contract links to the explorer.
4. Says clearly when it doesn't know or can't read a protocol, rather than guessing.
   - Met by: It says so when it does not know: another protocol is refused by name, “what have I earned” is explained as unknowable from a balance, a vault it cannot read is named and left out, and a missing price withholds the total.
5. Read-only: never initiates transactions.
   - Met by: It is read-only: it holds no key, every call is an eth_call, and a test checks the only tools it ever asks of the chain are reads.

Code and notes: [skills/pharos-portfolio-assistant/README.md](../skills/pharos-portfolio-assistant/README.md)
