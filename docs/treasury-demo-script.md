# Treasury Copilot: demo video script (about 3 minutes)

Goal: one continuous take that shows a real user flow, the two Pharos AI tools doing real work, the safety behaviour, and a mined receipt. The task requires a real flow, not a mock-up.

**Before recording**
- Wallet on Pharos Atlantic Testnet (chain 688689) with a little test PHRS for gas (testnet faucet: https://docs.pharos.xyz/getting-started/network/atlantic-testnet).
- Open https://pharos-agent-kit.vercel.app/treasury in a clean browser window. Put the Atlantic explorer (https://atlantic.pharosscan.xyz) in a second tab.
- Use a fresh invoice reference every take; a reference can be paid once per wallet.

**Script**

| Time | On screen | Say |
|---|---|---|
| 0:00 | Top of the page: headline, "Built for" line and the live-on-Atlantic strip | "Treasury Copilot is a payment desk where an AI agent checks every invoice before your wallet signs anything. It is live on Pharos Atlantic Testnet, and these are the deployed contracts." |
| 0:20 | Click the router link, show it on the explorer, come back | "The router and the demo token are real contracts. tUSDC is a valueless test token." |
| 0:35 | Connect wallet, then switch network if asked; the progress steps tick | "I connect my wallet. The agent never sees a key; only my wallet can sign." |
| 0:55 | Click **Mint test tokens**, sign, wait for the green confirmation | "Mint free test tokens to try it." |
| 1:15 | Open **Paste an invoice instead**, click **Use a sample**, then **Read invoice** | "I paste an invoice and the agent fills the form. If something were missing or ambiguous it would ask me instead of guessing." |
| 1:35 | Click **Review invoice**; while it works, read the waiting message | "Now the copilot asks the Pharos Developer Docs MCP for the network facts, and reads my balance, allowance and the invoice registry through the Pharos SkillEngine." |
| 1:55 | Show the result: tool badges, passed checks, the recipient notice, expand **Agent evidence**, **Tool calls** and **Documentation behind the plan** | "Every decision shows its evidence: the cited documentation, the block the reads came from, every tool call with its timing, and my limits. The agent also inspected the recipient on chain and noticed it is a brand-new address, so it asks me to confirm it. The result is *needs approval*." |
| 2:05 | Tick **I confirmed this recipient address with them** | "Signing stays locked until I confirm the recipient." |
| 2:15 | Click **Approve exact amount in wallet**, sign; review again; **Pay invoice in wallet**, sign | "Approval is for this exact amount, never unlimited. Then the payment itself." |
| 2:40 | Receipt appears in the ledger as **Confirmed**; open it on the explorer | "The page does not trust the wallet's word. It matched payer, router, calldata, amount and the on-chain event before calling this confirmed." |
| 2:55 | Type the reference you just paid into the form again and **Review invoice** (shows *already paid*); then set the limit to 1 and review a 25 payment (shows *on hold*) | "The same invoice cannot be paid twice, and a payment above my limit is stopped before anything is prepared." |
| 3:10 | Scroll to **Safety model** | "No keys, you sign every move, limits first, and the agent stops instead of guessing." |

**After recording:** upload the video, then put its URL in `config/treasury.json` as `"video"`, commit and redeploy. The page then shows a "Demo video" link in the live strip.
