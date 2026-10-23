# Submission pack

Everything to paste into the Arena's submit form, per task. Repository: https://github.com/moltaphet/pharos-agent-kit (public, MIT). Site: https://pharos-agent-kit.vercel.app

For every task the proof is the **deployed demo link** below (it runs against Pharos, or against a real mainnet fork or Atlantic testnet, and shows an exact run log), plus the **repo link**. Where real testnet transactions exist, an explorer link is listed too.

The testnet transactions were sent from `0x0eC197b8A30543c93e521a6C3F2DB5d110e60850` (a throwaway wallet that only holds test tokens) on 2026-10-23; the page re-reads each one from the chain every time it loads.

## 1. Read Contract State

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/read-contract-state/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/read-contract-state
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `bin/pharos-read.js`)
- **What the proof shows:** Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.

Requirements it was built against (the Arena's own list):

1. Reads at least 3 different values from one contract via Chain MCP (e.g. name, totalSupply, owner, a balance).
2. Shows the contract address and the block number the data was read at.
3. Formats raw values for humans: token decimals applied, addresses labelled.
4. Includes a short README: which contract you chose, how to run it, sample output.

## 2. Event/Log Monitor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/event-log-monitor/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/event-log-monitor
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `bin/pharos-watch.js`)
- **What the proof shows:** Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.

Requirements it was built against (the Arena's own list):

1. Uses Chain MCP log queries filtered by contract address and event signature.
2. Runs continuously (polling or block-by-block) and reports only new events, with no duplicates.
3. Decodes each event into readable fields (from, to, amount, tx hash, block).
4. Demonstrated catching at least one live or test event.

## 3. Docs MCP Onboarding

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `bin/pharos-onboard.js`)
- **What the proof shows:** Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.

Requirements it was built against (the Arena's own list):

1. A step-by-step log of what you tried to do, the questions you asked Docs MCP, and the answers you got.
2. At least 3 concrete gaps or breakdowns (wrong, missing, or confusing answers), each with the exact query.
3. A suggested fix for each gap: what the docs should have said.
4. Ends with what you managed to build or run by the end.

## 4. Doc-Search CLI

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/doc-search-cli/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/doc-search-cli
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `bin/pharos-docs.js`)
- **What the proof shows:** Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.

Requirements it was built against (the Arena's own list):

1. Accepts a natural-language question as input, e.g. `pharos-docs "how do I deploy a contract?"`.
2. Returns a concise answer plus links or references to the source doc sections.
3. Handles "no good answer found" gracefully instead of inventing one.
4. README with install and usage instructions and 3 example queries with outputs.

## 5. Threshold Guardian

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/threshold-guardian/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/threshold-guardian
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-threshold-guardian/`)
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0xfd9df7e9dfefb2d0c67b5717d739aa840e6c333fbfd5e8ab7a5425fdc7d4695d
- **What the proof shows:** Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.

Requirements it was built against (the Arena's own list):

1. Evaluates at least 3 independent conditions read from chain.
2. Conditions and thresholds are configurable, not hard-coded.
3. Logs a clear decision trace each run: each condition's value, pass/fail, and the final decision.
4. Demonstrates both outcomes: one run where it fires and one where it holds.

## 6. Saga Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/saga-executor/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/saga-executor
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-saga-executor/`)
- **What the proof shows:** Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo).

Requirements it was built against (the Arena's own list):

1. At least 3 dependent steps, each verified (receipt checked) before the next starts.
2. A defined retry policy for transient failures, e.g. a gas spike or dropped transaction.
3. A defined compensation/rollback path when a step permanently fails, and a demo of it.
4. A state log showing exactly which step the saga is in at any time.
5. Shows one fully successful run and one forced-failure run with recovery.

## 7. Arbitrage Scanner

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-arbitrage-scanner/`)
- **What the proof shows:** Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.

Requirements it was built against (the Arena's own list):

1. Reads prices from at least 2 sources in the same scan.
2. Calculates net profit after swap fees, slippage estimate, and gas.
3. Acts (or prepares the transaction) only above a configurable profit threshold; otherwise logs why it skipped.
4. Logs every scan with gross spread, costs, net result and decision.
5. Works safely on testnet or with simulated execution; no requirement to risk real funds.

## 8. Dry-Run Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/dry-run-executor/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/dry-run-executor
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-dry-run-executor/`)
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x79363e34be685e5bff405cd648ab3c68a6a27243ca0905cc50f644003f2fd565
- **What the proof shows:** Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.

Requirements it was built against (the Arena's own list):

1. Uses a call or gas estimation to simulate the transaction without broadcasting it.
2. Reports predicted success or revert, including the revert reason when available, and estimated gas cost.
3. Shows the expected outcome, e.g. balances or state before and after where possible.
4. Blocks execution automatically if the simulation fails.

## 9. Trend Watcher

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/trend-watcher/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/trend-watcher
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-trend-watcher/`)
- **What the proof shows:** Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.

Requirements it was built against (the Arena's own list):

1. Stores state between runs: persistent storage, not just in-memory.
2. Trend rule needs at least 3 observations to trigger and is configurable.
3. Handles restarts without losing or duplicating history.
4. Shows the stored history and the exact moment the trend condition was met.
5. Demonstrates that a single spike does not trigger it.

## 10. Batch Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/batch-executor/try
- **Task page, with the story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/batch-executor
- **Repo link:** https://github.com/moltaphet/pharos-agent-kit  (code: `skills/pharos-batch-executor/`)
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x37fd3313534ab882ddc5f5e35ebdc8f5efb5aee62474dd2e352fc9bfec0e34e3
- **What the proof shows:** Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.

Requirements it was built against (the Arena's own list):

1. Accepts a list of at least 3 independent actions.
2. Executes them as a batch: multicall, a single prepared transaction, or an equivalent.
3. Reports the gas saving or step reduction compared with running them individually.
4. Handles partial failure clearly: which action failed and what happened to the rest.

---

Not included: the optional walkthrough video. Record one per task if you want it.
