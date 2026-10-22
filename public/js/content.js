// What we built and why, per task, written for someone reviewing it. Everything
// stated here was observed while building and testing against Pharos mainnet.

import { TASK_MODULES } from './tasks/index.js';
import { EXPLORER, REPO, USDC } from './consts.js';
export { EXPLORER, REPO, USDC };


// Section ids, in page order, for a task that is live.
export const SECTIONS = [
  ['story', 'The story'],
  ['try', 'Try it live'],
  ['requirements', 'Requirements'],
  ['how', 'How it works'],
  ['decisions', 'Decisions'],
  ['run', 'Run it yourself'],
  ['verify', 'Verify independently'],
];

export const LIVE = {
  'read-contract-state': {
    tagline: 'Turn raw contract storage into something a person can read.',
    tools: ['chain', 'rpc'],
    story: [
      'A smart contract answers questions in hex. To learn a token’s name you send a four-byte function selector in an eth_call and get back 32-byte words that still need decoding. This agent does that work through the Chain MCP server and shows the answer the way a person would read it.',
      'It reads five values from one contract (name, symbol, decimals, totalSupply and owner), plus the balance of any wallet you name. Every value comes from the same block, so they agree with each other, and the page tells you which block and what time that was.',
      'USDC on Pharos mainnet is the default because it is a real, busy contract, but any ERC-20-style address works. Below the result you can see the raw bytes each call returned and how they were decoded, so nothing is a black box.',
    ],
    how: [
      { server: 'chain', tool: 'get_block_number', text: 'Ask which block is the latest, then pin every later read to it so all values describe one moment.' },
      { server: 'chain', tool: 'get_chain_info · get_block', text: 'Confirm the network (chain 1672) and fetch the pinned block’s timestamp.' },
      { server: 'chain', tool: 'get_code', text: 'Check that the address really holds contract code. A wallet has none, and we say so instead of printing zeros.' },
      { server: 'chain', tool: 'eth_call × 5–6', text: 'name(), symbol(), decimals(), totalSupply(), owner() and any balanceOf(holder), each sent as a four-byte selector, all in parallel and all at the pinned block.' },
      { server: 'local', tool: 'decode', text: 'Decode the 32-byte words into strings, integers and addresses; apply the token’s decimals and group the thousands.' },
      { server: 'chain', tool: 'get_code (owner, holders)', text: 'Label each address: a name from the Pharos registry, otherwise “contract” or “wallet”.' },
      { server: 'rpc', tool: 'eth_call × 5–6', text: 'Replay every call against the public RPC at the same block and compare the raw bytes with what Chain MCP returned.' },
    ],
    decisions: [
      { title: 'One block for everything', text: 'Reading five values at “latest” could straddle a block boundary and mix two moments. Reading the head once and pinning the rest to it removes that, and gives the page an honest “read at block N”.' },
      { title: 'A missing function is not an error', text: 'Calling a function a contract doesn’t have does not revert on Pharos; it returns an empty 0x. WPROS has no owner(), so it shows “n/a” rather than failing or printing a zero address.' },
      { title: 'Labels without guessing', text: 'An address is named only when it is in the official token and canonical-contract registries or you supply a label. Otherwise it is shown as “contract” or “wallet”, which we can prove from its code.' },
      { title: 'Checked against a second source', text: 'The Chain MCP server is a thin layer over JSON-RPC, so we replay each call straight against rpc.pharos.xyz. If the RPC returns nothing where MCP returned data (what a pruned old block looks like) the result is “inconclusive”, never a false “mismatch”.' },
    ],
    evidence: [
      'name, symbol, decimals, totalSupply and owner are read with eth_call through Chain MCP; the Try-it table shows each one.',
      'The header shows the contract address and the block (with its time) that every read is pinned to.',
      'Decimals applied and thousands grouped with the raw value kept; addresses labelled from the Pharos registry, as wallet or contract, or with your own label.',
      'This page and the README document the contract chosen, how to run it, and real sample output.',
    ],
    files: ['bin/pharos-read.js', 'lib/snapshot.js', 'lib/chain.js', 'lib/crosscheck.js', 'api/read.js'],
    run: {
      commands: ['node bin/pharos-read.js', `node bin/pharos-read.js ${USDC} --holder 0x768b959191ce5876cabbbc014a08d72615bdde54`, 'node bin/pharos-read.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --json'],
      sample: `Pharos contract snapshot
────────────────────────────────────────────────────────────
  Contract       USDC
  Address        ${USDC}
  Network        Pharos · chain 1672
  Read at        block 20,911,225 · 2026-10-22 08:07:21 UTC
  Code size      1,798 bytes

Values read via Chain MCP (eth_call at that block)
  name           USDC
  symbol         USDC
  decimals       6
  totalSupply    39,689,691.355769 USDC   (raw 39689691355769)
  owner          wallet (no contract code)  0x9f8e…4d92
  balanceOf      unlabelled contract  0x768b…de54 → 366.45403 USDC`,
    },
    verify: [
      { title: 'Compare with the block explorer', text: 'Open the USDC token page and compare the total supply. It moves as tokens are minted, so expect a small difference from a snapshot taken minutes ago.', link: [`${EXPLORER}/token/${USDC}`, 'USDC on Pharosscan'] },
      { title: 'Ask the RPC yourself', text: 'This is the call behind decimals(), sent straight to the public RPC with no MCP in between. It should return 6.', code: `curl -s https://rpc.pharos.xyz -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${USDC}","data":"0x313ce567"},"latest"]}'` },
      { title: 'Repeat any call from the log', text: 'Each MCP row in the run log has a Reproduce block that repeats that exact call using this repository’s client. Clone the repo and paste it.' },
    ],
  },

  'event-log-monitor': {
    tagline: 'Watch a contract live and see every new event exactly once.',
    tools: ['chain'],
    story: [
      'Contracts announce what happens by emitting logs: a Transfer, a Deposit. This monitor polls the Chain MCP server for them and prints each new log once, decoded into who sent what to whom, in which transaction and block.',
      'It keeps running. Every few seconds it asks for the latest block, reads only the blocks it has not seen, and reports what it finds. Pick a busy mainnet contract and events show up within seconds.',
      'The log below the demo is the point: each poll is one entry, so you can see exactly which block range was scanned, which calls were made, how many events came back and how many were suppressed as duplicates.',
    ],
    how: [
      { server: 'chain', tool: 'get_block_number', text: 'Learn the chain head at the start of every poll.' },
      { server: 'chain', tool: 'get_logs', text: 'Fetch logs filtered by the contract address and the event’s topic0, from the cursor to the head, in windows of at most 1,000 blocks (the server’s limit).' },
      { server: 'local', tool: 'de-duplicate', text: 'Identify each log by transaction hash and log index and drop any we have already shown.' },
      { server: 'local', tool: 'decode', text: 'Read from, to and amount out of the topics and data; apply the token’s decimals and symbol.' },
      { server: 'local', tool: 'advance cursor', text: 'Move the cursor past the scanned window only after it was handled, so a failed poll retries the same blocks instead of skipping them.' },
    ],
    decisions: [
      { title: 'Overlap on purpose', text: 'Each poll re-reads the last two blocks, and de-duplication drops what was already shown. It costs almost nothing and means a log that appears slightly late is still caught. The “duplicates suppressed” counter shows it working.' },
      { title: 'A failed poll never skips blocks', text: 'The cursor moves only after a window was fully processed. If a call fails, the next poll covers the same range again.' },
      { title: 'Several Transfers can share a transaction', text: 'A multi-step swap emits one Transfer per hop in a single transaction. They are different logs (different log index), not duplicates, so the list shows the log number next to each transaction.' },
      { title: 'Event hashes were checked against live data', text: 'The built-in topic hashes (Transfer, Approval, Deposit, Withdrawal) were each used to query WPROS on mainnet and returned matching logs before we relied on them.' },
      { title: 'The browser asks our API, not the MCP server', text: 'The MCP servers send no CORS headers, so a web page cannot call them directly. A thin API route calls them and returns the result together with its trace.' },
    ],
    evidence: [
      'Every poll calls get_logs filtered by the contract address and the event’s topic0.',
      'Only blocks after the last scanned one are read (windows of ≤ 1,000 blocks) and each log is de-duplicated by txHash:logIndex.',
      'Each event is decoded into from, to, amount (decimals and symbol applied), tx hash, block and block time.',
      'Busy mainnet contracts emit events within seconds, so you can watch live events arrive above. A CLI run is in the README.',
    ],
    files: ['bin/pharos-watch.js', 'lib/watch.js', 'api/logs.js'],
    run: {
      commands: ['node bin/pharos-watch.js', 'node bin/pharos-watch.js --max-events 3 --interval 2', 'node bin/pharos-watch.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --event Deposit --from-block 20908000 --json'],
      sample: `Watching Transfer on USDC ${USDC}
Starting at block 20,911,107 (chain head 20,911,106), polling every 2s. Ctrl-C to stop.

[08:05:45 UTC] block 20,911,114  Transfer   0x946d…4cef → 0x5dbb…ed3e  3.984048 USDC
    tx 0x3c12c6e64af3b2ff18d75b11ffdaff6e339ccdef0bf7950329760ed2413895b8
[08:05:47 UTC] block 20,911,116  Transfer   0x9b1e…6be8 → 0x768b…de54  104.74 USDC
    tx 0x7268fa6b43e02a509b302850313bfa1656edbac8ad2458c2698a65e7c8c3c548

Stopped after 2 events; last scanned block 20,911,116.`,
    },
    verify: [
      { title: 'Open a transaction on the explorer', text: 'Every event row links to its transaction on Pharosscan. Compare the sender, receiver and amount with what the monitor printed.' },
      { title: 'Ask the RPC for the same logs', text: 'This asks the public RPC for USDC Transfers in blocks 20,911,114 to 20,911,116, with no MCP in between. It returns 3 logs: the same three transactions our first live CLI run reported (3c12c6…, 7268fa…, 4fb129…). To check a range from your own run, copy fromBlock and toBlock from a get_logs row in the log.', code: `curl -s https://rpc.pharos.xyz -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"${USDC}","fromBlock":"0x13f140a","toBlock":"0x13f140c","topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}]}'` },
      { title: 'Watch the duplicates counter', text: 'With the default overlap, the “duplicates suppressed” number rises while “new events” counts each log once. That is de-duplication visibly working.' },
    ],
  },

  'doc-search-cli': {
    tagline: 'Ask the Pharos docs in plain English. Get an answer with its sources, or an honest “I don’t know”.',
    tools: ['docs'],
    story: [
      'The Developer Docs MCP server lets an agent search and question the official Pharos documentation. This tool wraps it in a command: ask a question in plain English and get a concise answer with the doc pages it came from.',
      'The part we cared about most is what it does when the docs don’t know. A tool that always answers is dangerous; a developer would follow a made-up instruction. So when there is no good answer it says so, shows the nearest pages labelled as not an answer, and exits with a non-zero code a script can test.',
    ],
    how: [
      { server: 'docs', tool: 'askQuestion', text: 'Ask the docs server to synthesise a direct answer, with a link to the pages it used.' },
      { server: 'docs', tool: 'searchDocumentation', text: 'In parallel, run a keyword search. This tells us whether the docs mention the topic at all.' },
      { server: 'local', tool: 'clean', text: 'Strip dead links the server sometimes emits, and turn relative doc links into full URLs.' },
      { server: 'local', tool: 'decide', text: 'Trust the answer only if it does not refuse and the search or the answer’s own links point at real pages.' },
      { server: 'local', tool: 'rank sources', text: 'List pages the answer links to first, then keyword matches, then the server’s own source list, without duplicates.' },
    ],
    decisions: [
      { title: 'Sources alone prove nothing', text: 'For a nonsense question the server still returned a list of sources. A source list is not evidence of an answer, so the decision uses the answer’s own words and the keyword search.' },
      { title: 'A bug we hit and fixed (twice)', text: 'The server words its refusals differently from run to run. First it said “I can’t answer that from the available docs”, which our check did not recognise, so a refusal was shown as an answer. We widened the phrase list, but a later audit that asked 20 off-topic questions found 4 more leaks (“Pharos doesn’t specify a swallow’s airspeed…”, “sourdough baking isn’t covered here”). Chasing phrases cannot win, so the verdict now also requires the question’s key words to appear in the pages the docs search returned (an off-topic question shares none). The four leaked answers are regression tests, and 15 real questions still pass.' },
      { title: 'Refusals are not confused with real answers', text: 'A genuine answer that says “the docs don’t provide a faucet URL” is still an answer. A test keeps the check narrow enough not to reject it.' },
      { title: 'Two calls, run in parallel', text: 'Asking and searching at the same time costs one round trip, not two.' },
    ],
    evidence: [
      'Takes a plain-English question, on the command line or in the box above.',
      'Returns a concise answer plus the doc pages it came from.',
      'Says “no good answer” when the answer admits it, or when the question’s key words appear in none of the pages the docs search returns, and shows nearby pages labelled as not an answer.',
      'README has install and usage steps and three real example queries with output.',
    ],
    files: ['bin/pharos-docs.js', 'lib/docs.js', 'api/docs.js'],
    run: {
      commands: ['node bin/pharos-docs.js "how do I deploy a contract?"', 'node bin/pharos-docs.js --json "What are the chain ID and RPC URL for Pharos mainnet?"', 'node bin/pharos-docs.js "airspeed of an unladen swallow"; echo $?'],
      sample: `Q: What are the chain ID and RPC URL for Pharos mainnet?

Pharos Pacific Mainnet uses:

* **Chain ID:** \`1672\`
* **RPC URL:** \`https://rpc.pharos.xyz\`

See [Pacific Mainnet](https://docs.pharos.xyz/getting-started/network/pacific-mainnet).

Sources
  1. Pacific Mainnet
     https://docs.pharos.xyz/getting-started/network/pacific-mainnet`,
    },
    verify: [
      { title: 'Open the cited page', text: 'Every answer lists the doc pages it came from. Open one and check that it says what the answer says.' },
      { title: 'Ask the docs server directly', text: 'The same question through this repository’s MCP client, without the filtering. You will see the raw answer that our decision logic judged.', code: `node --input-type=module <<'EOF'\nimport { McpClient, PHAROS_DOCS_MCP } from './lib/mcp.js';\nconst client = new McpClient(PHAROS_DOCS_MCP);\nconsole.log(await client.callTool('askQuestion', { question: 'How do I become a validator?' }));\nawait client.close();\nEOF` },
      { title: 'Try to trick it', text: 'Ask something the docs cannot answer, like the example chip about the swallow. It should refuse, and the log’s Decision entry shows why.' },
    ],
  },
};

// A live task's content: hand-written entries above, or a module in tasks/ for newer ones.
export const liveOf = (slug) => LIVE[slug] ?? TASK_MODULES[slug]?.content;

// Our assessment of what each remaining task needs. Not part of the task briefs.
export const PLAN = {
  'docs-mcp-onboarding': 'Doable now. A meta-task: onboard using only Docs MCP and log where it breaks down.',
  'threshold-guardian': 'Read-only logic. The task asks for a Skill, so the Skill Engine format needs confirming first.',
  'saga-executor': 'Needs a funded testnet wallet and signing. The hosted Chain MCP is read-only, so execution has to come from a wallet the owner supplies.',
  'arbitrage-scanner': 'Needs two real price sources on Pharos (pools or an oracle). The brief allows simulated execution.',
  'dry-run-executor': 'Doable: eth_call and estimate_gas through Chain MCP. Skill format to confirm.',
  'trend-watcher': 'Needs persistent storage between runs, so it needs a small database or file store.',
  'batch-executor': 'Can prepare Multicall3 calldata and compare gas. Actually executing needs a wallet.',
  'policy-gatekeeper': 'Doable: policy rules, allow/deny with the deciding rule, and an audit log.',
  'skill-chain-mcp-flow': 'Needs the Skill Engine; the flow and diagram are doable.',
  'docs-chain-mcp-agent': 'Doable: Docs MCP explains a function, Chain MCP calls it.',
  'portfolio-assistant': 'Needs at least 2 real protocols or vaults on Pharos mainnet; those have to be found first.',
  'yield-optimizer': 'Needs at least 3 on-chain yield sources to compare.',
  'liquidation-watchdog': 'Needs a lending protocol on Pharos and an alert channel (Telegram, Discord or console).',
  'natural-language-payment-agent': 'Doable: prepares an unsigned transaction only, which is what the brief asks for.',
  'recurring-payment-agent': 'Doable: schedule, state and unsigned transactions.',
  'invoice-to-payment-agent': 'Doable: parse two invoice formats and prepare an unsigned transaction.',
  'x402-paywalled-api': 'Needs a funded Atlantic testnet wallet with test USDC and a facilitator that settles on chain.',
  'x402-agent-buyer': 'Needs a funded Atlantic testnet wallet and x402 endpoints to pay.',
  'on-chain-alert-bot': 'Doable, but needs a Telegram bot token or a Discord webhook from the owner.',
  'whale-watching-agent': 'Doable: get_logs filtered by address topics for 5+ watched addresses.',
  'gas-fee-optimizer': 'Gas history is doable; submitting at the deadline needs a wallet.',
  'wallet-risk-checker': 'Doable with read-only signals (contract age, code, approvals, funding).',
  'audit-log-agent': 'Doable: topic-filtered logs per wallet, with a date range mapped to blocks.',
  'dapp-support-agent': 'Doable: needs 3 real failed transactions of different kinds to demonstrate.',
  'weekly-digest-agent': 'Needs a scheduler and a delivery channel, or a published page.',
  'doc-grounded-builder-agent': 'Doable with prepare-for-signature: Docs MCP plans, Chain MCP acts and verifies.',
  'multi-protocol-aggregator': 'Needs at least 2 protocols or vaults behind one interface.',
};

export const ABOUT = {
  intro: 'This site is a working set of agents for Pharos and a place to test each one. Every task has its own page with the story of what we built, a live demo, and a run log that records every call the demo made, so you can check the work instead of trusting a screenshot.',
  flow: [
    { who: 'Your browser', what: 'Runs the demo and shows the log.' },
    { who: 'Our API (/api)', what: 'A small server route. It calls the upstream services and records each call as it happens.' },
    { who: 'Chain MCP · Docs MCP · public RPC', what: 'The upstream Pharos services. The RPC is only used to cross-check what the MCP servers said.' },
  ],
  constraints: [
    { title: 'Browsers cannot call the MCP servers', text: 'Neither server sends CORS headers, so a web page is blocked from calling them directly. That is why a thin API route sits in the middle.' },
    { title: 'The Chain MCP server is stateful and sometimes full', text: 'It needs an initialize handshake before any call, keeps sessions in memory, and at times answers “503 Server at session capacity”. The client retries using the server’s Retry-After, shows the wait in the log, and the header shows live status for each service.' },
    { title: 'Log queries are capped at 1,000 blocks', text: 'Longer ranges are rejected, so the monitor scans in windows of at most 1,000 blocks.' },
    { title: 'A model answers the docs questions', text: 'Its refusals are worded differently from run to run, so “no good answer” is decided from several signals and covered by tests, not by matching one sentence.' },
  ],
  review: [
    'Open a task from the menu and read “The story” to see what it does and why.',
    'Press the button in “Try it live”. Then open the run log below it: each row is one real call, with its exact request and raw response.',
    'Use “Verify independently” to check a result against the block explorer or the public RPC without going through our code.',
    'Every section has its own link (the link icon next to its heading), so you can point someone at exactly the part you mean.',
  ],
};
