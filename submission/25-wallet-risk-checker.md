# 25. Wallet Risk Checker

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/wallet-risk-checker/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/wallet-risk-checker
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/wallet-risk-checker
- **What the proof shows:** A pre-transaction check that reads the chain and returns low, medium or high with every flag in plain language: contract age (binary search over history), proxy/upgradeability, owner and administrator powers read from the bytecode, dangerous instructions, wallet age and activity, outstanding unlimited approvals (judging the spender too), and contact with a flag list. Five recorded examples: WPROS and an established wallet are low, USDC (an upgradeable proxy) is medium, and a deliberately risky token and a brand-new wallet with an unlimited approval to it, both created on Atlantic testnet for the demo, are high.

## Requirements it was built against (the Arena’s own list)

1. Checks at least 4 signals, e.g. contract age, verified code, interaction with flagged addresses, unusual approval patterns, freshly funded wallet.
   - Met by: Eight signals: contract age, upgradeability, admin powers, dangerous instructions, wallet age and activity, outstanding unlimited approvals, and contact with a flag list. Each check shows which were read.
2. Outputs a risk level (low, medium or high) with the specific reasons.
   - Met by: The result is low, medium or high, with each flag listed with its severity, a title and its evidence. USDC, for example, is medium: “Upgradeable proxy”.
3. Explains each flag in plain language.
   - Met by: Every flag has a plain-language paragraph saying what was found and why it matters; clean signals say what was checked and found fine.
4. Demonstrated on at least 1 clean and 1 risky example.
   - Met by: Five recorded examples: WPROS and an established wallet (both low), USDC (medium), a deliberately risky token and a brand-new wallet with an unlimited approval to it (both high).

Code and notes: [agents/wallet-risk-checker/README.md](../agents/wallet-risk-checker/README.md)
