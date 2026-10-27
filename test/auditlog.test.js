import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildReport, parseWhen, resolveRange, toCsv, toMarkdown, toPdf } from '../lib/auditlog.js';
import { batchRpc, batchRpcStrict } from '../lib/rpc-batch.js';
import { keccak256 } from '../lib/keccak.js';
import { selectorOf } from '../lib/keccak.js';
import { content } from '../public/js/tasks/audit-log-agent.js';

const topic = (s) => '0x' + keccak256(Buffer.from(s));
const TRANSFER = topic('Transfer(address,address,uint256)');
const APPROVAL = topic('Approval(address,address,uint256)');
const SWAP = topic('Swap(address,uint256,uint256,uint256,uint256,address)');
const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const WPROS = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';
const ZERO = '0x' + '00'.repeat(20); const W = '0x' + '11'.repeat(20); const OTHER = '0x' + '22'.repeat(20); const ROUTER = '0x' + '33'.repeat(20); const SPENDER = '0x' + '44'.repeat(20);
const t32 = (a) => '0x' + a.slice(2).padStart(64, '0'); const w32 = (n) => BigInt(n).toString(16).padStart(64, '0');
const hash = (n) => '0x' + n.toString(16).padStart(64, '0');
const log = (address, topics, data, block, n, txn = n) => ({ address, topics, data, blockNumber: '0x' + block.toString(16), transactionHash: hash(txn), logIndex: '0x' + n.toString(16) });
const usdc = (n) => BigInt(n) * 10n ** 6n; const wp = (n) => BigInt(n) * 10n ** 18n;

// a fake chain behind a real HTTP server that answers JSON-RPC batches
function chain({ txs, receipts, logs, nonceStart = 0, nonceEnd = 0 }) {
  const handle = (r) => {
    const { method, params } = r;
    const ok = (result) => ({ jsonrpc: '2.0', id: r.id, result });
    switch (method) {
      case 'eth_blockNumber': return ok('0x2710');
      case 'eth_getBlockByNumber': return ok({ number: params[0], timestamp: '0x' + (1_700_000_000 + parseInt(params[0], 16) * 10).toString(16) });
      case 'eth_getLogs': { const [f] = params; const a = parseInt(f.fromBlock, 16); const b = parseInt(f.toBlock, 16); if (b - a + 1 > 1000) return { jsonrpc: '2.0', id: r.id, error: { message: 'range too large' } };
        return ok(logs.filter((l) => { const n = parseInt(l.blockNumber, 16); if (n < a || n > b || l.topics[0] !== f.topics[0]) return false; return f.topics.slice(1).every((t, i) => t == null || t === l.topics[i + 1]); })); }
      case 'eth_getTransactionByHash': return ok(txs[params[0]] ?? null);
      case 'eth_getTransactionReceipt': return ok(receipts[params[0]] ?? null);
      case 'eth_call': return params[0].data === '0x50d25bcd' ? ok('0x' + w32(5n * 10n ** 17n)) : params[0].data === selectorOf('symbol()') ? ok('0x') : ok('0x' + w32(18));
      case 'eth_getBalance': return ok('0x' + (parseInt(params[1], 16) < 1000 ? wp(10) : wp(7)).toString(16));
      case 'eth_getTransactionCount': return ok('0x' + (parseInt(params[1], 16) < 1000 ? nonceStart : nonceEnd).toString(16));
      default: return { jsonrpc: '2.0', id: r.id, error: { message: `unsupported ${method}` } };
    }
  };
  const server = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(j) ? j.map(handle) : handle(j))); }); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const tx = (h, from, to, input, v = '0x0') => ({ hash: h, from, to, input, value: v });
const rc = (h, block, logs, status = '0x1') => ({ transactionHash: h, blockNumber: '0x' + block.toString(16), status, gasUsed: '0x5208', effectiveGasPrice: '0x' + (10n ** 10n).toString(16), logs });

function scenario() {
  const sel = (s) => selectorOf(s);
  const L = [
    log(USDC, [TRANSFER, t32(OTHER), t32(W)], '0x' + w32(usdc(500)), 100, 1),                       // transfer in
    log(USDC, [TRANSFER, t32(W), t32(OTHER)], '0x' + w32(usdc(120)), 200, 2),                       // transfer out
    log(USDC, [TRANSFER, t32(W), t32(ROUTER)], '0x' + w32(usdc(50)), 300, 3), log(WPROS, [TRANSFER, t32(ROUTER), t32(W)], '0x' + w32(wp(80)), 300, 4, 3), // swap
    log(USDC, [APPROVAL, t32(W), t32(SPENDER)], '0x' + w32((1n << 256n) - 1n), 400, 5),             // unlimited approval
    log(USDC, [TRANSFER, t32(W), t32(SPENDER)], '0x' + w32(usdc(10)), 500, 6),                      // a deposit into a vault: a contract interaction
    log(USDC, [TRANSFER, t32(OTHER), t32(W)], '0x' + w32(usdc(1)), 600, 7),                         // a transaction the node will not return
  ];
  const txs = {
    [hash(1)]: tx(hash(1), OTHER, USDC, sel('transfer(address,uint256)') + '00'), [hash(2)]: tx(hash(2), W, USDC, sel('transfer(address,uint256)') + '00'),
    [hash(3)]: tx(hash(3), W, ROUTER, sel('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)') + '00'),     [hash(5)]: tx(hash(5), W, USDC, sel('approve(address,uint256)') + '00'), [hash(6)]: tx(hash(6), W, SPENDER, sel('deposit(uint256,address)') + '00'),
  };
  const rcs = { [hash(1)]: rc(hash(1), 100, [L[0]]), [hash(2)]: rc(hash(2), 200, [L[1]]), [hash(3)]: rc(hash(3), 300, [L[2], L[3], { topics: [SWAP], data: '0x' }]), [hash(5)]: rc(hash(5), 400, [L[4]]), [hash(6)]: rc(hash(6), 500, [L[5]]) };
  return { logs: L, txs, receipts: rcs };
}

test('dates: strict formats, end of day, real calendar dates', () => {
  assert.equal(parseWhen('2026-10-26'), Date.UTC(2026, 9, 26) / 1000);
  assert.equal(parseWhen('2026-10-26', { endOfDay: true }), Date.UTC(2026, 9, 26, 23, 59, 59) / 1000);
  assert.equal(parseWhen('2026-10-26T14:30', { endOfDay: true }), Date.UTC(2026, 9, 26, 14, 30) / 1000);
  for (const bad of ['', 'yesterday', '26/10/2026', '2026-13-01', '2026-02-30', '2026-10-26T25:00']) assert.throws(() => parseWhen(bad));
});

test('range: the dates become blocks, and bad ranges are refused', async () => {
  const c = await chain({ txs: {}, receipts: {}, logs: [] });
  try {
    const rpc = async (m, p) => (await (await fetch(c.url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
    const t = (b) => new Date((1_700_000_000 + b * 10) * 1000).toISOString().slice(0, 16);
    const r = await resolveRange({ rpc, from: t(1000), to: t(2000) });
    assert.ok(Math.abs(r.fromBlock - 1000) <= 6 && Math.abs(r.toBlock - 2000) <= 6, JSON.stringify(r));
    await assert.rejects(resolveRange({ rpc, from: t(2000), to: t(1000) }), /after its start/);
    await assert.rejects(resolveRange({ rpc, from: '2020-01-01', to: '2026-01-01' }), /at most/);
    await assert.rejects(resolveRange({ rpc, from: '2099-01-01', to: '2099-01-02' }), /future/);
  } finally { c.close(); }
});

test('the report groups transfers in and out, swaps, approvals and contract interactions, with totals', async () => {
  const s = scenario();
  const c = await chain({ ...s, nonceStart: 0, nonceEnd: 5 });
  try {
    const r = await buildReport({ wallet: W, fromBlock: 1, toBlock: 2500, rpcUrl: c.url, now: () => new Date('2026-10-27T00:00:00Z') });
    const cat = (k) => r.events.filter((e) => e.category === k);
    assert.equal(cat('transfer').filter((e) => e.direction === 'in').length, 1);
    assert.equal(cat('transfer').filter((e) => e.direction === 'out').length, 1);
    assert.equal(cat('swap').length, 1);
    assert.match(cat('swap')[0].summary, /Swapped 50 USDC for 80 WPROS/);
    assert.equal(cat('approval').length, 1);
    assert.equal(cat('approval')[0].unlimited, true);
    assert.equal(cat('contract interaction').length, 1);
    assert.match(cat('contract interaction')[0].summary, /Called deposit/);
    assert.equal(r.totals.transfer.in.usd, 500);
    assert.equal(r.totals.transfer.out.usd, 120);
    assert.equal(r.totals.swap.usd, 50);
    assert.equal(r.totals.approval.unlimited, 1);
    assert.deepEqual(r.totals.transfer.perToken.USDC, { in: '500', out: '120' });
    assert.ok(r.notable.some((n) => /unlimited/.test(n.why)), 'an unlimited approval is notable');
    assert.ok(r.notable.every((n) => n.link.startsWith('https://www.pharosscan.xyz/tx/')));
    assert.ok(r.notes.some((n) => /sent 5 transactions/.test(n)), 'the transactions the node cannot list are counted');
    assert.ok(r.notes.some((n) => /could not be read/.test(n)), 'an unreadable transaction is reported, not hidden');
  } finally { c.close(); }
});

test('a vault deposit (one token out, a share token in) is a contract interaction, not a swap; the same two transfers with a swap event are a swap', async () => {
  const SHARE = '0x' + '55'.repeat(20);
  const deposit = [log(USDC, [TRANSFER, t32(W), t32(SPENDER)], '0x' + w32(usdc(100)), 100, 1), log(SHARE, [TRANSFER, t32(ZERO), t32(W)], '0x' + w32(usdc(100)), 100, 2, 1)];
  const txs = { [hash(1)]: tx(hash(1), W, SPENDER, selectorOf('deposit(uint256,address)') + '00') };
  const c = await chain({ logs: deposit, txs, receipts: { [hash(1)]: rc(hash(1), 100, deposit) } });
  try {
    const r = await buildReport({ wallet: W, fromBlock: 1, toBlock: 2500, rpcUrl: c.url });
    assert.deepEqual(r.events.map((e) => e.category), ['contract interaction']);
    assert.match(r.events[0].summary, /Called deposit/);
    assert.match(r.events[0].summary, /sent 100 USDC, received/);
  } finally { c.close(); }
  const withSwap = [...deposit];
  const c2 = await chain({ logs: withSwap, txs: { [hash(1)]: tx(hash(1), W, ROUTER, '0x12345678') }, receipts: { [hash(1)]: rc(hash(1), 100, [...deposit, { topics: [SWAP], data: '0x' }]) } });
  try { assert.deepEqual((await buildReport({ wallet: W, fromBlock: 1, toBlock: 2500, rpcUrl: c2.url })).events.map((e) => e.category), ['swap']); } finally { c2.close(); }
});

test('the exports: Markdown, CSV (with a formula guard) and a structurally valid PDF', async () => {
  const s = scenario();
  const c = await chain({ ...s, nonceStart: 0, nonceEnd: 5 });
  try {
    const r = await buildReport({ wallet: W, fromBlock: 1, toBlock: 2500, rpcUrl: c.url, });
    const md = toMarkdown(r);
    for (const h of ['## Summary', '## Notable transactions', '## Transfers', '## Swaps', '## Approvals', '## Contract interactions', '## Notes and limits']) assert.ok(md.includes(h), h);
    const csv = toCsv(r);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0].split(',').length, 13);
    assert.ok(lines.length >= 6);
    const evil = toCsv({ events: [{ time: 1, block: 1, category: 'transfer', direction: 'in', summary: '=HYPERLINK("http://x","y")', method: 'm', hash: hash(1), link: 'l' }, { time: 1, block: 2, category: 'transfer', direction: 'in', summary: '+1,2', method: 'm', hash: hash(2), link: 'l' }] });
    assert.ok(evil.includes(`"'=HYPERLINK(""http://x"",""y"")"`) && evil.includes(`"'+1,2"`), 'a cell that starts with = or + is neutralised, and commas are quoted');
    const pdf = toPdf(r);
    const text = pdf.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    assert.ok(text.slice(xref).startsWith('xref'), 'startxref points at the table');
    const count = Number(/xref\n0 (\d+)/.exec(text)[1]);
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    assert.equal(offsets.length, count - 1);
    offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} is where the table says`));
  } finally { c.close(); }
});

test('input is validated', async () => {
  for (const wallet of [undefined, '0x123', 'x']) await assert.rejects(buildReport({ wallet, fromBlock: 1, toBlock: 2 }), /wallet/);
  await assert.rejects(buildReport({ wallet: W, fromBlock: 5, toBlock: 2 }), /from <= to/);
  await assert.rejects(buildReport({ wallet: W, fromBlock: 1, toBlock: 10_000_000 }), /days/);
});

test('batches: answers in order, one bad request does not hide the others, and the node is asked for at most the batch size', async () => {
  const sizes = [];
  const server = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); sizes.push(j.length); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j.map((r) => (r.method === 'bad' ? { id: r.id, error: { message: 'no' } } : { id: r.id, result: r.params[0] })).reverse())); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const rows = await batchRpc([...Array.from({ length: 100 }, (_, i) => ({ method: i === 7 ? 'bad' : 'ok', params: [i] }))], { url });
    assert.equal(rows.length, 100);
    assert.equal(rows[8].result, 8);
    assert.equal(rows[7].ok, false);
    assert.ok(sizes.every((n) => n <= 40) && sizes.length === 3, sizes.join());
    await assert.rejects(batchRpcStrict([{ method: 'bad', params: [] }], { url }), /bad failed: no/);
  } finally { server.close(); }
});

test('the recorded reports: every category occurs, and the numbers add up', () => {
  const run = JSON.parse(readFileSync(new URL('../reports/auditlog-run.json', import.meta.url), 'utf8'));
  const seen = new Set();
  for (const w of run.wallets) {
    const r = w.report;
    for (const e of r.events) seen.add(e.category + (e.direction ? `:${e.direction}` : ''));
    assert.equal(r.totals.transfer.in.count + r.totals.transfer.out.count, r.events.filter((e) => e.category === 'transfer').length);
    assert.equal(r.totals.swap.count, r.events.filter((e) => e.category === 'swap').length);
    assert.ok(r.events.every((e) => /^0x[0-9a-f]{64}$/.test(e.hash) && e.link.endsWith(e.hash)));
    assert.ok(r.fromBlock >= run.range.fromBlock && r.toBlock <= run.range.toBlock);
  }
  for (const k of ['transfer:in', 'transfer:out', 'swap', 'approval', 'contract interaction']) assert.ok(seen.has(k), `no ${k} in the recordings`);
  for (const f of ['md', 'csv', 'pdf']) for (const id of ['wallet-a', 'wallet-b', 'wallet-c']) assert.ok(readFileSync(new URL(`../reports/auditlog/${id}.${f}`, import.meta.url)).length > 200);
  assert.equal(readFileSync(new URL('../reports/auditlog/wallet-a.pdf', import.meta.url)).subarray(0, 8).toString(), '%PDF-1.4');
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
