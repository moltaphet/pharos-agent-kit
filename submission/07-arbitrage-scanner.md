# 7. Arbitrage Scanner

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-arbitrage-scanner
- **What the proof shows:** Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.

## Requirements it was built against (the Arena’s own list)

1. Reads prices from at least 2 sources in the same scan.
   - Met by: Both venues are read in the same scan at one pinned block: FaroSwap V2 (reserves) and FaroSwap V3 (slot0, liquidity), through one Multicall3 call.
2. Calculates net profit after swap fees, slippage estimate, and gas.
   - Met by: Net profit subtracts each venue’s swap fee, an estimate of price impact (searched across trade sizes) and gas (270k units at the live gas price, in WPROS).
3. Acts (or prepares the transaction) only above a configurable profit threshold; otherwise logs why it skipped.
   - Met by: It acts (a simulated fill) only when net profit reaches a configurable minimum; otherwise the scan lists exactly why it skipped, with the numbers.
4. Logs every scan with gross spread, costs, net result and decision.
   - Met by: Every scan records gross spread, costs, net result and decision: the history table below, the run log, and `--log scans.jsonl` in the CLI.
5. Works safely on testnet or with simulated execution; no requirement to risk real funds.
   - Met by: Live scans never send anything: “acting” on live data is a simulated fill, so no key, no transaction and no funds are ever at risk. The act path itself was executed on a local fork of Pharos mainnet (real FaroSwap V2 and V3 contracts, a real EVM, anvil’s unlocked dev accounts), with predicted and actual profit recorded side by side in reports/arbitrage-runs.json.

Code and notes: [skills/pharos-arbitrage-scanner/README.md](../skills/pharos-arbitrage-scanner/README.md)
