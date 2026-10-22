# pharos-agent-kit

Three small command-line agents for [Pharos](https://ai.pharos.xyz), built for the
[Pharos Agent Arena](https://pharos-agent-arena.vercel.app/#tasks) **Season of AI**:

| Command | Arena task | Talks to |
|---|---|---|
| [`pharos-read`](#1-pharos-read--read-contract-state) | Read Contract State | Chain MCP |
| [`pharos-watch`](#2-pharos-watch--eventlog-monitor) | Event/Log Monitor | Chain MCP |
| [`pharos-docs`](#3-pharos-docs--doc-search-cli) | Doc-Search CLI | Developer Docs MCP |

No dependencies, no API keys, no build step. Needs **Node.js 20+**.
Everything is read-only: nothing here signs or sends a transaction.

```bash
git clone https://github.com/moltaphet/pharos-agent-kit && cd pharos-agent-kit
node bin/pharos-read.js          # or: npm link, then `pharos-read`
node bin/pharos-watch.js
node bin/pharos-docs.js "how do I deploy a contract?"
npm test                         # offline unit tests
npm run web                      # the web hub at http://localhost:3000
```

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

1. Put the logic in `lib/` (pure, testable) and, if it makes sense, a CLI in `bin/`.
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
  1. Pacific Mainnet
     https://docs.pharos.xyz/getting-started/network/pacific-mainnet
  2. Cross Chain Infrastructure
     https://docs.pharos.xyz/tooling-and-infrastructure/cross-chain
  3. ZAN RPC
     https://docs.pharos.xyz/tooling-and-infrastructure/rpc/zan
```

### Example 2

```text
$ pharos-docs --sources 3 "How do I get testnet gas tokens?"

Q: How do I get testnet gas tokens?

For **Atlantic Testnet**, get testnet **PHRS** from the Pharos faucet or directly from the team. The docs don’t provide a faucet URL.

Add the network to your EVM wallet using the values in [Atlantic Testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet):

* **RPC:** `https://atlantic.dplabs-internal.com`
* **Chain ID:** `688689`
* **Token symbol:** `PHRS`

Then request testnet tokens for your wallet address. Check your balance in the wallet or on the [Atlantic explorer](https://atlantic.pharosscan.xyz/).

Sources
  1. Atlantic Testnet
     https://docs.pharos.xyz/getting-started/network/atlantic-testnet
  2. Piggy Bank Tutorial
     https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide/piggybank-skill-guide
  3. Get PROS Gas
     https://docs.pharos.xyz/getting-started/get-pros-gas
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
bin/pharos-read.js    pharos-watch.js    pharos-docs.js   the three CLIs
api/read.js  logs.js  docs.js  health.js                web API routes (Vercel functions)
public/               the web hub: index.html, css/, js/ (views, panels, run log, content), registry.json
lib/mcp.js            MCP Streamable-HTTP client (retries, sessions, timeouts)
lib/chain.js          Chain MCP helpers: pinned eth_call, token reads
lib/snapshot.js       one pinned-block contract snapshot (CLI and web share it)
lib/abi.js            selectors, event topics, decoding, unit formatting
lib/watch.js          log decoding, dedupe, block-range paging, bounded scans
lib/trace.js          per-request record of every MCP/RPC call (the run log's data)
lib/rpc.js            direct JSON-RPC to the public RPC, used for cross-checks
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
