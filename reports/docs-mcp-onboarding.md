# Onboarding onto Pharos using only Developer Docs MCP

Generated 2026-10-22 09:33 UTC against the live docs server. Every question below was asked to `askQuestion` on Developer Docs MCP and every answer was checked against the live network or the real URL it points at. No other documentation, search engine or community help was used.

**10 questions asked, 6 gaps found.**

## Step-by-step log

### 1. Find the testnet RPC URL and chain ID

**Question asked:** What is the RPC URL and chain ID for Pharos Atlantic Testnet?

> Pharos Atlantic Testnet uses:
> 
> * **RPC URL:** `https://atlantic.dplabs-internal.com`
> * **Chain ID:** `688689`
> 
> See [Atlantic Testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet).

- ✓ The answer gives an RPC URL: https://atlantic.dplabs-internal.com
- ✓ The answer gives chain ID 688689: present
- ✓ The live RPC reports the same chain ID: eth_chainId returned 688689

### 2. Get testnet PHRS to pay for gas

**Question asked:** How do I get testnet PHRS from a faucet? Give me the faucet URL.

> The docs mention getting testnet PHRS from the Pharos faucet or directly from the team, but **don’t provide the faucet URL**. See [Piggy Bank Tutorial](https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide/piggybank-skill-guide).

- ✗ The answer contains a faucet URL: the answer links only to other docs pages and says no faucet URL is given

### 3. Connect an AI client to the Pharos MCP server

**Question asked:** How do I connect the Pharos MCP server to Claude Desktop? Show the exact config.

> Add this server entry to Claude Desktop’s MCP configuration:
> 
> ```json
> {
>   "mcpServers": {
>     "pharos": {
>       "type": "http",
>       "url": "https://mcp.pharos.xyz/mcp"
>     }
>   }
> }
> ```

- ✓ The answer shows the server URL: https://mcp.pharos.xyz/mcp
- ✓ That URL works as documented: connected, chain 1672

### 4. Learn what the MCP server can do

**Question asked:** Which tools does the Pharos MCP server expose?

> The Pharos MCP server exposes **14 tools**:
> 
> * **Chain and blocks:** `get_chain_info` (chain ID, client version, latest block), `get_block_number`, `get_block`, `get_gas_price`.
> * **Accounts and transactions:** `get_balance` (native PROS), `get_transaction_count`, `get_transaction`, `get_transaction_receipt`.
> * **Contracts:** `eth_call`, `estimate_gas`, `get_code`, `get_storage_at`, `get_logs` (up to 1,000 blocks per call).
> * **Broadcasting:** `send_raw_transaction` (broadcasts an already-signed transaction).
> 
> See [Pharos MCP](https://docs.pharos.xyz/tooling-and-infrastructure/mcp) for parameters and setup. **Self-hosted note:** transaction broadcasting is disabled by default. The server does not handle private keys; sign transactions locally.

- ✓ The documented tool list matches the live server: live server lists 14 tools; answer names 14

### 5. Query event logs without hitting a limit

**Question asked:** What is the maximum block range I can query with eth_getLogs on Pharos?

> For the Pharos JSON-RPC endpoint, `eth_getLogs` supports up to **10,000 blocks** as a fallback cap. When rate limiting is enabled, the range is limited to **100 blocks**. See [JSON-RPC API Methods](https://docs.pharos.xyz/api-and-sdk/json-rpc-methods).
> 
> If you’re querying through the [Pharos MCP](https://docs.pharos.xyz/tooling-and-infrastructure/mcp), its cap is **1,000 blocks per call**.

- ✗ Every block-range limit stated matches the real limit (1,000): the public RPC accepts 1,000 blocks and rejects 1,001; the answer states 10,000, 100, 1,000, of which 10,000, 100 are wrong

### 6. Install the Skill Engine

**Question asked:** How do I install the Pharos Skill Engine?

> Install the Skill Engine by unpacking its archive, then install Foundry and configure your wallet:
> 
> ```bash
> unzip pharos-skill-engine-0.1.0.zip
> cd pharos-skill-engine-0.1.0
> ls  # Should show SKILL.md, assets/, references/
> ```
> 
> Install and verify Foundry:
> 
> ```bash
> curl -L https://foundry.paradigm.xyz | bash

- ✗ The answer says where to obtain it: no source in the answer, although the public repository exists (HTTP 200)

### 7. Find the right testnet USDC address

**Question asked:** What is the USDC token address on Atlantic testnet?

> The Atlantic Testnet Token Registry lists USDC at **`0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`**. It has 6 decimals. [Token Registry](https://docs.pharos.xyz/getting-started/token-registry)
> 
> For the x402 guide’s example setup, a different test token address is specified: `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`. The guide notes that this address is not official. [x402 Atlantic Testnet](https://docs.pharos.xyz/developer-guide/x402/x402-atlantic-testnet)

- ✓ Every address in the answer is a real contract: 0xcfC833…Fc8B (USDC, 1798 bytes); 0xE0BE08…4ec8 (USDC, 6005 bytes)
- ✗ The answer leads to one USDC, not several: 2 distinct contracts on Atlantic report symbol USDC: 0xcfC833…Fc8B (USDC, 1798 bytes); 0xE0BE08…4ec8 (USDC, 6005 bytes)

### 8. Verify a contract on mainnet

**Question asked:** How do I verify a contract on Pacific Mainnet?

> Use Foundry’s `forge verify-contract` with Pacific Mainnet’s chain ID and SocialScan API endpoint:
> 
> ```bash
> forge verify-contract \
>   <CONTRACT_ADDRESS> \
>   src/MyContract.sol:MyContract \
>   --chain-id 1672 \
>   --verifier blockscout \
>   --verifier-url https://api.socialscan.io/pharos-mainnet/v1/explorer/command_api/contract
> ```
> 
> Replace the address, source path, and contract name. If your contract has constructor parameters, add their ABI-encoded values:

- ✓ The answer gives chain ID 1672 and a verifier URL: https://api.socialscan.io/pharos-mainnet/v1/explorer/command_api/contract
- ✓ The verifier endpoint is reachable: HTTP 422

### 9. Run x402 on mainnet

**Question asked:** What is the x402 facilitator URL on Pacific Mainnet?

> I cannot find a specific facilitator URL in the docs. The Pacific Mainnet guide uses `FACILITATOR_URL` as a configuration value but doesn’t provide its address. See [x402 Pacific Mainnet](https://docs.pharos.xyz/developer-guide/x402/x402-pacific-mainnet).

- ✗ The page gives a mainnet facilitator URL: the page only says: FACILITATOR_URL; // Facilitator service URL

### 10. Point an AI agent at the machine-readable docs

**Question asked:** Where is the llms.txt file for AI agents?

> I cannot find an `llms.txt` file or its location in the docs. For AI-agent onboarding, the [Pharos Skill Engine](https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide) identifies `SKILL.md` as the agent’s entry point.

- ✗ Docs MCP can say where llms.txt is: the answer says it cannot find information about llms.txt
- ✓ docs.pharos.xyz/llms.txt exists: HTTP 200
- ✗ The endpoint advertised on ai.pharos.xyz works: www.pharos.xyz/agent-center/llms.txt returned HTTP 404

## Gaps found (6)

### Gap 1: No faucet URL anywhere in the docs

- **Exact query:** `How do I get testnet PHRS from a faucet? Give me the faucet URL.`
- **What happened:** Expected: the answer contains a faucet URL. Found: the answer links only to other docs pages and says no faucet URL is given.
- **What the docs should say:** Name the faucet and link it from “Get PROS Gas” and “Atlantic Testnet”, with the claim amount, the rate limit and what to do if it is empty. Without it a new developer cannot send a single transaction.

### Gap 2: The documented eth_getLogs block range is wrong

- **Exact query:** `What is the maximum block range I can query with eth_getLogs on Pharos?`
- **What happened:** Expected: every block-range limit stated matches the real limit (1,000). Found: the public RPC accepts 1,000 blocks and rejects 1,001; the answer states 10,000, 100, 1,000, of which 10,000, 100 are wrong.
- **What the docs should say:** State the real limit (1,000 blocks, inclusive) once on the JSON-RPC page and use that number everywhere, including in what Docs MCP answers.

### Gap 3: The Skill Engine install steps never say where to get it

- **Exact query:** `How do I install the Pharos Skill Engine?`
- **What happened:** Expected: the answer says where to obtain it. Found: no source in the answer, although the public repository exists (HTTP 200).
- **What the docs should say:** Start with the source: “npx skills add https://github.com/PharosNetwork/pharos-skill-engine” or a download link for the ZIP. Today the guide says “after obtaining the ZIP” without a link.

### Gap 4: Two different “USDC” addresses on Atlantic, with no guidance on which to use

- **Exact query:** `What is the USDC token address on Atlantic testnet?`
- **What happened:** Expected: the answer leads to one USDC, not several. Found: 2 distinct contracts on Atlantic report symbol USDC: 0xcfC833…Fc8B (USDC, 1798 bytes); 0xE0BE08…4ec8 (USDC, 6005 bytes).
- **What the docs should say:** Say which USDC is for what (general use vs x402), mark the other clearly, and use the same address in every example, including the Skill Engine guide.

### Gap 5: No facilitator URL for x402 on Pacific Mainnet

- **Exact query:** `What is the x402 facilitator URL on Pacific Mainnet?`
- **What happened:** Expected: the page gives a mainnet facilitator URL. Found: the page only says: FACILITATOR_URL; // Facilitator service URL.
- **What the docs should say:** Publish the mainnet facilitator URL (or say plainly that you must run your own, and link the reference implementation) on the x402 Pacific Mainnet page.

### Gap 6: llms.txt: Docs MCP cannot say where it is, and the advertised endpoint is a 404

- **Exact query:** `Where is the llms.txt file for AI agents?`
- **What happened:** Expected: docs MCP can say where llms.txt is. Found: the answer says it cannot find information about llms.txt. Expected: the endpoint advertised on ai.pharos.xyz works. Found: www.pharos.xyz/agent-center/llms.txt returned HTTP 404.
- **What the docs should say:** Document https://docs.pharos.xyz/llms.txt (it exists), make Docs MCP aware of it, and fix or remove the www.pharos.xyz/agent-center/llms.txt endpoint that ai.pharos.xyz advertises.

## What I built or ran by the end

- Connected to Chain MCP using only the config from the docs; it reported chain 1672 (Pharos) at block 20,917,091.
- Reached the Atlantic testnet RPC from the docs: chain ID 688689, block 31,737,536.
- Reached the mainnet RPC from the docs: block 20,917,091, matching Chain MCP’s chain 1672.
- Read live contract state and logs through the documented tools (the Read Contract State and Event/Log Monitor tasks).

## What I could not do

- Send a transaction or deploy to Atlantic: no faucet URL, so no testnet PHRS for gas.
- Run x402 on mainnet: no facilitator URL is documented.
