# 19. Invoice-to-Payment Agent

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/invoice-to-payment-agent/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/invoice-to-payment-agent
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/invoice-to-payment-agent
- **What the proof shows:** Reads an invoice (plain text, JSON or an ethereum: link), flags instead of guessing (missing reference, checksum, second address, totals that do not add up, look-alike token, no conversion), and prepares an unsigned payment carrying the invoice reference; ten sample invoices on real mainnet state, three paid on a fork with the reference read back from the chain.

## Requirements it was built against (the Arena’s own list)

1. Extracts payee, amount, token or currency, and reference from at least 2 invoice formats.
   - Met by: It extracts the payee, amount, token or currency and reference from three formats: plain text, JSON and an ethereum: payment link (EIP-681).
2. Flags mismatches or missing fields instead of guessing.
   - Met by: It flags instead of guessing: a missing reference or payee, a name instead of an address, a wrong checksum, a second address, totals that disagree or do not add up, a look-alike token, a currency it cannot convert, the wrong chain, an overdue date.
3. Produces a payment summary and an unsigned transaction that includes the invoice reference.
   - Met by: It produces a payment summary and an unsigned transaction whose data carries the invoice reference after the transfer; on a fork the reference was read back from the mined transaction for each of three invoices.
4. Includes a demo with sample invoices.
   - Met by: The demo has ten sample invoices of the three formats: three payable, one payable with a warning, six refused, each for a named reason, and each recorded on real Pharos mainnet state and replayable.

Code and notes: [agents/invoice-to-payment-agent/README.md](../agents/invoice-to-payment-agent/README.md)
