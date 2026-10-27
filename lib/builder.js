// Doc-grounded builder agent: "how do I do X on Pharos?" answered end to end. It (1) asks Developer Docs MCP and keeps only an answer the docs support, with the pages it
// cites; (2) reads the facts it needs (chain ID, RPC, a feed's address) from the docs pages themselves, not from memory; (3) does X through Chain MCP; anything that moves funds is
// PREPARED for the user's signature, never signed; (4) checks the result on chain against the plan and says, step by step, whether it worked. A request the docs do not cover is
// answered with exactly that, and nothing is attempted.

import { isAddress, formatUnits } from './abi.js';
import { buildResult, DOCS_GOAL, parseSearch } from './docs.js';
import { selectorOf } from './keccak.js';
import { rpcCall } from './rpc.js';
import { UserError } from './snapshot.js';

const DOCS = 'https://docs.pharos.xyz';
const PAGES = { pacific: `${DOCS}/getting-started/network/pacific-mainnet`, atlantic: `${DOCS}/getting-started/network/atlantic-testnet`, feeds: `${DOCS}/tooling-and-infrastructure/oracles/chainlink-pe` };
const hex = (n) => '0x' + BigInt(n).toString(16);
const publicRpc = (method, params) => rpcCall(method, params, { why: 'Independent check of a Chain MCP read' });
const text = (r) => (typeof r === 'string' ? r : r?.text ?? r?.content ?? JSON.stringify(r));
const shortAddr = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

// ---- understanding the request ------------------------------------------------------------------------------------------------------------

/** What the user is asking for, in terms of the things this agent knows how to do. Returns null when it is none of them. */
export function parseRequest(question) {
  const q = String(question ?? '').trim();
  if (q.length < 8 || q.length > 400) throw new UserError('ask a question of 8 to 400 characters, like “How do I check the balance of 0x…?”');
  const addrs = q.match(ADDRESS) ?? [];
  const testnet = /\b(atlantic|testnet|phrs)\b/i.test(q);
  const amount = /(\d+(?:\.\d+)?)\s*(?:PROS|PHRS)\b/i.exec(q)?.[1] ?? null;
  const named = (word) => new RegExp(`\\b${word}\\s+(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])`, 'i').exec(q)?.[1] ?? null;
  const pair = /\b([A-Za-z]{2,6})\s*\/\s*USD\b/.exec(q)?.[1]?.toUpperCase() ?? (/\bpros\b/i.test(q) ? 'PROS' : null);
  if (/\bdeploy\b/i.test(q) && /\b(contract|smart contract)\b/i.test(q)) return { recipe: 'deploy', network: 'atlantic', from: named('from') ?? addrs[0] ?? null };
  if (/\b(send|transfer|pay)\b/i.test(q) && amount && addrs.length >= 1 && /\b(PROS|PHRS)\b/i.test(q)) return { recipe: 'send', network: testnet ? 'atlantic' : 'mainnet', amount, to: named('to') ?? addrs.at(-1), from: named('from') ?? (addrs.length > 1 ? addrs[0] : null) };
  if (/\b(price|oracle|feed|chainlink)\b/i.test(q) && pair) return { recipe: 'price-feed', network: 'mainnet', pair: pair + '/USD' };
  if (/\bbalance\b/i.test(q) && addrs.length) return { recipe: 'balance', network: testnet ? 'atlantic' : 'mainnet', address: addrs[0] };
  return null;
}

const strip = (s) => s.replace(ADDRESS, '').replace(/\s+/g, ' ').trim();
const docsQuestion = (req, question) => ({
  balance: 'How do I check the native PROS balance of an address on Pharos?',
  'price-feed': `How do I read the ${req?.pair ?? 'PROS/USD'} price on Pharos from a Chainlink price feed?`,
  send: `How do I send ${req?.network === 'atlantic' ? 'PHRS on the Atlantic testnet' : 'PROS'} to another address on Pharos?`,
  deploy: 'How do I deploy a smart contract to the Pharos Atlantic testnet?',
})[req?.recipe] ?? strip(question);

// ---- facts read from the docs pages ---------------------------------------------------------------------------------------------------------

export function factsFromNetworkPage(md) {
  // the page states its facts as a table: | ChainID | 1672 |, | RPC URL | <https://…> |
  const rows = new Map();
  for (const line of String(md).split('\n')) { const c = line.split('|').map((x) => x.trim()); if (c.length >= 4 && c[1] && c[2] && !/^-+$/.test(c[1])) rows.set(c[1].toLowerCase(), c[2].replace(/^<|>$/g, '')); }
  const find = (re) => [...rows].find(([k]) => re.test(k))?.[1] ?? null;
  const chainId = find(/^chain ?id$/);
  return { chainId: chainId && /^\d+$/.test(chainId) ? Number(chainId) : null, rpc: find(/^rpc (public endpoint|url)$/), explorer: find(/explorer/)?.replace(/\/$/, '') ?? null };
}
export function factsFromFeedsPage(md, pair) {
  const section = md.split(/^## /m).find((s) => /^Pacific Mainnet/.test(s)) ?? '';
  const row = section.split('\n').find((l) => l.split('|')[1]?.trim().toUpperCase() === pair.toUpperCase());
  const cells = row?.split('|').map((c) => c.trim()) ?? [];
  const address = cells.find((c) => /^0x[0-9a-fA-F]{40}$/.test(c)) ?? null;
  const decimals = /\|\s*Decimals\s*\|\s*(\d+)/i.exec(md)?.[1];
  const heartbeat = /Heartbeat\s*\|\s*(\d+)\s*seconds/i.exec(md)?.[1];
  const feeds = section.split('\n').map((l) => l.split('|').map((c) => c.trim())).filter((c) => /^[A-Z0-9]{2,6}\/USD$/i.test(c[1] ?? '')).map((c) => c[1].toUpperCase());
  return { address, decimals: decimals ? Number(decimals) : null, heartbeat: heartbeat ? Number(heartbeat) : null, pairs: feeds };
}

// ---- the run ------------------------------------------------------------------------------------------------------------------------------

function log() {
  const steps = [];
  return { steps, add: (actor, what, result = null, extra = {}) => { steps.push({ n: steps.length + 1, actor, what, result, ...extra }); return steps.length; } };
}
const check = (what, expected, actual, ok) => ({ what, expected: String(expected), actual: String(actual), ok: Boolean(ok) });

async function readDocs({ docs, question, req, L }) {
  const q = docsQuestion(req, question);
  const [ask, search] = await Promise.all([
    docs.callTool('askQuestion', { question: q, goal: DOCS_GOAL }, { why: `Plan: ${q}` }),
    docs.callTool('searchDocumentation', { query: q.replace(/^How do I /i, '').replace(/\?$/, '') }, { why: 'Which pages of the docs are about this?' }),
  ]);
  const result = buildResult({ question: q, askText: text(ask), searchText: text(search) });
  L.add('docs-mcp', `askQuestion + searchDocumentation: “${q}”`, result.found ? `answered, ${result.sources.length} source page(s)` : `not answered: ${result.reason}`);
  return { ...result, docsQuestion: q, hits: parseSearch(text(search)) };
}

async function page(docs, url, L, why) {
  const md = text(await docs.callTool('getPage', { url }, { why }));
  L.add('docs-mcp', `getPage ${url.replace(DOCS, '')}`, `${md.length.toLocaleString('en-US')} characters`);
  return md;
}

const chainOf = (name, clients) => (name === 'atlantic' ? clients.atlantic : clients.chain);
const pageOf = (name) => (name === 'atlantic' ? PAGES.atlantic : PAGES.pacific);

/**
 * Answer one request. clients: { chain (Chain MCP), atlantic (Chain-MCP-shaped RPC client), docs (Docs MCP), rpc (public RPC for mainnet) }.
 * Returns { verdict, plan[], steps[], verification[], sources[], prepared? }.
 */
export async function runRequest({ question, clients, rpc = publicRpc, atlanticRpc = null }) {
  const req = parseRequest(question);
  const L = log();
  const out = { question, request: req, steps: L.steps };
  const docsRes = await readDocs({ docs: clients.docs, question, req, L });
  out.docs = { question: docsRes.docsQuestion, answer: docsRes.answer, sources: docsRes.sources, related: docsRes.related, reason: docsRes.reason };
  if (!docsRes.found) {
    out.verdict = { status: 'not-covered', headline: 'The docs do not cover this, so I did nothing', reason: `${docsRes.reason} I do not improvise an answer or an action for something the documentation does not describe.` };
    out.plan = []; out.verification = [];
    if (docsRes.partial) out.docs.partial = docsRes.partial;
    return out;
  }
  if (!req) {
    out.verdict = { status: 'explained-only', headline: 'The docs explain this, but it is not something I can do myself', reason: 'The answer above is from the docs, with its sources. I can only act on four kinds of request (checking a balance, reading a price feed, preparing a transfer of PROS, preparing a contract deployment), so I stopped at the explanation.' };
    out.plan = []; out.verification = [];
    return out;
  }
  const chain = chainOf(req.network, clients);
  const netPage = await page(clients.docs, pageOf(req.network), L, `Read the network facts for ${req.network}`);
  const net = factsFromNetworkPage(netPage);
  if (!net.chainId) throw new UserError('the docs network page did not state a chain ID: stopping instead of guessing');
  const info = await chain.callTool('get_chain_info', {}, { why: 'Which chain am I connected to?' });
  L.add(req.network === 'atlantic' ? 'chain-rpc' : 'chain-mcp', 'get_chain_info', `chain ID ${info.chainId}`);
  out.network = { name: req.network === 'atlantic' ? 'Pharos Atlantic testnet' : 'Pharos Pacific mainnet', docsChainId: net.chainId, chainId: info.chainId, rpc: net.rpc, explorer: net.explorer, page: pageOf(req.network) };
  const sameChain = Number(info.chainId) === net.chainId;
  const verification = [check(`The chain I am connected to is the one the docs describe (chain ID ${net.chainId})`, net.chainId, info.chainId, sameChain)];
  out.verification = verification;
  if (!sameChain) { out.verdict = { status: 'failure', headline: 'Stopped: the connected chain is not the one in the docs', reason: `The docs say chain ID ${net.chainId}; the connection reports ${info.chainId}.` }; out.plan = []; return out; }
  const src = req.network === 'atlantic' ? 'chain-rpc' : 'chain-mcp';

  if (req.recipe === 'balance') return balanceRecipe({ req, out, L, chain, src, rpc, atlanticRpc, net, verification });
  if (req.recipe === 'price-feed') return feedRecipe({ req, out, L, chain, src, rpc, clients, verification });
  if (req.recipe === 'send') return sendRecipe({ req, out, L, chain, src, net, verification });
  if (req.recipe === 'deploy') return deployRecipe({ req, out, L, chain, src, net, verification });
  throw new UserError('unknown recipe');
}

async function balanceRecipe({ req, out, L, chain, src, rpc, atlanticRpc, net, verification }) {
  if (!isAddress(req.address)) throw new UserError('the address is not a valid 0x address');
  const head = Number((await chain.callTool('get_block_number', {}, { why: 'Pin the read to one block' })).blockNumber) - 2;
  L.add(src, 'get_block_number', `reading at block ${head.toLocaleString('en-US')}, two behind the head`);
  const b = await chain.callTool('get_balance', { address: req.address, block: head }, { why: `Native balance of ${req.address}` });
  const symbol = req.network === 'atlantic' ? 'PHRS' : 'PROS';
  L.add(src, `get_balance ${shortAddr(req.address)}`, `${b.balance} ${symbol}`);
  const other = await (req.network === 'atlantic' ? (atlanticRpc ?? ((m, p) => rpcCall(m, p, { url: 'https://atlantic.dplabs-internal.com' }))) : rpc)('eth_getBalance', [req.address, hex(head)]);
  L.add('public-rpc', `eth_getBalance at block ${head.toLocaleString('en-US')}`, `${BigInt(other)} wei`);
  verification.push(check('A second, independent read of the same block gives the same balance', b.balanceWei, BigInt(other).toString(), BigInt(other).toString() === String(b.balanceWei)));
  out.plan = [
    { step: `Use the ${out.network.name} network (chain ID ${net.chainId}, RPC ${net.rpc})`, from: 'docs', done: verification[0].ok },
    { step: `Ask Chain MCP for the native balance of ${shortAddr(req.address)} (get_balance)`, from: 'docs', done: true },
    { step: 'Check it against a second source', from: 'agent', done: verification[1].ok },
  ];
  out.result = { address: req.address, symbol, balanceWei: String(b.balanceWei), balance: b.balance, block: head, explorer: `${net.explorer}/address/${req.address}` };
  return finish(out, verification, { success: `${req.address.slice(0, 10)}… holds ${b.balance} ${symbol}`, failure: 'the two reads of the balance disagree' });
}

async function feedRecipe({ req, out, L, chain, src, rpc, clients, verification }) {
  const md = await page(clients.docs, PAGES.feeds, L, 'The page that lists the price feeds');
  const f = factsFromFeedsPage(md, req.pair);
  if (!f.address) {
    out.plan = []; out.verdict = { status: 'not-covered', headline: `The docs list no ${req.pair} feed, so I did nothing`, reason: `The docs page lists these feeds on Pacific Mainnet: ${f.pairs.join(', ') || 'none'}. ${req.pair} is not one of them.` };
    return out;
  }
  L.add('agent', `Read the ${req.pair} proxy address from the docs table`, f.address);
  const head = Number((await chain.callTool('get_block_number', {}, { why: 'Pin the read to one block' })).blockNumber) - 2;
  const answerSel = selectorOf('latestAnswer()'); const tsSel = selectorOf('latestTimestamp()');
  const [ans, ts, blk] = await Promise.all([
    chain.callTool('eth_call', { transaction: { to: f.address, data: answerSel }, block: head }, { why: `latestAnswer() of the ${req.pair} feed` }),
    chain.callTool('eth_call', { transaction: { to: f.address, data: tsSel }, block: head }, { why: 'latestTimestamp(): the docs say to check freshness' }),
    chain.callTool('get_block', { block: head }, { why: 'The block time, to judge freshness' }),
  ]);
  const raw = BigInt(ans.result); const observed = Number(BigInt(ts.result)); const blockTime = Number(BigInt(blk.timestamp));
  const decimals = f.decimals ?? 18;
  const price = Number(raw) / 10 ** decimals;
  L.add(src, `eth_call latestAnswer() on ${shortAddr(f.address)}`, `${raw} → $${price.toFixed(4)} (${decimals} decimals, from the docs)`);
  L.add(src, 'eth_call latestTimestamp()', `observed ${new Date(observed * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`);
  const twin = await rpc('eth_call', [{ to: f.address, data: answerSel }, hex(head)]);
  L.add('public-rpc', `eth_call latestAnswer() at block ${head.toLocaleString('en-US')}`, `${BigInt(twin)}`);
  const age = blockTime - observed;
  verification.push(check('A second, independent read of the same block gives the same price', raw, BigInt(twin), BigInt(twin) === raw));
  verification.push(check(`The price is fresh: observed no more than twice the docs’ heartbeat (${f.heartbeat ?? '?'} s) before the block`, `≤ ${(f.heartbeat ?? 3600) * 2} s`, `${age} s`, age >= 0 && age <= (f.heartbeat ?? 3600) * 2));
  verification.push(check('The price is a plausible number (above zero)', '> 0', price.toFixed(6), price > 0));
  out.plan = [
    { step: `Find the ${req.pair} feed on the docs page “Chainlink Push Engine Feeds”: proxy ${shortAddr(f.address)}`, from: 'docs', done: true },
    { step: `Call latestAnswer() through Chain MCP and divide by 10^${decimals} (the docs’ “Decimals”)`, from: 'docs', done: true },
    { step: 'Check freshness with latestTimestamp(), as the docs advise', from: 'docs', done: verification.at(-2).ok },
  ];
  out.result = { pair: req.pair, feed: f.address, price, raw: raw.toString(), decimals, observedAt: observed, ageSeconds: age, block: head, explorer: `${out.network.explorer}/address/${f.address}` };
  return finish(out, verification, { success: `${req.pair} is $${price.toFixed(4)}, observed ${age} s before block ${head.toLocaleString('en-US')}`, failure: 'the price could not be confirmed' });
}

async function fees({ chain, from, to, value = '0x0', data = null, src, L }) {
  const [nonce, gasPrice, bal] = await Promise.all([
    chain.callTool('get_transaction_count', { address: from }, { why: 'The next nonce of the sender' }),
    chain.callTool('get_gas_price', {}, { why: 'The current gas price' }),
    chain.callTool('get_balance', { address: from }, { why: 'Can the sender afford it?' }),
  ]);
  const tx = { from, value, ...(to ? { to } : {}), ...(data ? { data } : {}) };
  const gas = await chain.callTool('estimate_gas', { transaction: tx }, { why: 'Gas needed (also proves the transaction would succeed now)' });
  L.add(src, 'get_transaction_count, get_gas_price, get_balance, estimate_gas', `nonce ${nonce.nonce}, gas price ${gasPrice.gasPriceGwei} gwei, ${gas.gas} gas`);
  return { nonce: Number(nonce.nonce), gasPrice: BigInt(gasPrice.gasPriceWei), gas: BigInt(gas.gas), balance: BigInt(bal.balanceWei) };
}

async function sendRecipe({ req, out, L, chain, src, net, verification }) {
  if (!isAddress(req.to)) throw new UserError('the recipient is not a valid 0x address');
  if (!req.from) { out.plan = []; out.verdict = { status: 'needs-input', headline: 'I need your address to prepare this', reason: 'To prepare the transaction I must read your account’s nonce and balance. Add “from 0x…” (your address) to the question. I never ask for a private key.' }; return out; }
  if (!isAddress(req.from)) throw new UserError('the sender is not a valid 0x address');
  const [w, f = ''] = req.amount.split('.');
  if (f.length > 18) throw new UserError('an amount has at most 18 decimals');
  const value = BigInt(w) * 10n ** 18n + BigInt(f.padEnd(18, '0'));
  if (value === 0n) throw new UserError('the amount must be above zero');
  const q = await fees({ chain, from: req.from, to: req.to, value: hex(value), src, L });
  const fee = q.gas * q.gasPrice;
  const prepared = { chainId: net.chainId, network: out.network.name, from: req.from.toLowerCase(), to: req.to.toLowerCase(), valueWei: value.toString(), nonce: q.nonce, gasLimit: q.gas.toString(), gasPriceWei: q.gasPrice.toString(), maxFeeWei: fee.toString(), balanceWei: q.balance.toString(), data: '0x' };
  const afford = q.balance >= value + fee;
  verification.push(check('The sender can afford the amount plus the maximum fee', `≥ ${formatUnits(value + fee, 18)}`, formatUnits(q.balance, 18), afford));
  verification.push(check('The network accepted the transaction for estimation, so it would succeed now', 'estimate_gas returns a number', `${q.gas} gas`, q.gas >= 21000n));
  out.plan = [
    { step: `Use ${out.network.name} (chain ID ${net.chainId}, from the docs)`, from: 'docs', done: verification[0].ok },
    { step: 'Read the sender’s nonce, the gas price and an estimate of the gas through Chain MCP', from: 'docs', done: true },
    { step: 'Build the transaction and check the sender can pay for it', from: 'agent', done: afford },
    { step: 'Hand it over for the user’s signature (the agent holds no key)', from: 'agent', done: true },
    { step: 'After it is signed and sent, read the receipt and check it against this plan', from: 'agent', done: false },
  ];
  out.prepared = prepared;
  out.verdict = afford ? { status: 'prepared', headline: `Prepared for your signature: ${req.amount} ${req.network === 'atlantic' ? 'PHRS' : 'PROS'} to ${shortAddr(req.to)}`, reason: 'Nothing was sent. Sign this transaction in your wallet (or with your own tool), broadcast it, and give me the transaction hash to verify the outcome on chain.' } : { status: 'failure', headline: 'Stopped: the sender cannot afford this', reason: `It holds ${formatUnits(q.balance, 18)} and needs ${formatUnits(value + fee, 18)} including the fee.` };
  return out;
}

async function deployRecipe({ req, out, L, chain, src, net, verification }) {
  if (!req.from) { out.plan = []; out.verdict = { status: 'needs-input', headline: 'I need your address to prepare this', reason: 'To prepare the deployment I must read your account’s nonce and balance on the testnet. Add “from 0x…” (your address) to the question.' }; return out; }
  if (!isAddress(req.from)) throw new UserError('the deployer is not a valid 0x address');
  const { counterArtifact } = await import('./builder-artifacts.js');
  const art = counterArtifact();
  const q = await fees({ chain, from: req.from, to: null, data: art.bytecode, src, L });
  const fee = q.gas * q.gasPrice;
  const afford = q.balance >= fee;
  verification.push(check('The deployer can afford the maximum fee', `≥ ${formatUnits(fee, 18)}`, formatUnits(q.balance, 18), afford));
  verification.push(check('The network accepted the deployment for estimation', 'estimate_gas returns a number', `${q.gas} gas`, q.gas > 53000n));
  out.plan = [
    { step: `Use ${out.network.name} (chain ID ${net.chainId}, from the docs)`, from: 'docs', done: verification[0].ok },
    { step: 'Take the compiled contract (Counter) and read the deployer’s nonce, the gas price and the gas estimate', from: 'docs', done: true },
    { step: 'Check the deployer can pay for the deployment', from: 'agent', done: afford },
    { step: 'Hand the unsigned deployment over for the user’s signature', from: 'agent', done: true },
    { step: 'After it is mined, check that the receipt has a contract address, that the code there is the compiled code, and that the contract answers a call', from: 'agent', done: false },
  ];
  out.prepared = { chainId: net.chainId, network: out.network.name, from: req.from.toLowerCase(), to: null, valueWei: '0', nonce: q.nonce, gasLimit: q.gas.toString(), gasPriceWei: q.gasPrice.toString(), maxFeeWei: fee.toString(), balanceWei: q.balance.toString(), data: art.bytecode, contract: 'Counter', expectedRuntimeBytes: (art.runtime.length - 2) / 2 };
  out.verdict = afford ? { status: 'prepared', headline: 'Prepared for your signature: deploy the Counter contract to Atlantic', reason: 'Nothing was sent. Sign and broadcast the deployment, and give me the transaction hash to verify it.' } : { status: 'failure', headline: 'Stopped: the deployer cannot afford this', reason: `It holds ${formatUnits(q.balance, 18)} and needs up to ${formatUnits(fee, 18)}.` };
  return out;
}

function finish(out, verification, { success, failure }) {
  const ok = verification.every((v) => v.ok);
  out.verification = verification;
  out.verdict = ok ? { status: 'success', headline: `Done and verified: ${success}`, reason: `All ${verification.length} checks against the plan passed.` } : { status: 'failure', headline: `Not confirmed: ${failure}`, reason: `${verification.filter((v) => !v.ok).length} of ${verification.length} checks failed.` };
  return out;
}

/**
 * After the user has signed and sent a prepared transaction: read its receipt and check the outcome against the plan. `hash` is the transaction hash the user gives back.
 */
export async function verifyOutcome({ prepared, hash, clients, network = 'mainnet' }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new UserError('a transaction hash is 0x followed by 64 hexadecimal digits');
  const chain = chainOf(network, clients);
  const L = log(); const v = [];
  const src = network === 'atlantic' ? 'chain-rpc' : 'chain-mcp';
  const [tx, rc] = await Promise.all([chain.callTool('get_transaction', { hash }, { why: 'The transaction the user sent' }), chain.callTool('get_transaction_receipt', { hash }, { why: 'Its receipt' })]);
  L.add(src, 'get_transaction, get_transaction_receipt', rc ? `mined in block ${Number(BigInt(rc.blockNumber)).toLocaleString('en-US')}, status ${BigInt(rc.status) === 1n ? 'success' : 'failed'}` : 'not mined yet');
  if (!tx || !rc) return { status: 'pending', headline: 'Not mined yet', steps: L.steps, verification: [] };
  v.push(check('The transaction succeeded', 'status 1', `status ${BigInt(rc.status)}`, BigInt(rc.status) === 1n));
  v.push(check('It was sent from the prepared sender', prepared.from, tx.from.toLowerCase(), tx.from.toLowerCase() === prepared.from));
  v.push(check('It used the nonce the plan read', prepared.nonce, Number(BigInt(tx.nonce)), Number(BigInt(tx.nonce)) === prepared.nonce));
  v.push(check('It is on the chain the plan named', prepared.chainId, tx.chainId ? Number(BigInt(tx.chainId)) : prepared.chainId, !tx.chainId || Number(BigInt(tx.chainId)) === prepared.chainId));
  let result = null;
  if (prepared.to) {
    v.push(check('It went to the prepared recipient', prepared.to, tx.to?.toLowerCase(), tx.to?.toLowerCase() === prepared.to));
    v.push(check('It carried the prepared amount', prepared.valueWei, BigInt(tx.value).toString(), BigInt(tx.value).toString() === prepared.valueWei));
    result = { recipient: prepared.to, valueWei: prepared.valueWei };
  } else {
    const address = rc.contractAddress;
    v.push(check('The receipt names a new contract address', 'an address', address ?? 'none', Boolean(address)));
    if (address) {
      const { counterArtifact } = await import('./builder-artifacts.js');
      const art = counterArtifact();
      const code = await chain.callTool('get_code', { address }, { why: 'The code now at the new address' });
      L.add(src, `get_code ${shortAddr(address)}`, `${(code.result.length - 2) / 2} bytes`);
      v.push(check('The code at that address is the compiled Counter code', `${(art.runtime.length - 2) / 2} bytes, identical`, `${(code.result.length - 2) / 2} bytes`, code.result.toLowerCase() === art.runtime.toLowerCase()));
      const call = await chain.callTool('eth_call', { transaction: { to: address, data: selectorOf('count(uint256)') + '0'.repeat(64) } }, { why: 'Does the contract answer? count(0) should be 0' });
      v.push(check('The contract answers a call: count(0) is 0', '0', BigInt(call.result).toString(), BigInt(call.result) === 0n));
      result = { contract: address };
    }
  }
  const ok = v.every((x) => x.ok);
  return { status: ok ? 'success' : 'failure', headline: ok ? 'Done and verified against the plan' : 'The outcome does not match the plan', steps: L.steps, verification: v, result, gasUsed: BigInt(rc.gasUsed).toString(), block: Number(BigInt(rc.blockNumber)) };
}
