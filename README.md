# pharos-agent-kit

Thirty working builds for the [Pharos Agent Arena](https://pharos-agent-arena.vercel.app/#tasks)
**Season of AI** tasks, plus a site where each one can be tested and inspected:
**https://pharos-agent-kit.vercel.app**

Per-task proof links, repo links and the requirements each task was built against: [SUBMISSION.md](SUBMISSION.md).

**Every task has its own folder** (the third column), and each folder has a README that maps the Arena's requirements to where they are met, lists the shared code it imports and the tests that cover it. Shared code stays in `lib/`, so every task runs from a plain clone. The links to paste into the Arena's form are in [submission/](submission/README.md).

| # | Task | Run it | Real data? | Execution |
|---|---|---|---|---|
| 1 | Read Contract State | `node agents/read-contract-state/pharos-read.js` | Pharos mainnet | read-only |
| 2 | Event/Log Monitor | `node agents/event-log-monitor/pharos-watch.js` | Pharos mainnet | read-only |
| 3 | Docs MCP Onboarding | `node agents/docs-mcp-onboarding/pharos-onboard.js` | Docs MCP + mainnet + Atlantic checks | read-only |
| 4 | Doc-Search CLI | `node agents/doc-search-cli/pharos-docs.js "how do I deploy a contract?"` | Docs MCP | read-only |
| 5 | Threshold Guardian (Skill) | `skills/pharos-threshold-guardian/` | Pharos mainnet | decides only; shown acting for real on Atlantic testnet (FIRE sends a transaction, HOLD sends nothing) |
| 6 | Saga Executor (Skill) | `skills/pharos-saga-executor/` | real contracts on a mainnet fork | real EVM transactions on a fork, on demand (fake funds); its retry and undo rules are also proved with 16 real transactions on Atlantic testnet |
| 7 | Arbitrage Scanner (Skill) | `skills/pharos-arbitrage-scanner/` | FaroSwap V2 and V3 pools | live scan decides (nothing sent); the act path runs for real on a fork, on demand (`scripts/arb-fork-run.mjs`) |
| 8 | Dry-Run Executor (Skill) | `skills/pharos-dry-run-executor/` | Pharos mainnet | simulates only; its predictions are checked against real Atlantic testnet transactions |
| 9 | Trend Watcher (Skill) | `skills/pharos-trend-watcher/` | Pharos mainnet history | read-only (+ state file) |
| 10 | Batch Executor (Skill) | `skills/pharos-batch-executor/` | Pharos mainnet | prepared, unsigned; its plan is checked against real Atlantic testnet transactions |
| 11 | Policy Gatekeeper (Skill) | `skills/pharos-policy-gatekeeper/` | Chain MCP for the clock; Atlantic testnet for the real run | decides and logs only; in front of a real testnet wallet it allowed 2 requests (sent) and denied 6 (never sent), and the chain confirms it |
| 12 | Skill + Chain MCP Flow (Skill) | `skills/pharos-transfer-preflight/` | Pharos mainnet through Chain MCP | prepares an unsigned transfer after the Policy Gatekeeper and Dry-Run Executor Skills agree; sends nothing; five recorded runs pinned to mainnet blocks can be replayed |
| 13 | Docs MCP + Chain MCP Agent | `agents/docs-chain-mcp-agent/` | Developer Docs MCP + Pharos mainnet through Chain MCP | read-only: explains a function from the docs, calls it with eth_call, reads the value the way the docs say; sends nothing |
| 14 | Portfolio Assistant (Skill) | `skills/pharos-portfolio-assistant/` | Pharos mainnet through Chain MCP, every read repeated on the public RPC | read-only: answers eight kinds of question about a wallet (PROS, USDC, WPROS and four vaults) with each figure's contract, call and block; refuses what it cannot know |
| 15 | Yield Optimizer (Skill) | `skills/pharos-yield-optimizer/` | Pharos mainnet; gas measured on a mainnet fork | read-only: measures the four vaults' real yield, tests entry and exit by simulation, counts gas and fees, answers MOVE (unsigned transactions) or STAY PUT with the reason |
| 16 | Liquidation Watchdog | `agents/liquidation-watchdog/` | Morpho Blue on Pharos mainnet through Chain MCP, every read repeated on the public RPC | read-only: health factor the way Morpho decides it, warn and critical alerts with the amount to repay or add; checked against the real Morpho on a fork |
| 17 | Natural-Language Payment Agent | `agents/natural-language-payment-agent/` | Pharos mainnet through Chain MCP | prepares an unsigned transaction from a sentence, or asks; never signs or sends |
| 18 | Recurring Payment Agent | `agents/recurring-payment-agent/` | Pharos mainnet; the whole lifecycle on a mainnet fork | prepares each due payment unsigned; paid, pending and failed come from the chain; never twice |
| 19 | Invoice-to-Payment Agent | `agents/invoice-to-payment-agent/` | Pharos mainnet through Chain MCP | flags instead of guessing; prepares an unsigned payment carrying the invoice reference |
| 20 | x402 Paywalled API | `agents/x402-paywalled-api/` | Pharos Atlantic testnet (eip155:688689), real HTTP and real settlements | two paid routes and one free, its own facilitator and client; the settlements are real Atlantic transactions |
| 21 | x402 Agent Buyer | `agents/x402-agent-buyer/` | Pharos Atlantic testnet (eip155:688689), real HTTP and real settlements against task 20's server | buys from a plan under a per-call cap and a total budget; three recorded jobs (completed, stopped by the budget, skipped as not worth it) with four real settlements, each read back from the chain; the same authorization is retried, never a new one |
| 22 | On-Chain Alert Bot | `agents/on-chain-alert-bot/` | Pharos mainnet (price feed, USDC/WPROS transfers, contract events and calls) | read-only; delivers to Discord, Telegram, ntfy or a webhook, once per event and channel, and loses nothing when a channel is down; delivery recorded over real HTTP to local receivers |
| 23 | Whale-Watching Agent | `agents/whale-watching-agent/` | Pharos mainnet | read-only: a watchlist, per-token and dollar thresholds, each move explained, position changes and a summary across all addresses |
| 24 | Gas Fee Optimizer | `agents/gas-fee-optimizer/` | Pharos mainnet and Atlantic testnet gas history; four real transactions on Atlantic | holds a transaction until gas is favourable or its deadline and always submits by it; prices it with EIP-1559 fields (1 gwei paid where the quoted price would have cost 10); mainnet is only read and prepared |
| 25 | Wallet Risk Checker | `agents/wallet-risk-checker/` | Pharos mainnet; a deliberately risky token and a fresh wallet created on Atlantic testnet | read-only: eight signals, low, medium or high with every flag in plain language; recorded for two clean, one in-between and two risky examples |
| 26 | Audit-Log Agent | `agents/audit-log-agent/` | Pharos mainnet, three real wallets over one day | read-only: transfers in and out, swaps, approvals and contract interactions with totals and notable transactions; exported as Markdown, CSV and PDF |
| 27 | dApp Support Agent | `agents/dapp-support-agent/` | Chain MCP on mainnet; 13 real failed transactions (4 mainnet, 9 made to fail on purpose on Atlantic) | read-only: replays the failed call, names the cause (11 kinds) in plain words with the numbers, and says what to do |
| 28 | Weekly Digest Agent | `agents/weekly-digest-agent/` | Pharos mainnet, a week against the week before | read-only: 14 key numbers with the comparison, three notable events, delivered once per channel and published as a page; a Vercel cron runs it on Mondays |
| 29 | Doc-Grounded Builder Agent | `agents/doc-grounded-builder-agent/` | Developer Docs MCP + Chain MCP (mainnet); a transfer and a deployment signed on Atlantic testnet | plans from the docs with cited sources, acts through Chain MCP, verifies on chain; funds are only prepared for signature; refuses what the docs do not cover |
| 30 | Multi-Protocol Aggregator | `agents/multi-protocol-aggregator/` | Pharos mainnet: R25, Morpho Vault V2 and Morpho Blue | read-only: one interface over five venues of three protocols, each request routed with the reasons, unsigned transactions with a simulation, and an outage of one protocol leaves the others working; architecture write-up in `docs/` |

**Safety.** The skills in `skills/` never take a key: they read, simulate, or prepare unsigned transactions. Nothing in
this repository sends a transaction to Pharos **mainnet**. Real execution happens on throwaway forks and Atlantic testnet; neither involves real money:

1. **Throwaway forks of mainnet** (tasks 6 and 7): anvil forks Pharos, the contracts are the live ones, the funds are fake,
   and the transactions exist only on that fork. On the site every click runs one inside a throwaway Vercel Sandbox (see
   below); the CLIs run it on your own machine (needs Foundry). There is no simulator.
2. **Pharos Atlantic testnet** (tasks 5, 8, 10, 11, 20, 21, 24, 25, 27 and 29): `scripts/testnet-run.mjs`, `scripts/testnet-guardian.mjs` and `scripts/testnet-gatekeeper.mjs` send real transactions from a throwaway wallet that
   only ever holds test tokens. Its key lives in a git-ignored file, is never printed or committed, and the script refuses to
   send unless the chain id is 688689 (so it cannot reach mainnet) and stops past a small gas budget. The key is not used by
   any skill. Task 21 is an opt-in CLI buyer: it loads a payer key from your environment or an ignored local file and checks a per-call cap and total test-token budget before signing. Tasks 29 and 30 and the wallet and gas agents only read or prepare unsigned transactions. The website holds no key at all: it only re-reads recorded transactions from the chain.

The command-line tools have no dependencies, no API keys and no build step; they need **Node.js 20+**. The web
hub has one dependency, `@vercel/sandbox`, used only by the Saga Executor's live demo.

```bash
git clone https://github.com/moltaphet/pharos-agent-kit && cd pharos-agent-kit
node agents/read-contract-state/pharos-read.js
node agents/event-log-monitor/pharos-watch.js
node agents/doc-search-cli/pharos-docs.js "how do I deploy a contract?"
npm test                          # offline unit tests (no network)
npm run web                       # the site at http://localhost:3000
node scripts/audit-static.mjs     # requirements vs evidence, skill template lint
node scripts/audit-live.mjs https://pharos-agent-kit.vercel.app   # live checks of every task
```

The six **Skills** follow the Pharos Skill Engine format: `SKILL.md` with a Capability Index,
`references/<skill>.md` (command, parameters, output parsing, errors, agent guidelines for every
section), `scripts/`, `assets/` and `examples/`. `scripts/audit-static.mjs` checks that.

## Things we found about the platform

- **The Pharos node sometimes answers a historical `eth_call` with another block's value.**
  About 10% of parallel historical reads on the public RPC (4 of 40), and occasionally even a single
  call; the same wrong value appeared through Chain MCP, so it is the node. What we do about it
  (we cannot fix the node, only detect it):
  - **Every read pinned to a block is confirmed** (`lib/confirm.js`): the web API wraps the Chain MCP
    client so a call, balance, code, header or gas estimate at a block number is read twice in a row.
    Two equal answers are accepted; if they differ a third read decides by majority; with no majority
    the request fails with "the node is inconsistent" instead of showing a value that might be wrong.
    Reads of `latest` are not confirmed, since they legitimately change.
  - Series of past blocks (Trend Watcher, the vault condition of Threshold Guardian) read one at a
    time and accept a value only when two reads agree (`lib/stable.js`).
  - Read Contract State also replays every call against the public RPC; if the RPC's first answer
    differs, it is re-read twice before anything is called a mismatch (`lib/crosscheck.js`).
  - Every disagreement is recorded in the run log as a decision, so it is visible, not hidden.
- **The Chain MCP is load-balanced across nodes that do not all have the newest block.** At the head that
  `get_block_number` had just reported, `get_code` failed with `block is not available` (about 1 request in 10),
  and a lagging node answered `get_code` with an *empty* result for a contract that has code, which two repeated
  reads then agreed on (USDC was once reported as "no contract code"). What we do: every task pins reads two blocks
  behind the head (`lib/chain.js`), the client retries `block is not available` a few times, and Read Contract State
  checks the latest block before it ever says "wallet" (`lib/snapshot.js`).
- **Rate limits are low and shared.** The Chain MCP allows 120 requests a minute per IP and answers a burst with
  HTTP 429 and a 27 s `Retry-After`; the public RPC rejects more than a few requests a second ("cu limit exceeded").
  Reading one contract took about 30 requests once every read was confirmed, so token fields, balances and the RPC
  replay now go through one Multicall3 request each (about 16 requests), clients run at most 3 calls at once, and
  every API request answers within 55 seconds even if an upstream is slow (`lib/limit.js`, `lib/server.js`).
- **`eth_estimateGas` can undershoot on nested calls.** A redeem from the RockawayX vault (which withdraws from a lending market) ran out of gas on a limit that was estimated exactly (263,262 used of 263,262) and reverted with no reason, while the same call succeeded as `eth_call`. Its gas use had also nearly doubled (144k to 273k) between two recordings a few hours apart. Always add headroom (our fork harness adds 30%).
- The Chain MCP server exposes **14** tools (including `send_raw_transaction`), is stateful (it needs
  an `initialize` handshake) and sends no CORS headers, so a browser cannot call it directly.
- `docs.pharos.xyz` and the faucet, `llms.txt`, Skill Engine install and x402 mainnet pages have gaps
  documented in `reports/docs-mcp-onboarding.md`.

## Web hub

`public/` + `api/` is a small site for testing the agents. A menu lists all 30 tasks,
grouped by category, and every task has its own page and URL (`/#/read-contract-state`).
Each section of a page has its own link too, e.g. `/#/read-contract-state/try`,
`/#/event-log-monitor/verify`, so you can point someone at exactly the part you mean.

For a task that is built, the page has:

- **The story**: what was built and why, in plain language.
- **Try it live**: a real run against Pharos mainnet, and a **run log** under it. The log
  records every step: each Chain MCP / Docs MCP / RPC call with its tool, arguments, raw
  response and timing (as a waterfall), plus how values were decoded and what was decided.
  It can be filtered, copied or downloaded as JSON.
- **Requirements**: the official list, with how this build meets each one.
- **How it works**, **Decisions** (including bugs found and fixed), **Run it yourself**
  and **Verify independently** (block explorer, public RPC, reproducible commands).

**The Saga demo is a real run.** Vercel's functions cannot run anvil, so each click starts a Vercel Sandbox (an
ephemeral Firecracker microVM) from a snapshot that has Foundry 1.4.0 installed, uploads the engine, forks
Pharos mainnet inside it and executes the saga as real EVM transactions. The page polls the machine and streams
the state log as it happens (about 30 seconds). Guardrails (`lib/saga-sandbox.js`): four fixed scenarios and a
retry limit of 1 to 5 are the only inputs, and none reaches a command line; the machine may only reach
`rpc.pharos.xyz`, lives at most 6 minutes; at most 2 run at once, a visitor has one run at a time with 15 seconds between
runs, and there is an hourly cap of 40 (all read from the Sandbox listing, with a hashed visitor id, so they hold across
server instances).
Sandbox time is billed to the Vercel team that owns the project. Rebuild the snapshot (it never expires, but
Foundry may need updating) with `vercel env pull .env.local && node --env-file=.env.local scripts/build-saga-snapshot.mjs`.

**The Arbitrage act path is a real run too.** Same machinery (`lib/sandbox-run.js`): a Sandbox forks Pharos mainnet,
re-prices the dust V2 pair and adds liquidity to both FaroSwap venues with real swaps and mints, makes a gap with another real
swap, lets the real scanner decide, and executes both legs through `contracts/ArbLab.sol` (committed precompiled, because the
sandbox cannot download a compiler; a test fails if the bytecode and the source drift apart). The page shows the predicted and
the real profit side by side. No synthetic data is offered anywhere on the site.

**Real transactions on Atlantic testnet.** The Threshold Guardian, Dry-Run Executor and Batch Executor pages open with a card of
transactions that were really sent on Pharos Atlantic testnet (`scripts/testnet-run.mjs --live`, report in
`reports/testnet-runs.json`) from a throwaway wallet that only ever holds test tokens. The card does not ask to be trusted:
when it loads, the API re-reads every transaction from the public Atlantic RPC and shows a green check only where the chain
still agrees on status, gas used, block and value (`lib/testnet-report.js`). Without `--live` the script rehearses on a free
local fork of Atlantic. The wallet's key lives in `.wallet/` (git-ignored) and is never printed or committed; the script
refuses to send unless the chain id is 688689, so it cannot reach mainnet, and stops past a gas budget.

The header shows live status of the three upstream services. Run links such as
`/#/doc-search-cli/try?q=how+do+I+deploy+a+contract&run=1` re-run a demo when opened.

How it is put together:

- `api/*.js` are thin server routes. Browsers can't call the MCP servers directly (they
  send no CORS headers), so a route calls them and returns `{ ok, data, trace }`. The
  trace is recorded per request with `AsyncLocalStorage` (`lib/trace.js`). They run as
  Vercel functions, or locally through `dev-server.js`.
- `api/read.js` also replays every `eth_call` against the public RPC at the same block and
  compares the raw bytes (`lib/crosscheck.js`), so the MCP layer is checked independently.
- The task list comes from the public task pages (`npm run registry` re-scrapes it into
  `public/registry.json`). What has been built, and the story for each task, lives in
  `public/js/content.js`.

### Adding the next task

1. Put the logic in `lib/` (pure, testable), the task's own folder in `agents/<slug>/` (a CLI) or `skills/pharos-<slug>/` (a Skill), and register the task in `scripts/task-map.mjs` so its README and submission page are generated.
2. Add an API route in `api/` if the page needs server access to an upstream service.
   Give each call a `{ why }` so it reads well in the log.
3. Add a panel in `public/js/panels/` and register it in `PANELS` in `public/js/views.js`.
4. Add its story, flow, decisions and checks to `LIVE` in `public/js/content.js`.

Endpoints used (both public, no auth):

- Chain MCP: `https://mcp.pharos.xyz/mcp` (Pharos mainnet, chain ID 1672, 120 req/min/IP)
- Developer Docs MCP: `https://docs.pharos.xyz/~gitbook/mcp`

All three share one small MCP client (`lib/mcp.js`) that speaks Streamable HTTP and
copes with the realities of the hosted servers: SSE-framed replies, `429`/`503`
back-off using `Retry-After`, request timeouts, load-balancer cookies, re-initialising
if the server forgets the session, and closing its session when it's done (the
Chain MCP server keeps sessions in memory and sometimes reports
`Server at session capacity`; the CLIs print a `note:` and retry instead of hanging).

---

## 1. `pharos-read` — Read Contract State

Reads live state from a deployed Pharos contract through Chain MCP and prints it in
plain language. Default contract: **USDC on Pharos mainnet**
(`0xc879c018db60520f4355c26ed1a6d572cdac1815`), but any ERC-20-style contract works.

```bash
pharos-read [contract] [--holder 0x…]… [--block N] [--label 0x…=Name]… [--json]
```

How it maps to the task requirements:

1. **≥ 3 values from one contract** — `name`, `symbol`, `decimals`, `totalSupply`,
   `owner` (and `balanceOf` per `--holder`), each an `eth_call` via Chain MCP.
2. **Contract address + block number** — shown in the header. The block is read first
   and every call is pinned to it, so all values describe the same moment.
3. **Human formatting** — token decimals applied and thousands grouped (raw value kept
   alongside); addresses are labelled from the official Pharos token/contract
   registry, or as `wallet` vs `contract` (via `get_code`), or with your own `--label`.
4. **README** — this section.

Contracts that don't implement a function (e.g. no `owner()`) show `n/a` rather than
failing.

Sample output (real run, Pharos mainnet):

```text
$ pharos-read --holder 0x768b959191ce5876cabbbc014a08d72615bdde54 \
              --label 0x768b959191ce5876cabbbc014a08d72615bdde54="Frequent USDC sender"

Pharos contract snapshot
────────────────────────────────────────────────────────────
  Contract       USDC
  Address        0xc879c018db60520f4355c26ed1a6d572cdac1815
  Network        Pharos · chain 1672
  Read at        block 20,911,225 · 2026-10-22 08:07:21 UTC
  Code size      1,798 bytes

Values read via Chain MCP (eth_call at that block)
  name           USDC
  symbol         USDC
  decimals       6
  totalSupply    39,689,691.355769 USDC   (raw 39689691355769)
  owner          wallet (no contract code)  0x9f8e…4d92
  balanceOf      Frequent USDC sender  0x768b…de54 → 366.45403 USDC
```

A contract without `owner()` (WPROS, 18 decimals):

```text
$ pharos-read 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0
  Contract       Wrapped PROS (WPROS)
  totalSupply    22,160,980.930709 WPROS   (raw 22160980930709249062054483)
  owner          n/a (contract has no owner())
```

`--json` prints the same data as one JSON object.

---

## 2. `pharos-watch` — Event/Log Monitor

Watches a contract for one event and prints each new occurrence exactly once. It keeps
running until you press Ctrl-C (or hit `--max-events` / `--duration`).

```bash
pharos-watch [contract] [--event Transfer|Approval|Deposit|Withdrawal | --topic0 0x…]
             [--interval 3] [--from-block N] [--max-events N] [--duration SEC]
             [--label 0x…=Name]… [--json]
```

How it maps to the task requirements:

1. **Chain MCP log queries filtered by address + event signature** — every poll calls
   `get_logs` with `address` and `topics: [topic0]`. Built-in events use their
   canonical `topic0` hashes; `--topic0` accepts any other event (printed raw).
2. **Continuous, new events only, no duplicates** — polls `get_block_number`, then scans
   `[last_scanned + 1, head]` in windows of ≤ 1000 blocks (the server's cap), re-reading
   the last 2 blocks each time so a late log is still caught. A log is identified by
   `txHash:logIndex` and de-duplicated, so the overlap never prints anything twice; a
   failed poll retries the same window instead of skipping it. By default it starts from *now*; `--from-block N`
   backfills first.
3. **Decoded fields** — from, to, amount (decimals + symbol applied), tx hash, block,
   and block time. ERC-721 transfers (4 topics) show `tokenId` instead of an amount.
4. **Caught live events** — see below.

Sample output (real run, live mainnet events, caught as they were produced):

```text
$ pharos-watch --max-events 3 --interval 2
Watching Transfer on USDC 0xc879c018db60520f4355c26ed1a6d572cdac1815
Starting at block 20,911,107 (chain head 20,911,106), polling every 2s. Ctrl-C to stop.

[08:05:45 UTC] block 20,911,114  Transfer   0x946d…4cef → 0x5dbb…ed3e  3.984048 USDC
    tx 0x3c12c6e64af3b2ff18d75b11ffdaff6e339ccdef0bf7950329760ed2413895b8
[08:05:47 UTC] block 20,911,116  Transfer   0x9b1e…6be8 → 0x768b…de54  104.74 USDC
    tx 0x7268fa6b43e02a509b302850313bfa1656edbac8ad2458c2698a65e7c8c3c548
[08:05:47 UTC] block 20,911,116  Transfer   0x9365…b470 → 0x912c…f647  76.493109 USDC
    tx 0x4fb1291fcfb6587739d7f754392677d7c6bfb6dbad65c718af8cf5a8b79bd02c

Stopped after 3 events; last scanned block 20,911,116.
```

Backfill across several 1000-block windows, one JSON object per line
(`pharos-watch 0x52c4…f0b0 --event Deposit --from-block <head-2500> --json`):

```json
{"event":"Deposit","block":20908678,"timestamp":1792654199,"txHash":"0x6457…a9aa","logIndex":0,"contract":"0x52c48d4213107b20bc583832b0d951fb9ca8f0b0","to":"0xf48ff1e0abc740c167049c46435e753b083bc317","amount":{"raw":"16740000000000000000","formatted":"16.74","symbol":"WPROS"}}
```

---

## 3. `pharos-docs` — Doc-Search CLI

Ask the Pharos docs a question from your terminal and get a concise answer with the
pages it came from, via Developer Docs MCP (`askQuestion` + `searchDocumentation`).

```bash
pharos-docs "<question>" [--sources N] [--json]
```

How it maps to the task requirements:

1. **Natural-language input** — `pharos-docs "how do I deploy a contract?"`.
2. **Concise answer + sources** — the answer, then numbered source pages. Pages the
   answer itself links to are listed first, then keyword-search hits.
3. **Graceful "no good answer"** — the server's `askQuestion` lists *some* sources even
   for nonsense questions, so sources alone prove nothing. The CLI reports "no good
   answer" when the answer says it can't find the information, or when nothing in the
   docs matches; it then prints the closest pages, clearly labelled as *not* an
   answer, and exits with code `2`. It never invents an answer.
4. **README with 3 example queries** — below (all real output).

Exit codes: `0` answer found · `2` no good answer · `1` error.

### Example 1

```text
$ pharos-docs --sources 3 "What are the chain ID and RPC URL for Pharos mainnet?"

Q: What are the chain ID and RPC URL for Pharos mainnet?

Pharos Pacific Mainnet uses:

* **Chain ID:** `1672`
* **RPC URL:** `https://rpc.pharos.xyz`

See [Pacific Mainnet](https://docs.pharos.xyz/getting-started/network/pacific-mainnet).

Sources
  1. Pacific Mainnet  (cited in the answer)
     https://docs.pharos.xyz/getting-started/network/pacific-mainnet
  2. Cross Chain Infrastructure  (related)
     https://docs.pharos.xyz/tooling-and-infrastructure/cross-chain
  3. ZAN RPC  (related)
     https://docs.pharos.xyz/tooling-and-infrastructure/rpc/zan
```

### Example 2

```text
$ pharos-docs --sources 3 "How do I become a validator?"

Q: How do I become a validator?

To become a validator:

1. Deploy and sync a validator node. Recommended hardware: **32 CPU cores, 256 GB RAM, 5 TB SSD**, and **0.5 Gbps** network.
2. Register it using the latest `ops` tool and your node’s public keys. Set a reachable public endpoint, such as `tcp://YOUR_PUBLIC_IP:19000`.
3. Submit the registration from a **hardware wallet or Safe**. The sender becomes the permanent validator owner; ownership cannot be changed.
4. Reach the activation stake threshold: **100,000 PROS** on Atlantic testnet or **1,000,000 PROS** on Pacific mainnet. Registration alone requires at least **100 PROS**, but that won’t activate the validator.

Follow [Node Management](https://docs.pharos.xyz/node-and-validator-guide/node-management) for network-specific commands and transaction steps.

Sources
  1. Node Management  (cited in the answer)
     https://docs.pharos.xyz/node-and-validator-guide/node-management
  2. x402 Atlantic Testnet  (related)
     https://docs.pharos.xyz/developer-guide/x402/x402-atlantic-testnet
  3. x402 Pacific Mainnet  (related)
     https://docs.pharos.xyz/developer-guide/x402/x402-pacific-mainnet
```

### Example 3 — no good answer

```text
$ pharos-docs "What is the airspeed velocity of an unladen swallow in Pharos?"

No good answer found in the Pharos docs for: "What is the airspeed velocity of an unladen swallow in Pharos?"
Try rephrasing with more specific terms (e.g. a product, tool, or network name).

Closest pages (related, not an answer):
  - Pharos Skill Engine: https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide
  - Piggy Bank Tutorial: https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide/piggybank-skill-guide
  - About Pharos: https://docs.pharos.xyz/introduction/readme

$ echo $?
2
```

---

## Layout

```text
agents/<task>/        tasks 1-4 and 13, 16-30: one folder each with its CLI, examples and README
skills/pharos-<task>/ tasks 5-12, 14 and 15: one Skill folder each (SKILL.md, references/, scripts/, examples/, assets/)
submission/           the index and one page per task with the Arena form's fields
api/read.js  logs.js  docs.js  run.js  health.js         web API routes (Vercel functions)
public/               the web hub: index.html, css/, js/ (views, panels, run log, content), registry.json
lib/tasks/            the server-side handler of each task
scripts/              real-run scripts (mainnet, testnet, fork), audits, make-submission.mjs, task-map.mjs
docs/                 the architecture write-up of task 30
reports/  contracts/  config/    recorded runs, the lab contracts, the sandbox snapshot description
lib/mcp.js            MCP Streamable-HTTP client (retries, sessions, timeouts)
lib/chain.js          Chain MCP helpers: pinned eth_call, token reads
lib/snapshot.js       one pinned-block contract snapshot (CLI and web share it)
lib/abi.js            selectors, event topics, decoding, unit formatting
lib/watch.js          log decoding, dedupe, block-range paging, bounded scans
lib/trace.js          per-request record of every MCP/RPC call (the run log's data)
lib/rpc.js            direct JSON-RPC to the public RPC, used for cross-checks
lib/rpc-batch.js      JSON-RPC batches (tasks 26, 28, 30)
lib/crosscheck.js     replays eth_calls against the RPC and compares the raw bytes
lib/docs.js           docs answer parsing and the "no good answer" decision
lib/labels.js         address labels from the Pharos registries
lib/server.js         shared MCP clients and error mapping for the API routes
dev-server.js         local stand-in for Vercel (npm run web)
test/                 offline unit tests (node --test)
```

## Notes and limits

- Selectors and event hashes are the standard ERC-20/WETH ones, hard-coded so there is
  no hashing dependency; the four built-in event hashes were checked against live
  WPROS logs on Pharos mainnet.
- The hosted Chain MCP server sometimes returns `503 Server at session capacity`. The
  clients retry with the server's `Retry-After`, then fail with a clear message.
- Address labels cover well-known Pharos mainnet contracts only; use `--label` for
  anything else.
