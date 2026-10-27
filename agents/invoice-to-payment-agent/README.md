# 19. Invoice-to-Payment Agent

> Read an invoice, flag what is missing or does not add up instead of guessing, and prepare the matching payment as an unsigned transaction that carries the invoice’s reference.

**Arena task:** Payments · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/invoice-to-payment-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/invoice-to-payment-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/invoice-to-payment-agent

## What it does

Paying an invoice by hand means copying an address and an amount from a document: the places where mistakes and fraud live. This agent reads the invoice, checks it against itself and against the chain, and only then prepares a payment. It reads three formats: plain text (labelled lines), JSON, and an ethereum: payment link (EIP-681).

## What is real

Reads an invoice (plain text, JSON or an ethereum: link), flags instead of guessing (missing reference, checksum, second address, totals that do not add up, look-alike token, no conversion), and prepares an unsigned payment carrying the invoice reference; ten sample invoices on real mainnet state, three paid on a fork with the reference read back from the chain.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Extracts payee, amount, token or currency, and reference from at least 2 invoice formats. | It extracts the payee, amount, token or currency and reference from three formats: plain text, JSON and an ethereum: payment link (EIP-681). |
| 2 | Flags mismatches or missing fields instead of guessing. | It flags instead of guessing: a missing reference or payee, a name instead of an address, a wrong checksum, a second address, totals that disagree or do not add up, a look-alike token, a currency it cannot convert, the wrong chain, an overdue date. |
| 3 | Produces a payment summary and an unsigned transaction that includes the invoice reference. | It produces a payment summary and an unsigned transaction whose data carries the invoice reference after the transfer; on a fork the reference was read back from the mined transaction for each of three invoices. |
| 4 | Includes a demo with sample invoices. | The demo has ten sample invoices of the three formats: three payable, one payable with a warning, six refused, each for a named reason, and each recorded on real Pharos mainnet state and replayable. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/invoice-to-payment-agent/pharos-invoice.js invoice.txt --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f
… invoice.json --from 0x8ecd… --pay-in USDC
node scripts/payments-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
INVOICE #INV-2026-0043
Due: 2027-11-19
From: Harbor Studio Ltd
Pay to: 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A

Brand sprint – 2 x 100.00 USDC
Domain and hosting – 40.00 USDC
Subtotal: 240.00 USDC
Tax: 10.00 USDC
Total due: 205.00 USDC

BLOCKED · text invoice INV-2026-0043
  ✗ [total-mismatch] The invoice does not add up: subtotal 240.00 + tax 10.00 = 250.00, but the total says 205.00.
```

## What is in this folder

- [examples/invoices.json](examples/invoices.json)
- [pharos-invoice.js](pharos-invoice.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/invoice.js](../../lib/invoice.js)
- [lib/tasks/invoice-to-payment-agent.js](../../lib/tasks/invoice-to-payment-agent.js)
- [agents/invoice-to-payment-agent/pharos-invoice.js](pharos-invoice.js)
- [scripts/payments-demo.mjs](../../scripts/payments-demo.mjs)
- [scripts/payments-fork-run.mjs](../../scripts/payments-fork-run.mjs)
- [public/js/tasks/invoice-to-payment-agent.js](../../public/js/tasks/invoice-to-payment-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/payments-demo.json](../../reports/payments-demo.json)
- [reports/payments-fork-run.json](../../reports/payments-fork-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 17, 18, 20, 21, 22, 23, 25, 26), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 17, 18, 22, 23, 25, 26), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 25, 26), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 17, 18, 22, 23, 25, 26), [lib/payments.js](../../lib/payments.js) (also tasks 17, 18, 22, 23, 25, 26), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/recurring.js](../../lib/recurring.js) (also tasks 17, 18), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 17, 18, 22, 23, 25, 26), [lib/rlp.js](../../lib/rlp.js) (also tasks 17, 18, 20, 21, 22, 23, 25, 26), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 20, 21, 22, 23, 24, 25, 26), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 11, 15, 16, 17, 18), [lib/secp256k1.js](../../lib/secp256k1.js) (also tasks 17, 20, 21), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 17, 18, 22, 23, 25, 26), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 17, 18, 22, 23, 25, 26), [lib/tasks/natural-language-payment-agent.js](../../lib/tasks/natural-language-payment-agent.js) (also task 17), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 17, 18, 20, 22, 23, 25, 26), [lib/trace.js](../../lib/trace.js) (all tasks), [scripts/support/fork-chain.mjs](../../scripts/support/fork-chain.mjs) (also tasks 17, 18)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/invoice.test.js test/invoice-task.test.js
```

## Verify it yourself

- **Read a reference off the chain.** The fork card lists each mined transaction; the reference is the text after the 68 bytes of the transfer.
- **Check an address checksum.** The “typo” invoice’s address fails EIP-55: this prints the correct spelling.
- **See the real USDC contract.** The look-alike invoice is refused because the real USDC on Pharos is this contract.
- **Replay a recorded invoice.** In the recorded card press Replay: the invoice is read again at the recorded block and the flags, the checks and the transaction are compared.
- **Read the code.** The parser, the CLI, the sample invoices and the recordings are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
