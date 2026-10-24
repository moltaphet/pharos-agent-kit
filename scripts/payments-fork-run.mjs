#!/usr/bin/env node
// The three payment agents (Natural-Language Payment, Invoice-to-Payment, and the reference trick the Recurring Payment Agent relies on) checked on a REAL EVM: a throwaway fork
// of Pharos mainnet (anvil, fake funds) with the live USDC contract.
//
// Each agent only ever produces an UNSIGNED transaction. Here a throwaway key (anvil's public dev account #0, worth nothing) signs the exact bytes the agent hands to a signer
// (`unsignedRaw`), using this repository's own secp256k1 and RLP, and sends them with eth_sendRawTransaction. If the serialization, the calldata or the reference were wrong,
// the chain would refuse the transaction or the balances would not move by exactly the amount; then the reference is read back from the mined transaction.
//
//   node scripts/payments-fork-run.mjs        writes reports/payments-fork-run.json   (needs Foundry: anvil 1.4.0)

import { readFileSync, writeFileSync } from 'node:fs';
import { startFork } from '../lib/saga-fork.js';
import { preparePayment, readReference, CHAIN } from '../lib/payments.js';
import { prepareInvoicePayment } from '../lib/invoice.js';
import { signedLegacyTx } from '../lib/rlp.js';
import { addressFromPrivateKey, sign } from '../lib/secp256k1.js';
import { USDC } from '../lib/protocols.js';
import { usdcStateDiff } from '../lib/defi.js';
import { forkChain } from './support/fork-chain.mjs';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil dev account #0: public, worth nothing
const PAYER = addressFromPrivateKey(KEY);
const invoices = Object.fromEntries(JSON.parse(readFileSync(new URL('../agents/invoice-to-payment-agent/examples/invoices.json', import.meta.url), 'utf8')).map((i) => [i.id, i]));
const fork = await startFork({ port: 8640 });
const raw = async (method, params = []) => {
  const r = await (await fetch(fork.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (r.error) throw Object.assign(new Error(r.error.message), { rpc: r.error });
  return r.result;
};
const usdcOf = async (who) => BigInt(await raw('eth_call', [{ to: USDC, data: '0x70a08231' + who.slice(2).toLowerCase().padStart(64, '0') }, 'latest']));
const nativeOf = async (who) => BigInt(await raw('eth_getBalance', [who, 'latest']));
const log = (s) => process.stderr.write(s + '\n');

// Signs the agent's unsigned transaction with the throwaway key, sends the raw bytes, and reads back what the chain made of it.
async function signAndSend(tx) {
  const u = tx.unsignedRaw;
  const parts = { nonce: u.nonce, gasPrice: BigInt(u.gasPriceWei), gasLimit: tx.gas, to: tx.to, value: BigInt(tx.value), data: tx.data, chainId: tx.chainId };
  const unsigned = (await import('../lib/rlp.js')).unsignedLegacyTx(parts);
  if (unsigned.raw !== u.hex) throw new Error('the serialization the agent handed over is not the one this signer rebuilt from the same fields');
  const sig = sign(unsigned.signingHash, KEY);
  const signed = signedLegacyTx(parts, sig);
  const hash = await raw('eth_sendRawTransaction', [signed.raw]);
  await raw('anvil_mine', ['0x3']);
  const receipt = await raw('eth_getTransactionReceipt', [hash]);
  const mined = await raw('eth_getTransactionByHash', [hash]);
  return { hash, expectedHash: signed.hash, status: receipt.status === '0x1' ? 'success' : 'reverted', gasUsed: Number(BigInt(receipt.gasUsed)), input: mined.input, from: mined.from.toLowerCase() };
}

const cases = [];
try {
  await raw('anvil_setBalance', [PAYER, '0x' + (10n ** 20n).toString(16)]);
  for (const [slot, value] of Object.entries(usdcStateDiff({ owner: PAYER, spender: '0x000000000000000000000000000000000000dEaD', allowance: 0, balance: 5_000_000_000n })[USDC].stateDiff)) await raw('anvil_setStorageAt', [USDC, slot, value]);
  await raw('anvil_mine', ['0x8']);
  const chain = forkChain(raw);
  const to = '0x' + '5a'.repeat(20);
  const payee = (await import('../lib/address.js')).toChecksumAddress(to);

  // 17: a sentence
  for (const [label, text, token, amountRaw] of [['USDC from a sentence', `send 100 USDC to ${payee}`, 'USDC', 100_000_000n], ['PROS from a sentence', `pay 1.5 PROS to ${payee}`, 'PROS', 15n * 10n ** 17n]]) {
    const before = token === 'USDC' ? await usdcOf(payee) : await nativeOf(payee);
    const r = await preparePayment({ chain, rpc: raw, text, from: PAYER });
    if (r.status !== 'ready') throw new Error(`${label}: ${r.status} ${r.reason ?? ''}`);
    const sent = await signAndSend(r.transaction);
    const after = token === 'USDC' ? await usdcOf(payee) : await nativeOf(payee);
    cases.push({ task: 17, label, text, status: r.status, summary: r.summary, to: r.transaction.to, data: r.transaction.data, unsignedHex: r.transaction.unsignedRaw.hex, signingHash: r.transaction.unsignedRaw.signingHash, eip681: r.eip681, sent, payeeBalanceChange: (after - before).toString(), expected: amountRaw.toString(), exact: after - before === amountRaw, hashMatches: sent.hash === sent.expectedHash, signer: sent.from === PAYER.toLowerCase() });
    log(`17 ${label}: ${sent.status}, payee +${after - before} (expected ${amountRaw})`);
  }

  // 19: invoices, each carrying its reference
  for (const id of ['text-usdc', 'json-usdc', 'link-usdc']) {
    const inv = invoices[id];
    const recipient = (await import('../lib/invoice.js')).interpretInvoice(inv.text, { now: Date.parse('2026-10-25') }).out.payee.address;
    const before = await usdcOf(recipient);
    const r = await prepareInvoicePayment({ chain, rpc: raw, invoice: inv.text, from: PAYER, now: Date.parse('2026-10-25') });
    if (!r.status.startsWith('ready')) throw new Error(`${id}: ${r.status} ${r.reason ?? ''}`);
    const sent = await signAndSend(r.transaction);
    const after = await usdcOf(recipient);
    const ref = readReference(sent.input);
    const expectedRaw = BigInt(Math.round(Number(r.amountText.split(' ')[0].replace(/,/g, '')) * 1e6));
    cases.push({ task: 19, label: inv.label, invoiceId: id, status: r.status, reference: r.invoice.reference, summary: r.summary, to: r.transaction.to, data: r.transaction.data, unsignedHex: r.transaction.unsignedRaw.hex, signingHash: r.transaction.unsignedRaw.signingHash, sent, referenceOnChain: ref, referenceMatches: ref === r.invoice.reference, payeeBalanceChange: (after - before).toString(), expected: expectedRaw.toString(), exact: after - before === expectedRaw, hashMatches: sent.hash === sent.expectedHash, signer: sent.from === PAYER.toLowerCase() });
    log(`19 ${id}: ${sent.status}, reference on chain "${ref}", payee +${after - before} (expected ${expectedRaw})`);
  }

  const report = {
    recordedAt: new Date().toISOString(),
    network: `local anvil fork of Pharos mainnet (chain ${CHAIN.id}): the live USDC contract, fake funds; signed with anvil's public dev key #0 (${PAYER}), worth nothing`,
    cases,
    summary: { cases: cases.length, mined: cases.filter((c) => c.sent.status === 'success').length, exactAmounts: cases.filter((c) => c.exact).length, hashesMatch: cases.filter((c) => c.hashMatches).length, referencesRead: cases.filter((c) => c.referenceMatches).length, invoiceCases: cases.filter((c) => c.task === 19).length },
  };
  writeFileSync(new URL('../reports/payments-fork-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/payments-fork-run.json: ${report.summary.mined}/${report.summary.cases} mined, ${report.summary.exactAmounts} exact amounts, ${report.summary.referencesRead}/${report.summary.invoiceCases} references read back from the chain`);
  process.exitCode = report.summary.mined === cases.length && report.summary.exactAmounts === cases.length ? 0 : 1;
} finally {
  fork.stop?.();
}
