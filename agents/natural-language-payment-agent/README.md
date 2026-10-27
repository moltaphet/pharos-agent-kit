# 17. Natural-Language Payment Agent

> Turn “send 100 USDC to 0x…” into a checked summary and an unsigned transaction on Pharos. It asks when anything is unclear, and it never signs or sends.

**Arena task:** Payments · Medium · [brief](https://pharos-agent-arena.vercel.app/tasks/natural-language-payment-agent)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/natural-language-payment-agent/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/natural-language-payment-agent

## What it does

People say what they want in a sentence: “send 100 USDC to 0x…”. A payment needs more than that to be safe: which token contract, how many decimals, whether the address is real, whether the wallet holds enough, whether the transfer would even go through. This agent does that work and hands back an unsigned transaction. You sign it, or your wallet does.

## What is real

Turns a sentence into questions, a refusal, or a checked summary and an unsigned transaction on Pharos mainnet (token, balance, checksum, simulation as the sender). Fifteen real requests pinned to a block, replayable; the output signed with a throwaway key on a mainnet fork moves the exact amount.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Parses amount, token and recipient from free text, and asks a follow-up when anything is ambiguous. | It parses amount (including 1.5k and 1,250.50), token (by symbol or contract address) and recipient from a sentence, and asks a follow-up when a field is missing or ambiguous: a name, “dollars”, two addresses, two amounts, “all”, a short address. |
| 2 | Validates the request: recipient format, token contract, sufficient balance. | It validates the recipient (format and EIP-55 checksum, not the zero address or the token contract), the token contract (code present, decimals match the registry) and the balance (token and gas), and simulates the transfer as the sender on Pharos mainnet. |
| 3 | Shows a human-readable summary before producing the unsigned transaction. | It shows a human-readable summary (what is sent, from where to where, the fee, the balance after) and every check, before the transaction. |
| 4 | Never signs or sends on its own. Output is an unsigned transaction or a wallet signing request. | It never signs or sends: it holds no key. The output is an unsigned transaction, an eth_sendTransaction request, an EIP-681 link and the hash to sign, and a fork run shows a real EVM accepting those bytes once a throwaway key signs them. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node agents/natural-language-payment-agent/pharos-pay.js "send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A" --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f
… "send 50 to bob" --from 0x8ecd… --answer recipient=0x5a5A… --answer token=USDC
… "send 50 to bob" --contact bob=0x5a5A… --from 0x8ecd…
node scripts/payments-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A   (from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f)

READY · block 21,151,643

  Send 100 USDC from 0x8ecdf4…24ab9f to 0x5a5A5a…5A5A5A on Pharos Pacific Mainnet.
  It is a call to the USDC contract (0xc879c0…ac1815): transfer(0x5a5A5a…5A5A5A, 100000000).
  Network fee: about 0.000957 PROS (79,786 gas at 10 gwei).
  Balance after: 942,842.429833 USDC.
  ✓ The recipient is a well-formed address: mixed-case, and its EIP-55 checksum is correct
  ✓ The sender holds enough USDC: holds 942,942.429833 USDC; after the payment 942,842.429833 USDC
  ✓ The transfer succeeds when simulated as the sender: eth_call succeeds and estimate_gas says 79,786 gas, at block 21,151,643

  UNSIGNED transaction (nothing was signed or sent):
    to 0xc879c018db60520f4355c26ed1a6d572cdac1815
    value 0  gas 95744  chain 1672
```

## What is in this folder

- [examples/requests.json](examples/requests.json)
- [pharos-pay.js](pharos-pay.js)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/payments.js](../../lib/payments.js)
- [lib/tasks/natural-language-payment-agent.js](../../lib/tasks/natural-language-payment-agent.js)
- [agents/natural-language-payment-agent/pharos-pay.js](pharos-pay.js)
- [scripts/payments-demo.mjs](../../scripts/payments-demo.mjs)
- [scripts/payments-fork-run.mjs](../../scripts/payments-fork-run.mjs)
- [public/js/tasks/natural-language-payment-agent.js](../../public/js/tasks/natural-language-payment-agent.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/payments-demo.json](../../reports/payments-demo.json)
- [reports/payments-fork-run.json](../../reports/payments-fork-run.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/address.js](../../lib/address.js) (also tasks 18, 19, 20, 21), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/cli.js](../../lib/cli.js) (also tasks 1, 2, 3, 4, 13, 16, 18, 19, 20, 21), [lib/defi.js](../../lib/defi.js) (also tasks 14, 15, 16, 18, 19), [lib/invoice.js](../../lib/invoice.js) (also tasks 18, 19), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 15, 16, 18, 19, 20, 21), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 15, 16, 18, 19), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/recurring.js](../../lib/recurring.js) (also tasks 18, 19), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 15, 18, 19), [lib/rlp.js](../../lib/rlp.js) (also tasks 18, 19, 20, 21), [lib/rpc-chain.js](../../lib/rpc-chain.js) (also tasks 5, 6, 8, 10, 11, 12, 18, 19, 20, 21), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 11, 15, 16, 18, 19), [lib/secp256k1.js](../../lib/secp256k1.js) (also tasks 19, 20, 21), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 15, 16, 18, 19), [lib/tasks/dry-run-executor.js](../../lib/tasks/dry-run-executor.js) (also tasks 8, 10, 12, 18, 19), [lib/testnet-report.js](../../lib/testnet-report.js) (also tasks 5, 6, 8, 10, 11, 12, 18, 19, 20), [lib/trace.js](../../lib/trace.js) (all tasks), [scripts/support/fork-chain.mjs](../../scripts/support/fork-chain.mjs) (also tasks 18, 19)

## Tests

3 test files cover this task (run all of them with `npm test`):

```bash
node --test test/payments.test.js test/payments-task.test.js test/payment-audit.test.js
```

## Verify it yourself

- **Check the balance it used.** The demo wallet’s USDC balance on the public RPC.
- **Check an EIP-55 checksum.** The agent’s checksum is Ethereum’s: this should print the address with the same capital letters.
- **Decode the calldata it prepared.** The unsigned transaction’s data is a plain ERC-20 transfer.
- **See a real EVM accept it.** The fork card shows each output signed with a throwaway key and sent to a fork of mainnet. Run it yourself with Foundry.
- **Replay a recorded request.** In the recorded card press Replay: the request is worked out again at the recorded block and compared with the recording.
- **Read the code.** The engine, the CLI, the examples and the recordings are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
