# 17. Natural-Language Payment Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/natural-language-payment-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/natural-language-payment-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/natural-language-payment-agent
- **What the proof shows:** Turns a sentence into questions, a refusal, or a checked summary and an unsigned transaction on Pharos mainnet (token, balance, checksum, simulation as the sender). Fifteen real requests pinned to a block, replayable; the output signed with a throwaway key on a mainnet fork moves the exact amount.

## Requirements it was built against (the Arena’s own list)

1. Parses amount, token and recipient from free text, and asks a follow-up when anything is ambiguous.
   - Met by: It parses amount (including 1.5k and 1,250.50), token (by symbol or contract address) and recipient from a sentence, and asks a follow-up when a field is missing or ambiguous: a name, “dollars”, two addresses, two amounts, “all”, a short address.
2. Validates the request: recipient format, token contract, sufficient balance.
   - Met by: It validates the recipient (format and EIP-55 checksum, not the zero address or the token contract), the token contract (code present, decimals match the registry) and the balance (token and gas), and simulates the transfer as the sender on Pharos mainnet.
3. Shows a human-readable summary before producing the unsigned transaction.
   - Met by: It shows a human-readable summary (what is sent, from where to where, the fee, the balance after) and every check, before the transaction.
4. Never signs or sends on its own. Output is an unsigned transaction or a wallet signing request.
   - Met by: It never signs or sends: it holds no key. The output is an unsigned transaction, an eth_sendTransaction request, an EIP-681 link and the hash to sign, and a fork run shows a real EVM accepting those bytes once a throwaway key signs them.

Code and notes: [agents/natural-language-payment-agent/README.md](../agents/natural-language-payment-agent/README.md)
