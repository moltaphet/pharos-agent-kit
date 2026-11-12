#!/usr/bin/env node
// Deploy and prove the Treasury demo on Atlantic only. The app/API never import this file.
// node scripts/treasury-deploy.mjs --check     public wallet balance/network check, no transactions
// node scripts/treasury-deploy.mjs --live      deploy if needed, mint, approve and pay one test invoice
// An interrupted run saves public deployment checkpoints so it can resume without redeploying.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { keccak256, selectorOf } from '../lib/keccak.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = new URL('../config/treasury.json', import.meta.url);
const REPORT = new URL('../reports/treasury-run.json', import.meta.url);
const BUDGET = 25n * 10n ** 15n; // strict upper bound: 0.025 PHRS, testnet funds only
const WORD = (value) => BigInt(value).toString(16).padStart(64, '0');
const ADDRESS = (value) => value.slice(2).toLowerCase().padStart(64, '0');
const hex = (value) => '0x' + BigInt(value).toString(16);
const live = process.argv.includes('--live');
const checkOnly = process.argv.includes('--check');
if (!live && !checkOnly) {
  console.log('Use --check for read-only readiness, or --live to deploy and prove the Atlantic demonstration.');
  process.exit(0);
}

const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, budgetWei: BUDGET, log: (message) => console.error(message) });
const { rpc } = signer;
const chainId = Number(BigInt(await rpc('eth_chainId')));
if (chainId !== 688689) throw new Error('Refusing to use a network other than Pharos Atlantic Testnet (688689).');
const initialBalance = await signer.balance();
console.log(`Atlantic chain ${chainId}; deployer ${signer.from}; balance ${phrs(initialBalance)}; gas budget ${phrs(BUDGET)}`);
if (checkOnly) process.exit(0);
if (initialBalance < BUDGET) throw new Error(`Need at least ${phrs(BUDGET)} in the ignored testnet wallet before deployment.`);

// Explicit proxy variables let offline Foundry compilation avoid unavailable macOS proxy discovery in a sandbox.
execFileSync('forge', ['build', '--offline', '--root', 'contracts'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' },
});
const artifact = (name) => JSON.parse(readFileSync(new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
const bytecode = (name) => artifact(name).bytecode.object;
const configuration = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {
  chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer, router: null,
  token: { address: null, symbol: 'tUSDC', decimals: 6 }, deployment: {}, demo: null,
};
if (configuration.chainId !== chainId || configuration.rpc !== ATLANTIC.rpc) throw new Error('Existing configuration is for another network.');
const checkpoint = () => writeFileSync(CONFIG, JSON.stringify(configuration, null, 2) + '\n');
const gasPrice = BigInt(await rpc('eth_gasPrice'));
const boundedSend = async ({ label, to, data = '0x', create = null, expectedGas = null }) => {
  const estimate = expectedGas ?? BigInt(await rpc('eth_estimateGas', [{ from: signer.from, ...(to && { to }), data: create ?? data, value: '0x0' }]));
  const gas = Number((BigInt(estimate) * 13n + 9n) / 10n);
  const maximumCost = BigInt(gas) * gasPrice;
  if (signer.spent() + maximumCost > BUDGET) throw new Error(`Refusing ${label}: its maximum gas cost would exceed the testnet budget.`);
  const result = await signer.send({ label, to, data, create, gas, fees: { legacy: true, gasPrice: gasPrice.toString() } });
  if (result.status !== 'success') throw new Error(`${label} reverted: ${result.hash}`);
  return result;
};
const codeAt = async (address) => rpc('eth_getCode', [address, 'latest']);
const call = async (address, data) => rpc('eth_call', [{ to: address, data }, 'latest']);
const tokenBalance = async (address) => BigInt(await call(configuration.token.address, selectorOf('balanceOf(address)') + ADDRESS(address)));

if (!configuration.token.address) {
  const deployed = await boundedSend({ label: 'deploy TreasuryDemoToken', create: bytecode('TreasuryDemoToken') });
  configuration.token.address = deployed.contractAddress;
  configuration.deployment.token = deployed;
  checkpoint();
}
if (await codeAt(configuration.token.address) === '0x') throw new Error('Configured token has no deployed code.');
if (!configuration.router) {
  const deployed = await boundedSend({ label: 'deploy InvoicePaymentRouter', create: bytecode('InvoicePaymentRouter') + ADDRESS(configuration.token.address) });
  configuration.router = deployed.contractAddress;
  configuration.deployment.router = deployed;
  configuration.deployment.compiler = '0.8.24';
  configuration.deployment.evmVersion = 'paris';
  configuration.deployment.createdAt = new Date().toISOString();
  configuration.deployment.status = 'deployed';
  checkpoint();
}
if (await codeAt(configuration.router) === '0x') throw new Error('Configured router has no deployed code.');
const actualToken = '0x' + (await call(configuration.router, selectorOf('token()'))).slice(-40);
if (actualToken.toLowerCase() !== configuration.token.address.toLowerCase()) throw new Error('Router does not use the configured token.');

if (configuration.demo?.hash) {
  const receipt = await rpc('eth_getTransactionReceipt', [configuration.demo.hash]);
  if (receipt?.status !== '0x1') throw new Error('Recorded proof is not a successful Atlantic receipt.');
  console.log(`Existing Treasury deployment and proof verified; router ${configuration.router}; proof ${configuration.demo.hash}`);
  process.exit(0);
}

const amountRaw = 25_000_000n;
if (!configuration.demo) {
  const reference = 'DEMO-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  configuration.demo = { payer: signer.from, recipient: signer.fresh(reference), reference, amount: '25', hash: null };
  checkpoint();
}
if (configuration.demo.payer.toLowerCase() !== signer.from) throw new Error('An unfinished demonstration belongs to another wallet.');
const demo = configuration.demo;
const invoiceId = '0x' + keccak256('pharos-treasury:v1:' + demo.reference);
const paymentData = selectorOf('payInvoice(bytes32,address,uint256)') + invoiceId.slice(2) + ADDRESS(demo.recipient) + WORD(amountRaw);
const alreadyPaid = BigInt(await call(configuration.router, selectorOf('paid(address,bytes32)') + ADDRESS(signer.from) + invoiceId.slice(2))) !== 0n;
if (alreadyPaid) throw new Error('The incomplete demo was already paid. Recover its transaction hash before trying a new payment.');
const before = { payer: (await tokenBalance(signer.from)).toString(), recipient: (await tokenBalance(demo.recipient)).toString() };
const faucet = await boundedSend({ label: 'mint 100 freely available tUSDC', to: configuration.token.address, data: selectorOf('faucet()') });
const approval = await boundedSend({ label: 'approve exactly 25 tUSDC', to: configuration.token.address, data: selectorOf('approve(address,uint256)') + ADDRESS(configuration.router) + WORD(amountRaw) });
const simulation = await rpc('eth_call', [{ from: signer.from, to: configuration.router, data: paymentData }, 'latest']);
const payment = await boundedSend({ label: 'pay Treasury demo invoice', to: configuration.router, data: paymentData });
demo.hash = payment.hash;
checkpoint();

const receipt = await rpc('eth_getTransactionReceipt', [payment.hash]);
const transaction = await rpc('eth_getTransactionByHash', [payment.hash]);
const topic = '0x' + keccak256('InvoicePaid(address,bytes32,address,address,uint256)');
const event = receipt.logs.find((entry) => entry.address.toLowerCase() === configuration.router.toLowerCase() && entry.topics[0] === topic);
const after = { payer: (await tokenBalance(signer.from)).toString(), recipient: (await tokenBalance(demo.recipient)).toString() };
let duplicateBlocked = false;
let duplicateRevertData = null;
try { await rpc('eth_call', [{ from: signer.from, to: configuration.router, data: paymentData }, 'latest']); }
catch (error) {
  duplicateRevertData = error.rpc?.data ?? null;
  duplicateBlocked = (JSON.stringify(duplicateRevertData) ?? '').includes(selectorOf('AlreadyPaid()').slice(2));
}
const checks = [
  { id: 'network', ok: chainId === 688689 },
  { id: 'receipt', ok: receipt.status === '0x1' },
  { id: 'sender-and-router', ok: transaction.from.toLowerCase() === demo.payer.toLowerCase() && transaction.to.toLowerCase() === configuration.router.toLowerCase() },
  { id: 'exact-call', ok: transaction.input.toLowerCase() === paymentData.toLowerCase() },
  { id: 'event', ok: Boolean(event && event.topics[1].toLowerCase() === ('0x' + ADDRESS(demo.payer)) && event.topics[2] === invoiceId && event.topics[3].toLowerCase() === ('0x' + ADDRESS(demo.recipient)) && event.data.toLowerCase() === ('0x' + ADDRESS(configuration.token.address) + WORD(amountRaw))) },
  { id: 'recipient-gained-exact-amount', ok: BigInt(after.recipient) - BigInt(before.recipient) === amountRaw },
  { id: 'payer-mint-minus-payment', ok: BigInt(after.payer) - BigInt(before.payer) === 100_000_000n - amountRaw },
  { id: 'router-held-no-tokens', ok: await tokenBalance(configuration.router) === 0n },
  { id: 'duplicate-blocked', ok: duplicateBlocked },
];
const report = {
  network: 'Pharos Atlantic Testnet', chainId, createdAt: new Date().toISOString(),
  note: 'tUSDC is a freely minted demonstration token with no monetary value; keys are absent from the app and this public report.',
  router: configuration.router, token: configuration.token, demo: { ...demo, invoiceId, amountRaw: amountRaw.toString() },
  transactions: [configuration.deployment.token, configuration.deployment.router, faucet, approval, payment],
  simulation: { result: simulation }, receipt, event, balances: { before, after },
  duplicate: { blocked: duplicateBlocked, revertData: duplicateRevertData }, checks,
  budget: { limitWei: BUDGET.toString(), spentThisRunWei: signer.spent().toString() },
};
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
if (checks.some((entry) => !entry.ok)) throw new Error('A proof check failed; inspect reports/treasury-run.json before claiming success.');
console.log(`Treasury deployed and verified: token ${configuration.token.address}; router ${configuration.router}; payment ${payment.hash}; ${checks.length} checks passed; spent ${phrs(signer.spent())}.`);
