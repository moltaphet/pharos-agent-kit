# 30. Multi-Protocol Aggregator

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/multi-protocol-aggregator/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/multi-protocol-aggregator
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/multi-protocol-aggregator
- **What the proof shows:** A Harbor-style agent over five USDC venues of three Pharos protocols (R25’s three vaults, the RockawayX vault of Morpho Vault V2, a Morpho Blue lending market) behind one interface: it queries rates, liquidity and a wallet’s positions, routes a deposit or withdrawal to the best venue with the reasons (each venue’s own simulation decides who can get in), and prepares the unsigned transactions. A protocol that cannot be read is reported and the others carry on; the recorded run takes protocols down one after another, up to all of them. The architecture write-up is in docs/architecture-multi-protocol-aggregator.md.

## Requirements it was built against (the Arena’s own list)

1. Integrates at least 2 protocols or vaults behind one interface.
   - Met by: Five venues of three protocols (R25 ×3, Morpho Vault V2, Morpho Blue) sit behind one interface, read the same way and measured the same way.
2. Supports both queries (positions, rates) and actions (deposit or withdraw prepared for signature).
   - Met by: Queries (rates, value locked, free liquidity, a wallet’s positions) and actions (deposit and withdraw, prepared as unsigned approve + deposit/withdraw transactions with a simulation) go through the same interface; nothing is signed.
3. Routes each request to the best venue and explains why it chose it.
   - Met by: Each request is routed to a venue and the answer says why: the best measured return among the venues that accept it, with every other venue listed with its reason; withdrawals come from the lowest return that can pay.
4. Handles one protocol being unavailable without breaking the others.
   - Met by: The recorded run takes down R25, then Morpho Vault V2, then both, then everything: each time the others carry on, and with all down the answer is a clear “no venue can take this right now”.
5. Includes an architecture write-up and a demo video, strongly encouraged for this tier.
   - Met by: The architecture write-up is in docs/architecture-multi-protocol-aggregator.md; the Try tab and the CLI show the same requests step by step.

Code and notes: [agents/multi-protocol-aggregator/README.md](../agents/multi-protocol-aggregator/README.md)
