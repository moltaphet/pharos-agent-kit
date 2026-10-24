# Submission pack

Everything to paste into the Arena's submit form, per task. Repository: https://github.com/moltaphet/pharos-agent-kit (public, MIT). Site: https://pharos-agent-kit.vercel.app

The same content is split per task in [submission/](submission/README.md). Every task has its own folder with a README (requirements, how each is met, run commands, dependencies, tests).

For every task the proof is the **deployed demo link** below (it runs against Pharos, or against a real mainnet fork or Atlantic testnet, and shows an exact run log), plus the **repo link** to the task’s folder. Where real testnet transactions exist, an explorer link is listed too.

The testnet transactions were sent from `0x0eC197b8A30543c93e521a6C3F2DB5d110e60850` (a throwaway wallet that only holds test tokens) on 2026-10-23; the pages re-read each one from the chain every time they load.

## 1. Read Contract State

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/read-contract-state/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/read-contract-state
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/read-contract-state
- **What the proof shows:** Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.

Requirements it was built against (the Arena's own list):

1. Reads at least 3 different values from one contract via Chain MCP (e.g. name, totalSupply, owner, a balance).
2. Shows the contract address and the block number the data was read at.
3. Formats raw values for humans: token decimals applied, addresses labelled.
4. Includes a short README: which contract you chose, how to run it, sample output.

## 2. Event/Log Monitor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/event-log-monitor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/event-log-monitor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/event-log-monitor
- **What the proof shows:** Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.

Requirements it was built against (the Arena's own list):

1. Uses Chain MCP log queries filtered by contract address and event signature.
2. Runs continuously (polling or block-by-block) and reports only new events, with no duplicates.
3. Decodes each event into readable fields (from, to, amount, tx hash, block).
4. Demonstrated catching at least one live or test event.

## 3. Docs MCP Onboarding

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/docs-mcp-onboarding
- **What the proof shows:** Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.

Requirements it was built against (the Arena's own list):

1. A step-by-step log of what you tried to do, the questions you asked Docs MCP, and the answers you got.
2. At least 3 concrete gaps or breakdowns (wrong, missing, or confusing answers), each with the exact query.
3. A suggested fix for each gap: what the docs should have said.
4. Ends with what you managed to build or run by the end.

## 4. Doc-Search CLI

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/doc-search-cli/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/doc-search-cli
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/doc-search-cli
- **What the proof shows:** Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.

Requirements it was built against (the Arena's own list):

1. Accepts a natural-language question as input, e.g. `pharos-docs "how do I deploy a contract?"`.
2. Returns a concise answer plus links or references to the source doc sections.
3. Handles "no good answer found" gracefully instead of inventing one.
4. README with install and usage instructions and 3 example queries with outputs.

## 5. Threshold Guardian

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/threshold-guardian/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/threshold-guardian
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-threshold-guardian
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0xfd9df7e9dfefb2d0c67b5717d739aa840e6c333fbfd5e8ab7a5425fdc7d4695d
- **What the proof shows:** Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.

Requirements it was built against (the Arena's own list):

1. Evaluates at least 3 independent conditions read from chain.
2. Conditions and thresholds are configurable, not hard-coded.
3. Logs a clear decision trace each run: each condition's value, pass/fail, and the final decision.
4. Demonstrates both outcomes: one run where it fires and one where it holds.

## 6. Saga Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/saga-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/saga-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-saga-executor
- **What the proof shows:** Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo).

Requirements it was built against (the Arena's own list):

1. At least 3 dependent steps, each verified (receipt checked) before the next starts.
2. A defined retry policy for transient failures, e.g. a gas spike or dropped transaction.
3. A defined compensation/rollback path when a step permanently fails, and a demo of it.
4. A state log showing exactly which step the saga is in at any time.
5. Shows one fully successful run and one forced-failure run with recovery.

## 7. Arbitrage Scanner

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/arbitrage-scanner
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-arbitrage-scanner
- **What the proof shows:** Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.

Requirements it was built against (the Arena's own list):

1. Reads prices from at least 2 sources in the same scan.
2. Calculates net profit after swap fees, slippage estimate, and gas.
3. Acts (or prepares the transaction) only above a configurable profit threshold; otherwise logs why it skipped.
4. Logs every scan with gross spread, costs, net result and decision.
5. Works safely on testnet or with simulated execution; no requirement to risk real funds.

## 8. Dry-Run Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/dry-run-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/dry-run-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-dry-run-executor
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x79363e34be685e5bff405cd648ab3c68a6a27243ca0905cc50f644003f2fd565
- **What the proof shows:** Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.

Requirements it was built against (the Arena's own list):

1. Uses a call or gas estimation to simulate the transaction without broadcasting it.
2. Reports predicted success or revert, including the revert reason when available, and estimated gas cost.
3. Shows the expected outcome, e.g. balances or state before and after where possible.
4. Blocks execution automatically if the simulation fails.

## 9. Trend Watcher

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/trend-watcher/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/trend-watcher
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-trend-watcher
- **What the proof shows:** Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.

Requirements it was built against (the Arena's own list):

1. Stores state between runs: persistent storage, not just in-memory.
2. Trend rule needs at least 3 observations to trigger and is configurable.
3. Handles restarts without losing or duplicating history.
4. Shows the stored history and the exact moment the trend condition was met.
5. Demonstrates that a single spike does not trigger it.

## 10. Batch Executor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/batch-executor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/batch-executor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-batch-executor
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x37fd3313534ab882ddc5f5e35ebdc8f5efb5aee62474dd2e352fc9bfec0e34e3
- **What the proof shows:** Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.

Requirements it was built against (the Arena's own list):

1. Accepts a list of at least 3 independent actions.
2. Executes them as a batch: multicall, a single prepared transaction, or an equivalent.
3. Reports the gas saving or step reduction compared with running them individually.
4. Handles partial failure clearly: which action failed and what happened to the rest.

## 11. Policy Gatekeeper

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/policy-gatekeeper
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-policy-gatekeeper
- **Explorer proof (real testnet transaction):** https://atlantic.pharosscan.xyz/tx/0x6dfe7b23afd362bf2119c0b651db91af61c33ef7f5573c945b46e9feabedd79f
- **What the proof shows:** Policy (spend limit, allowlist, time window) in front of a real wallet: 2 requests allowed and sent on Atlantic, 6 denied by named rules and never sent; the chain confirms it. Hash-chained audit log, re-verified on load.

Requirements it was built against (the Arena's own list):

1. A policy file or config with at least 3 rule types: spend limit, allowlist, time window.
2. Every request returns allow or deny with the specific rule that decided it.
3. Denied actions are never executed. Shows at least one deny per rule type.
4. Keeps an audit log of all decisions.

## 12. Skill + Chain MCP Flow

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-transfer-preflight
- **What the proof shows:** One sentence runs Chain MCP and two Skills end to end on Pharos mainnet; the same request is READY at a Thursday block and STOP at a Saturday block because the chain’s clock decides. Five recorded runs pinned to blocks, replayable.

Requirements it was built against (the Arena's own list):

1. The Skill's output depends on live data fetched via Chain MCP in the same flow.
2. The flow runs end to end from a single user request.
3. A diagram or short write-up of the flow: what calls what, and in what order.
4. A demo run showing real data moving through both tools.

## 13. Docs MCP + Chain MCP Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/docs-chain-mcp-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/docs-chain-mcp-agent
- **What the proof shows:** Explains a contract function from Developer Docs MCP (with sources), calls it on Pharos mainnet through Chain MCP, reads the value the way the docs say, cross-checked against decimals(), and confirms every read on the public RPC. Five recorded real cases pinned to a block, replayable.

Requirements it was built against (the Arena's own list):

1. The explanation comes from Docs MCP, with sources referenced.
2. The agent then calls the same function on chain via Chain MCP.
3. Interprets the result in the context of the explanation.
4. Works for at least 2 different functions or contracts.

## 14. Portfolio Assistant

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/portfolio-assistant/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/portfolio-assistant
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-portfolio-assistant
- **What the proof shows:** Answers eight kinds of plain-English question about a wallet from native PROS, USDC, WPROS and the four R25 / RockawayX vaults at one pinned block; every figure carries its contract, call and block, every read is repeated on the public RPC, and what it cannot know (other protocols, earnings since depositing) is refused. Recorded real wallets pinned to a block, replayable.

Requirements it was built against (the Arena's own list):

1. Reads positions from at least 2 protocols or vaults, plus wallet token balances.
2. Answers at least 5 different natural-language question types correctly.
3. Shows numbers with sources: which contract and block each figure came from.
4. Says clearly when it doesn't know or can't read a protocol, rather than guessing.
5. Read-only: never initiates transactions.

## 15. Yield Optimizer

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/yield-optimizer/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/yield-optimizer
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-yield-optimizer
- **What the proof shows:** Compares the four USDC vaults on measured yield, tests with simulations whether the wallet can get in and out, counts gas measured by really executing the steps on a mainnet fork plus fees, and answers MOVE (with unsigned transactions) or STAY PUT with the reason. Recorded decisions pinned to a block, replayable.

Requirements it was built against (the Arena's own list):

1. Compares at least 3 yield sources using live on-chain data.
2. Accounts for gas, entry/exit fees, and a minimum holding period before recommending a move.
3. Outputs a clear recommendation with expected net gain, or "stay put" with the reason.
4. If executing: prepares transactions for user signature only. The agent never holds keys.

---

Not included: the optional walkthrough video. Record one per task if you want it.
