import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoice, paymentData, PAYMENT_TOPIC, addressWord, word } from '../lib/treasury/validation.js';
import { planInvoice, verifyInvoice } from '../lib/treasury/agent.js';
import { createTreasuryTools } from '../lib/treasury/tools.js';
import { readInvoiceText } from '../lib/treasury/intake.js';
import { readHistory, decodePayment, APPROVAL_TOPIC, TRANSFER_TOPIC } from '../lib/treasury/history.js';
import { inspectRecipient } from '../lib/treasury/recipient.js';
import { createWallet } from '../public/js/treasury/wallet.js';
import { createLedger } from '../public/js/treasury/storage.js';

const payer = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const config = { chainId: 688689, router: '0x3333333333333333333333333333333333333333', token: { address: '0x4444444444444444444444444444444444444444', decimals: 6, symbol: 'tUSDC' }, rpc: 'https://atlantic.dplabs-internal.com', explorer: 'https://atlantic.pharosscan.xyz' };
const input = { payer, invoice: { reference: 'INV-001', recipient, amount: '25' }, policy: { maxAmount: '100', allowlist: [] } };
const normalized = validateInvoice(input, config);
const hash = '0x' + 'a'.repeat(64);
const walletState = { chainId: 688689, block: 100, tokenBalanceRaw: '100000000', nativeBalanceRaw: '1000000000000000000', allowanceRaw: '25000000', paid: false, routerToken: config.token.address, tokenCode: '0x01', routerCode: '0x01' };
const docs = { callTool: async () => 'Atlantic Testnet uses chain ID 688689 and PHRS gas. Prepare ERC-20 approval before the payment.\n\n# Sources\n\n- [Atlantic](https://docs.pharos.xyz/getting-started/network/atlantic-testnet)' };
const rpcPlan = async (method) => ({ eth_chainId: '0xa8231', eth_call: '0x', eth_estimateGas: '0x186a0', eth_gasPrice: '0x3b9aca00' })[method];
const tools = (state = walletState) => ({ readWallet: async () => state, close: async () => {} });

test('Treasury rejects ambiguous precision, zero, malformed recipient and references', () => {
  for (const amount of ['0', '-1', '1e3', '0.0000001', '1,25']) assert.throws(() => validateInvoice({ ...input, invoice: { ...input.invoice, amount } }, config));
  assert.throws(() => validateInvoice({ ...input, invoice: { ...input.invoice, recipient: '0x' + '0'.repeat(40) } }, config));
  assert.throws(() => validateInvoice({ ...input, invoice: { ...input.invoice, reference: '<script>' } }, config));
  assert.equal(normalized.invoice.amountRaw, '25000000');
});

test('policy refusal occurs before any Pharos tool or RPC call', async () => {
  let calls = 0;
  const dependencies = { config, tools: { readWallet: async () => { calls++; } }, docs: { callTool: async () => { calls++; } }, rpc: async () => { calls++; } };
  const cap = await planInvoice({ ...input, policy: { maxAmount: '10', allowlist: [] } }, dependencies);
  const allow = await planInvoice({ ...input, policy: { maxAmount: '100', allowlist: [payer] } }, dependencies);
  assert.equal(cap.status, 'blocked');
  assert.equal(allow.status, 'blocked');
  assert.equal(cap.transaction, null);
  assert.equal(calls, 0);
});

test('a funded, approved invoice gets the exact simulated unsigned router call', async () => {
  const plan = await planInvoice(input, { config, tools: tools(), docs, rpc: rpcPlan });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.transaction.to, config.router);
  assert.equal(plan.transaction.data, paymentData(normalized.invoice));
  assert.equal(plan.transaction.chainId, '0xa8231');
  assert.equal(plan.approval, null);
  assert.equal(plan.steps.filter((step) => step.tool.startsWith('Pharos') || step.tool.includes('Docs')).length, 2);
});

test('insufficient allowance prepares only an exact-amount approval, not a payment', async () => {
  const plan = await planInvoice(input, { config, tools: tools({ ...walletState, allowanceRaw: '0' }), docs, rpc: rpcPlan });
  assert.equal(plan.status, 'needs-approval');
  assert.equal(plan.transaction, null);
  assert.equal(plan.approval.to, config.token.address);
  assert.ok(plan.approval.data.endsWith(word('25000000')));
});

test('already-paid, wrong-chain, insufficient funds and token mismatch cannot prepare a transaction', async () => {
  for (const state of [{ ...walletState, paid: true }, { ...walletState, chainId: 1672 }, { ...walletState, tokenBalanceRaw: '1' }, { ...walletState, routerToken: recipient }]) {
    const plan = await planInvoice(input, { config, tools: tools(state), docs, rpc: rpcPlan });
    assert.ok(['already-paid', 'blocked'].includes(plan.status));
    assert.equal(plan.transaction, null);
    assert.equal(plan.approval, null);
  }
});

test('uncited or contradictory Docs output fails closed and closes the read runtime', async () => {
  let closed = false;
  await assert.rejects(planInvoice(input, { config, tools: { readWallet: async () => walletState, close: async () => { closed = true; } }, docs: { callTool: async () => 'Use mainnet chain 1672.' }, rpc: rpcPlan }), /Docs MCP/);
  assert.equal(closed, true);
});

const transaction = { from: payer, to: config.router, input: paymentData(normalized.invoice), value: '0x0' };
const event = { address: config.router, topics: [PAYMENT_TOPIC, '0x' + addressWord(payer), normalized.invoice.invoiceId, '0x' + addressWord(recipient)], data: '0x' + addressWord(config.token.address) + word('25000000') };
const receipt = { status: '0x1', logs: [event], blockNumber: '0x64', gasUsed: '0x186a0' };
const verifyRpc = (tx = transaction, mined = receipt) => async (method) => method === 'eth_chainId' ? '0xa8231' : method === 'eth_getTransactionByHash' ? tx : method === 'eth_getTransactionReceipt' ? mined : null;

test('only a receipt with exact router event can confirm payment', async () => {
  const result = await verifyInvoice({ ...input, hash }, { config, rpc: verifyRpc() });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.blockNumber, 100);
  for (const changed of [{ ...receipt, logs: [] }, { ...receipt, logs: [{ ...event, address: recipient }] }, { ...receipt, logs: [{ ...event, data: '0x' + addressWord(config.token.address) + word('1') }] }]) {
    assert.equal((await verifyInvoice({ ...input, hash }, { config, rpc: verifyRpc(transaction, changed) })).status, 'mismatch');
  }
});

test('successful unrelated transactions cannot unlock or confirm an invoice', async () => {
  for (const changed of [{ ...transaction, from: recipient }, { ...transaction, to: recipient }, { ...transaction, input: '0x' }, { ...transaction, value: '0x1' }]) assert.equal((await verifyInvoice({ ...input, hash }, { config, rpc: verifyRpc(changed) })).status, 'mismatch');
});

test('missing receipt stays pending; a reverted matching transaction is not paid', async () => {
  assert.equal((await verifyInvoice({ ...input, hash }, { config, rpc: verifyRpc(transaction, null) })).status, 'pending');
  assert.equal((await verifyInvoice({ ...input, hash }, { config, rpc: verifyRpc(transaction, { ...receipt, status: '0x0' }) })).status, 'reverted');
  await assert.rejects(verifyInvoice({ ...input, hash }, { config, rpc: async () => '0x688' }), /not Atlantic/);
});

test('official SkillEngine runtime invokes read-only Foundry templates on a pinned Atlantic block', async () => {
  const commands = [];
  const runtime = createTreasuryTools(config, { execute: async (args) => {
    commands.push(args);
    if (args[0] === 'chain-id') return '688689';
    if (args[0] === 'block-number') return '102';
    if (args[0] === 'balance') return '1000000000000000000';
    if (args[0] === 'code') return '0x01';
    if (args[2] === 'decimals()(uint8)') return '6';
    if (args[2] === 'symbol()(string)') return '"tUSDC"';
    if (args[2] === 'paid(address,bytes32)(bool)') return 'false';
    if (args[2] === 'token()(address)') return config.token.address;
    return '25000000 [2.5e7]';
  } });
  const state = await runtime.readWallet({ payer, invoiceId: normalized.invoice.invoiceId });
  assert.equal(state.block, 100);
  assert.equal(state.tokenBalanceRaw, '25000000');
  assert.ok(commands.slice(2).every((args) => args.includes('--block') && args.includes('100')));
  assert.ok(commands.every((args) => !args.includes('send') && !args.includes('--private-key')));
});

test('wallet refuses a wrong network before opening any signature request', async () => {
  const methods = [];
  const wallet = createWallet(() => ({ request: async ({ method }) => { methods.push(method); return method === 'eth_accounts' ? [payer] : '0x688'; } }));
  await assert.rejects(wallet.send({ from: payer, to: config.router, data: '0x' }, { payer, chainId: 688689, beforeSubmit: () => assert.fail('must not reserve') }), /another network/);
  assert.equal(methods.includes('eth_sendTransaction'), false);
});

test('an unrelated attached hash leaves the saved wallet request locked until its real outcome is recovered', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const ledger = createLedger(storage);
  ledger.reserve(config, { id: 'first', payer, kind: 'payment', invoice: input.invoice, status: 'uncertain', hash: null });
  ledger.update(config, 'first', { status: 'mismatch', hash });
  assert.equal(ledger.pending(config, payer).length, 1);
  assert.throws(() => ledger.reserve(config, { id: 'second', payer, status: 'awaiting-wallet' }), /unresolved/);
  ledger.update(config, 'first', { status: 'reverted' });
  ledger.reserve(config, { id: 'second', payer, status: 'awaiting-wallet' });
});

test('standalone Treasury page has a canonical route, working relative assets and a hub link', async () => {
  const { createDevServer } = await import('../dev-server.js');
  const request = (url) => new Promise((resolve) => {
    const server = createDevServer();
    const headers = {};
    server.emit('request', { url, method: 'GET', headers: {} }, { headersSent: false, setHeader(key, value) { headers[key] = value; }, end(body) { resolve({ body: String(body), status: this.statusCode ?? 200, headers }); } });
  });
  for (const path of ['/treasury', '/treasury.html']) {
    const page = await request(path);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Treasury Copilot'));
    assert.ok(page.body.includes('src="js/treasury/main.js"'));
    assert.ok(page.body.includes('href="css/treasury.css"'));
  }
  const redirect = await request('/treasury/');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.Location, '/treasury');
  assert.ok((await request('/')).body.includes('href="/treasury"'));
});

test('Invoice intake reads clear text and asks instead of guessing', () => {
  const ok = readInvoiceText(`Invoice INV-2026-014 from Acme. Please pay 1,250.50 tUSDC to ${recipient.replace(/2/g, 'a')} by Friday.`);
  assert.equal(ok.status, 'complete');
  assert.deepEqual(ok.fields, { reference: 'INV-2026-014', recipient: recipient.replace(/2/g, 'a'), amount: '1250.50' });
  const two = readInvoiceText(`INV-7 10 tUSDC to ${payer} or ${recipient}`);
  assert.equal(two.status, 'needs-clarification');
  assert.equal(two.fields.recipient, undefined);
  assert.match(two.questions[0], /2 possible recipient addresses/);
  const amounts = readInvoiceText(`INV-9: 10 tUSDC then 20 tUSDC to ${recipient}`);
  assert.equal(amounts.fields.amount, undefined);
  assert.equal(amounts.readings.find((r) => r.field === 'amount').status, 'ambiguous');
  const none = readInvoiceText('hello there');
  assert.equal(none.questions.length, 3);
  assert.throws(() => readInvoiceText(''), /Paste the invoice/);
  assert.throws(() => readInvoiceText('x'.repeat(4001)), /under 4000/);
});

test('Invoice intake never reads address digits as money and fields still pass validation', () => {
  const text = `Pay INV-55 25 tUSDC to ${recipient}`;
  const { fields } = readInvoiceText(text);
  assert.equal(fields.amount, '25');
  assert.equal(validateInvoice({ payer, invoice: fields, policy: {} }, config).invoice.amountRaw, '25000000');
});

test('On-chain history decodes InvoicePaid logs in bounded chunks and reports what it covered', async () => {
  const hist = { ...config, deployment: { router: { blockNumber: 5000 } } };
  const log = (block, who, ref) => ({ address: config.router, blockNumber: '0x' + block.toString(16), logIndex: '0x0', transactionHash: '0x' + String(block).padStart(64, '0'), topics: [PAYMENT_TOPIC, '0x' + addressWord(who), '0x' + ref.repeat(64), '0x' + addressWord(recipient)], data: '0x' + addressWord(config.token.address) + (25_000_000).toString(16).padStart(64, '0') });
  const ranges = [];
  const rpc = async (method, params) => {
    if (method === 'eth_blockNumber') return '0x' + (7500).toString(16);
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
    assert.equal(method, 'eth_getLogs');
    const [{ fromBlock, toBlock, topics }] = params;
    const from = Number(BigInt(fromBlock)); const to = Number(BigInt(toBlock));
    assert.ok(to - from + 1 <= 1000, 'a range above the RPC limit');
    ranges.push([from, to]);
    if (topics[1]) assert.equal(topics[1], '0x' + addressWord(payer));
    return [log(6000, payer, 'a'), log(7100, payer, 'b')].filter((l) => Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to);
  };
  const result = await readHistory(hist, { rpc, payer });
  assert.equal(result.total, 2);
  assert.equal(result.complete, true);
  assert.equal(result.fromBlock, 5000);
  assert.deepEqual(result.events.map((e) => e.blockNumber), [7100, 6000]);
  assert.equal(result.events[0].amountRaw, '25000000');
  assert.equal(result.events[0].payer, payer);
  assert.equal(result.events[0].timestamp, 100);
  assert.equal(ranges.length, 3);
  assert.equal((await readHistory(hist, { rpc, limit: 1 })).events.length, 1);
  await assert.rejects(() => readHistory(hist, { rpc, payer: 'not-an-address' }), /Payer/);
});

test('A log for another token, or a malformed log, is not counted as a payment', () => {
  const good = { blockNumber: '0x1', logIndex: '0x0', transactionHash: hash, topics: [PAYMENT_TOPIC, '0x' + addressWord(payer), '0x' + 'c'.repeat(64), '0x' + addressWord(recipient)], data: '0x' + addressWord(config.token.address) + word(1) };
  assert.ok(decodePayment(good, config.token.address));
  assert.equal(decodePayment({ ...good, data: '0x' + addressWord(payer) + word(1) }, config.token.address), null);
  assert.equal(decodePayment({ ...good, topics: good.topics.slice(0, 3) }, config.token.address), null);
  assert.equal(decodePayment({ ...good, data: '0x1234' }, config.token.address), null);
});

const recipientRpc = ({ code = '0x', nonce = '0x0', balance = '0x0', logs = [] } = {}) => async (method) => ({
  eth_getCode: code, eth_getTransactionCount: nonce, eth_getBalance: balance, eth_blockNumber: '0x2710', eth_getLogs: logs, eth_getBlockByNumber: { timestamp: '0x64' },
})[method];

test('Recipient inspection warns for contracts and unused addresses, and stays quiet for known ones', async () => {
  const unused = await inspectRecipient(config, { recipient, payer, rpc: recipientRpc() });
  assert.equal(unused.acknowledgement.required, true);
  assert.deepEqual(unused.acknowledgement.reasons, ['unused-recipient']);
  const contract = await inspectRecipient(config, { recipient, payer, rpc: recipientRpc({ code: '0x6001' }) });
  assert.deepEqual(contract.acknowledgement.reasons, ['contract-recipient']);
  const active = await inspectRecipient(config, { recipient, payer, rpc: recipientRpc({ nonce: '0x5', balance: '0xde0b6b3a7640000' }) });
  assert.equal(active.acknowledgement.required, false);
  assert.equal(active.paidBefore, 0);
  assert.ok(active.advisories.some((entry) => entry.id === 'first-payment'));
  await assert.rejects(() => inspectRecipient(config, { recipient, payer, rpc: async () => undefined }), /could not be read/);
});

test('A recipient this wallet has paid before is recognised and needs no confirmation', async () => {
  const log = { address: config.router, blockNumber: '0x100', logIndex: '0x0', transactionHash: hash, topics: [PAYMENT_TOPIC, '0x' + addressWord(payer), '0x' + 'd'.repeat(64), '0x' + addressWord(recipient)], data: '0x' + addressWord(config.token.address) + word(5_000_000) };
  const known = await inspectRecipient(config, { recipient, payer, rpc: recipientRpc({ logs: [log] }) });
  assert.equal(known.paidBefore > 0, true);
  assert.equal(known.acknowledgement.required, false);
  assert.ok(known.advisories.some((entry) => entry.id === 'paid-before'));
});

test('The plan carries the recipient advisories and asks for confirmation when needed', async () => {
  const rpc = async (method, params) => (['eth_getCode', 'eth_getTransactionCount', 'eth_getBalance', 'eth_blockNumber', 'eth_getLogs', 'eth_getBlockByNumber'].includes(method) ? recipientRpc()(method) : rpcPlan(method, params));
  const plan = await planInvoice(input, { config, tools: tools(), docs, rpc });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.acknowledgement.required, true);
  assert.ok(plan.steps.some((step) => step.title === 'Inspect the recipient address'));
  const unreadable = await planInvoice(input, { config, tools: tools(), docs, rpc: rpcPlan });
  assert.equal(unreadable.status, 'ready');
  assert.deepEqual(unreadable.acknowledgement.reasons, ['recipient-unreadable']);
});

test('Ledger activity lists payments, user approvals and mints, and ignores allowance bookkeeping', async () => {
  const hist = { ...config, deployment: { router: { blockNumber: 7000 } } };
  const pad = (a) => '0x' + addressWord(a);
  const tokenLog = (block, hashSuffix, topics, amount) => ({ address: config.token.address, blockNumber: '0x' + block.toString(16), logIndex: '0x0', transactionHash: '0x' + hashSuffix.repeat(64), topics, data: '0x' + word(amount) });
  const paymentLog = { address: config.router, blockNumber: '0x1bbc', logIndex: '0x2', transactionHash: '0x' + 'b'.repeat(64), topics: [PAYMENT_TOPIC, pad(payer), '0x' + 'e'.repeat(64), pad(recipient)], data: '0x' + addressWord(config.token.address) + word(5_000_000) };
  const logs = [
    tokenLog(7000, 'a', [TRANSFER_TOPIC, '0x' + '0'.repeat(64), pad(payer)], 100_000_000), // mint
    tokenLog(7100, 'c', [APPROVAL_TOPIC, pad(payer), pad(config.router)], 5_000_000), // user approval
    tokenLog(7100, 'b', [TRANSFER_TOPIC, pad(payer), pad(recipient)], 5_000_000), // part of the payment
    tokenLog(7100, 'b', [APPROVAL_TOPIC, pad(payer), pad(config.router)], 0), // allowance used up inside the payment
    paymentLog,
    tokenLog(7150, 'd', [APPROVAL_TOPIC, pad(payer), pad(recipient)], 1), // approval for someone else
  ];
  const rpc = async (method, params) => {
    if (method === 'eth_blockNumber') return '0x1c20'; // 7200
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
    assert.deepEqual(params[0].address, [config.router, config.token.address]);
    return logs.filter((l) => Number(BigInt(l.blockNumber)) >= Number(BigInt(params[0].fromBlock)) && Number(BigInt(l.blockNumber)) <= Number(BigInt(params[0].toBlock)));
  };
  const result = await readHistory(hist, { rpc, activity: true, window: 5000 });
  assert.deepEqual(result.events.map((e) => e.kind).sort(), ['approval', 'mint', 'payment']);
  assert.equal(result.events.find((e) => e.kind === 'mint').payer, payer);
  assert.equal(result.events.find((e) => e.kind === 'approval').amountRaw, '5000000');
  const mine = await readHistory(hist, { rpc, activity: true, window: 5000, payer: recipient });
  assert.equal(mine.total, 0);
  const receipts = await readHistory(hist, { rpc, activity: true, window: 5000, kinds: ['payment'] });
  assert.deepEqual(receipts.events.map((e) => e.kind), ['payment']);
  assert.equal(receipts.total, 1);
});
