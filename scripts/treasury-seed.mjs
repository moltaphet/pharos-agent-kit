#!/usr/bin/env node
// Makes a set of real Treasury transactions on Atlantic so the on-chain receipt ledger has history to show.
// node scripts/treasury-seed.mjs --check     read-only: shows what would be sent and whether the wallet can afford it
// node scripts/treasury-seed.mjs --live      mint test tokens, approve the exact total once, then pay several invoices
// Atlantic only, bounded by a gas budget, resumable (a reference that is already paid is skipped). Uses the same
// throwaway testnet wallet and signer as the deployment script; the app and the API never import this file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { keccak256, selectorOf } from '../lib/keccak.js';

const CONFIG = new URL('../config/treasury.json', import.meta.url);
const REPORT = new URL('../reports/treasury-seed.json', import.meta.url);
const BUDGET = 20n * 10n ** 15n; // strict upper bound: 0.02 PHRS, testnet funds only
const WORD = (value) => BigInt(value).toString(16).padStart(64, '0');
const ADDRESS = (value) => value.slice(2).toLowerCase().padStart(64, '0');
const live = process.argv.includes('--live');
if (!live && !process.argv.includes('--check')) {
  console.log('Use --check for a read-only plan, or --live to send the transactions on Atlantic.');
  process.exit(0);
}

// Realistic invoices a small team might pay in a month. Amounts are in tUSDC (6 decimals), a valueless demonstration token.
const INVOICES = [
  ['ACME-2026-114', '12.5'], ['DESIGN-RETAINER-NOV', '8'], ['AUDIT-0042', '15'], ['HOSTING-NOV-2026', '6.25'],
  ['GRANT-MILESTONE-2', '10'], ['TRANSLATION-0911', '4.5'], ['BOUNTY-1187', '9'], ['SUPPORT-OCT', '4.75'],
  ['LEGAL-REVIEW-0318', '7.5'], ['CLOUD-CREDITS-NOV', '11'], ['COMMUNITY-AMA-02', '2.25'], ['DOCS-BOUNTY-0931', '5'], ['DESIGN-ASSETS-V2', '9.25'], ['QA-SPRINT-14', '6'],
];
const raw = (amount) => { const [whole, fraction = ''] = amount.split('.'); return BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, '0')); };
const TOTAL = INVOICES.reduce((sum, [, amount]) => sum + raw(amount), 0n);

const configuration = JSON.parse(readFileSync(CONFIG, 'utf8'));
if (configuration.chainId !== 688689 || !configuration.router || !configuration.token?.address) throw new Error('The Treasury contracts must be deployed on Atlantic first.');
const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, budgetWei: BUDGET, log: (message) => console.error(message) });
const { rpc } = signer;
if (Number(BigInt(await rpc('eth_chainId'))) !== 688689) throw new Error('Refusing to use a network other than Pharos Atlantic Testnet (688689).');
const gasPrice = BigInt(await rpc('eth_gasPrice'));
const balance = await signer.balance();
const call = (address, data) => rpc('eth_call', [{ to: address, data }, 'latest']);
const tokenBalance = async (address) => BigInt(await call(configuration.token.address, selectorOf('balanceOf(address)') + ADDRESS(address)));
const idOf = (reference) => '0x' + keccak256('pharos-treasury:v1:' + reference);
const isPaid = async (reference) => BigInt(await call(configuration.router, selectorOf('paid(address,bytes32)') + ADDRESS(signer.from) + idOf(reference).slice(2))) !== 0n;

console.log(`Atlantic 688689; wallet ${signer.from}; ${phrs(balance)}; gas budget ${phrs(BUDGET)}; gas price ${Number(gasPrice) / 1e9} gwei`);
console.log(`Plan: mint 100 tUSDC, approve exactly ${Number(TOTAL) / 1e6} tUSDC once, pay ${INVOICES.length} invoices.`);
const pending = [];
for (const [reference, amount] of INVOICES) pending.push([reference, amount, await isPaid(reference)]);
pending.forEach(([reference, amount, paid]) => console.log(`  ${paid ? 'already paid' : 'to pay     '}  ${reference.padEnd(22)} ${amount} tUSDC`));
const estimatedCost = BigInt(70_000 + 50_000 + INVOICES.length * 100_000) * gasPrice;
console.log(`Estimated gas cost at most ${phrs(estimatedCost)}.`);
if (!live) process.exit(0);
if (balance < estimatedCost) throw new Error(`The wallet needs at least ${phrs(estimatedCost)} before sending.`);
const todo = pending.filter(([, , paid]) => !paid);
if (!todo.length) { console.log('Every invoice in the plan is already paid.'); process.exit(0); }

const boundedSend = async ({ label, to, data }) => {
  const estimate = BigInt(await rpc('eth_estimateGas', [{ from: signer.from, to, data, value: '0x0' }]));
  const gas = Number((estimate * 13n + 9n) / 10n);
  if (signer.spent() + BigInt(gas) * gasPrice > BUDGET) throw new Error(`Refusing ${label}: its maximum gas cost would exceed the budget.`);
  const result = await signer.send({ label, to, data, gas, fees: { legacy: true, gasPrice: gasPrice.toString() } });
  if (result.status !== 'success') throw new Error(`${label} reverted: ${result.hash}`);
  return result;
};

const needed = todo.reduce((sum, [, amount]) => sum + raw(amount), 0n);
const transactions = [];
if ((await tokenBalance(signer.from)) < needed) transactions.push(await boundedSend({ label: 'mint 100 test tUSDC', to: configuration.token.address, data: selectorOf('faucet()') }));
transactions.push(await boundedSend({ label: `approve exactly ${Number(needed) / 1e6} tUSDC`, to: configuration.token.address, data: selectorOf('approve(address,uint256)') + ADDRESS(configuration.router) + WORD(needed) }));

const payments = [];
const topic = '0x' + keccak256('InvoicePaid(address,bytes32,address,address,uint256)');
for (const [reference, amount] of todo) {
  const recipient = signer.fresh(reference);
  const data = selectorOf('payInvoice(bytes32,address,uint256)') + idOf(reference).slice(2) + ADDRESS(recipient) + WORD(raw(amount));
  await rpc('eth_call', [{ from: signer.from, to: configuration.router, data }, 'latest']);
  const before = await tokenBalance(recipient);
  const tx = await boundedSend({ label: `pay ${reference} (${amount} tUSDC)`, to: configuration.router, data });
  const receipt = await rpc('eth_getTransactionReceipt', [tx.hash]);
  const event = receipt.logs.find((entry) => entry.address.toLowerCase() === configuration.router.toLowerCase() && entry.topics[0] === topic && entry.topics[2] === idOf(reference));
  const gained = (await tokenBalance(recipient)) - before;
  if (!event || gained !== raw(amount)) throw new Error(`Verification failed for ${reference}; inspect ${tx.hash} before continuing.`);
  transactions.push(tx);
  payments.push({ reference, invoiceId: idOf(reference), recipient, amount, amountRaw: raw(amount).toString(), hash: tx.hash, blockNumber: tx.blockNumber });
}

// Readable references for the ledger: the invoice ID is the Keccak-256 of "pharos-treasury:v1:" + reference, so anyone can check it.
const references = { ...(configuration.references ?? {}) };
if (configuration.demo?.reference) references[idOf(configuration.demo.reference)] = configuration.demo.reference;
for (const payment of payments) references[payment.invoiceId] = payment.reference;
configuration.references = references;
writeFileSync(CONFIG, JSON.stringify(configuration, null, 2) + '\n');
const previous = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { payments: [], transactions: [] };
writeFileSync(REPORT, JSON.stringify({
  network: 'Pharos Atlantic Testnet', chainId: 688689, createdAt: new Date().toISOString(),
  note: 'tUSDC is a freely minted demonstration token with no monetary value. Every payment was checked against its InvoicePaid event and the recipient balance.',
  payer: signer.from, router: configuration.router, token: configuration.token.address,
  payments: [...previous.payments, ...payments], transactions: [...previous.transactions, ...transactions],
  budget: { limitWei: BUDGET.toString(), spentThisRunWei: signer.spent().toString() },
}, null, 2) + '\n');
console.log(`Sent ${transactions.length} transactions (${payments.length} invoice payments); spent ${phrs(signer.spent())}. Report: reports/treasury-seed.json`);
