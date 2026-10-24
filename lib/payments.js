// The payment agents' shared engine (Natural-Language Payment, Recurring Payment, Invoice-to-Payment): a payment request in, and either questions, a refusal, or a
// summary plus an UNSIGNED transaction out. Nothing here signs or sends: the key is never read, and the only things asked of the chain are reads.
//
// Everything is checked against Pharos mainnet (chain 1672) at one pinned block: the token contract exists and says what the registry says, the sender holds enough
// (and for PROS enough left over for the gas), the recipient is a well-formed address (with its EIP-55 checksum if it has one), and the transfer is simulated as the
// sender (eth_call plus estimate_gas) so a transfer that would revert is refused instead of prepared.

import { checksumStatus, toChecksumAddress } from './address.js';
import { signedLegacyTx, unsignedLegacyTx } from './rlp.js';
import { blockNumber, getBlock, getCode } from './chain.js';
import { asString, asUint, makeReader, publicRpc } from './onchain.js';
import { SEL as DEFI_SEL, explorerAddress, fmtUnits } from './defi.js';
import { dryRun } from './tasks/dry-run-executor.js';
import { MULTICALL3, USDC, WPROS } from './protocols.js';
import { keccak256, selectorOf } from './keccak.js';
import { isAddress } from './abi.js';
import { tracer } from './steps.js';
import { UserError } from './snapshot.js';

export const CHAIN = { id: 1672, name: 'Pharos Pacific Mainnet', explorer: 'https://www.pharosscan.xyz' };

// The tokens the agents know by name: PROS itself and the Pacific Mainnet entries of the official Token Registry (docs.pharos.xyz/getting-started/token-registry).
// Decimals here are what the registry says; every run compares them with what the contract answers.
export const TOKENS = [
  { symbol: 'PROS', name: 'PROS (native)', native: true, decimals: 18, aliases: ['pros', 'pharos'] },
  { symbol: 'WPROS', name: 'Wrapped PROS', address: WPROS, decimals: 18, aliases: ['wpros'] },
  { symbol: 'USDC', name: 'USD Coin', address: USDC, decimals: 6, aliases: ['usdc'] },
  { symbol: 'LINK', name: 'Chainlink Token', address: '0x51e2a24742db77604b881d6781ee16b5b8fcbe29', decimals: 18, aliases: ['link', 'chainlink'] },
  { symbol: 'WETH', name: 'Wrapped ETH', address: '0x1f4b7011ee3d53969bb67f59428a9ec0477856e9', decimals: 18, aliases: ['weth'] },
];
export const TRANSFER = selectorOf('transfer(address,uint256)');
const SYMBOL = selectorOf('symbol()');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const ZERO = '0x0000000000000000000000000000000000000000';
const short = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export const tokenBySymbol = (s) => TOKENS.find((t) => t.symbol === String(s ?? '').toUpperCase()) ?? null;
export const tokenByAddress = (a) => TOKENS.find((t) => t.address && t.address === String(a ?? '').toLowerCase()) ?? null;

// ---- amounts ------------------------------------------------------------------------------------------------------------------------------------

// An exact decimal ("1,250.5") to base units. Refuses more decimals than the token has instead of rounding someone's money.
export function parseDecimal(text, decimals, what = 'amount') {
  const t = String(text ?? '').trim().replace(/,/g, '');
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) throw new UserError(`${what} must be a plain number like 100 or 1,250.50`);
  const [whole, frac = ''] = t.split('.');
  if (frac.length > decimals) throw new UserError(`${what} ${t} has ${frac.length} decimals but this token only has ${decimals}`);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}
const SUFFIX = { k: 1_000, thousand: 1_000, m: 1_000_000, million: 1_000_000 };
// "1.5k" → "1500"; exact, done on the digits, not with floating point.
function expandSuffix(num, suffix) {
  const mult = SUFFIX[String(suffix ?? '').toLowerCase()];
  if (!mult) return num;
  const [w, f = ''] = num.replace(/,/g, '').split('.');
  const zeros = String(mult).length - 1;
  const frac = f.padEnd(zeros, '0');
  return `${w}${frac.slice(0, zeros)}${frac.slice(zeros) ? '.' + frac.slice(zeros) : ''}`.replace(/^0+(?=\d)/, '');
}

// ---- reading what was asked ----------------------------------------------------------------------------------------------------------------------

const VERBS = /\b(send|pay|transfer|give|wire|remit|move|tip|donate|top\s?up)\b/i;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const DOLLAR_WORDS = /\b(dollars?|bucks|usd|stablecoins?)\b|\$/i;
const ETH_WORD = /\beth(er|ereum)?\b/i;

// What can be understood from the sentence alone, and what has to be asked. No chain access. `contacts` is the user's own address book { name: 0x… }.
export function parsePaymentText(input, { contacts = {}, answers = {}, defaults = {} } = {}) {
  const text = String(input ?? '').trim();
  if (!text) throw new UserError('write what to pay, for example "send 100 USDC to 0x…"');
  if (text.length > 400) throw new UserError('the request is too long (400 characters at most): say it in one sentence');
  const notes = [];
  const questions = [];
  const known = {};

  // addresses, and things that look like one but are not
  const addrs = [...text.matchAll(ADDRESS)].map((m) => ({ value: m[0], index: m.index }));
  const bad = [...text.matchAll(/0x[0-9a-fA-F]+/g)].filter((m) => !(m[0].length === 42)).map((m) => m[0]);
  for (const b of bad) questions.push({ field: 'recipient', problem: 'bad-address', question: `"${b.length > 14 ? b.slice(0, 10) + '…' : b}" looks like an address but has ${b.length - 2} hex characters, and an address has exactly 40. Please give the full 0x address.` });
  const without = text.replace(ADDRESS, ' ');

  const cue = (word) => addrs.find((a) => new RegExp(`\\b${word}\\s*(?:wallet|address|account)?\\s*:?\\s*$`, 'i').test(text.slice(Math.max(0, a.index - 28), a.index)));
  const tokenAddr = addrs.find((a) => /\b(token|contract|coin)\s*(?:address)?\s*:?\s*$/i.test(text.slice(Math.max(0, a.index - 24), a.index)));
  const sender = cue('from');
  const recipient = cue('(?:to|→|recipient|payee)') ?? null;
  const rest = addrs.filter((a) => a !== tokenAddr && a !== sender && a !== recipient);
  let to = recipient?.value ?? null;
  let from = sender?.value ?? null;
  if (!to && rest.length === 1) to = rest[0].value;
  else if (!to && rest.length > 1) questions.push({ field: 'recipient', problem: 'two-addresses', question: `I found ${rest.length} addresses and cannot tell which one receives the payment (${rest.map((a) => short(a.value)).join(', ')}). Which one is the recipient?`, options: rest.map((a) => a.value) });

  // a name instead of an address
  if (!to && !questions.some((q) => q.field === 'recipient')) {
    const nameMatch = without.match(/\b(?:to|for)\s+(?!the\b|my\b|a\b|an\b)([A-Za-z][\w.-]{1,30})/i);
    if (nameMatch) {
      const hit = Object.entries(contacts).find(([name]) => name.toLowerCase() === nameMatch[1].toLowerCase());
      if (hit && isAddress(hit[1])) { to = hit[1]; notes.push(`"${hit[0]}" is in your address book as ${hit[1]}.`); }
      else questions.push({ field: 'recipient', problem: 'name', question: `I need a 0x address for "${nameMatch[1]}": names are not addresses, and I will not guess one.` });
    } else questions.push({ field: 'recipient', problem: 'missing', question: 'Who should receive it? Give a 0x address.' });
  }

  // the token
  const found = new Set();
  for (const t of TOKENS) if (new RegExp(`\\b${t.aliases.join('|')}\\b`, 'i').test(without)) found.add(t.symbol);
  let token = null;
  if (tokenAddr) {
    token = tokenByAddress(tokenAddr.value) ?? { symbol: null, address: tokenAddr.value.toLowerCase(), decimals: null, custom: true };
  } else if (found.size === 1) token = tokenBySymbol([...found][0]);
  else if (found.size > 1) questions.push({ field: 'token', problem: 'several-tokens', question: `I see more than one token (${[...found].join(', ')}). Which one should be sent?`, options: [...found] });
  else if (ETH_WORD.test(without)) questions.push({ field: 'token', problem: 'eth', question: 'Pharos has no ETH of its own. Did you mean WETH (wrapped ETH on Pharos)?', options: ['WETH'] });
  else if (DOLLAR_WORDS.test(without)) questions.push({ field: 'token', problem: 'dollars', question: '"Dollars" is not a token. Which one: USDC (Circle’s dollar token on Pharos)?', options: ['USDC'] });
  else questions.push({ field: 'token', problem: 'missing', question: 'Which token? One of ' + TOKENS.map((t) => t.symbol).join(', ') + ', or a token contract address.', options: TOKENS.map((t) => t.symbol) });
  if (!token && !found.size && !ETH_WORD.test(without) && !DOLLAR_WORDS.test(without) && /\b[A-Z]{2,6}\b/.test(without.replace(VERBS, ''))) {
    const unknown = (without.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((w) => !['TO', 'OF', 'MY', 'THE', 'FROM'].includes(w));
    if (unknown.length) { questions.splice(questions.findIndex((q) => q.field === 'token'), 1); questions.push({ field: 'token', problem: 'unknown-token', question: `I do not know a token called ${unknown[0]} on Pharos. Give its 0x contract address, or pick one I know: ${TOKENS.map((t) => t.symbol).join(', ')}.`, options: TOKENS.map((t) => t.symbol) }); }
  }

  // the amount
  const ALL = /\b(all|everything|whole balance|entire balance|max(imum)?)\b/i.test(without);
  const HALF = /\bhalf\b/i.test(without);
  const nums = [...without.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k|m|thousand|million)?\b|(?<![\w.])(\.\d+)\b/gi)].map((m) => ({ text: expandSuffix(`${(m[1] ?? '').replace(/,/g, '')}${m[2] ?? m[4] ?? ''}`, m[3]), index: m.index, len: m[0].length }));
  const symbolRe = new RegExp(`\\b(${TOKENS.flatMap((t) => t.aliases).join('|')})\\b`, 'i');
  const adjacent = nums.filter((n) => symbolRe.test(without.slice(n.index + n.len, n.index + n.len + 12)) || symbolRe.test(without.slice(Math.max(0, n.index - 10), n.index)) || /\$\s*$/.test(without.slice(Math.max(0, n.index - 3), n.index)));
  const pick = adjacent.length ? adjacent : nums;
  const distinct = [...new Set(pick.map((n) => n.text))];
  // another number that is not a time ("in 2 days"), a count or a percentage could be an amount too: asking is cheaper than paying the wrong one
  const UNITS = /^\s*(?:seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|times?|x\b|%|st\b|nd\b|rd\b|th\b|am\b|pm\b)/i;
  const others = adjacent.length ? [...new Set(nums.filter((n) => !pick.includes(n) && !UNITS.test(without.slice(n.index + n.len, n.index + n.len + 12)) && !distinct.includes(n.text)).map((n) => n.text))] : [];
  const SEVERAL = /\b(installments?|instalments?|split|twice|each|every|monthly|weekly|daily|recurring|repeat(?:ing)?)\b/i.test(without);
  let amount = null;
  if (ALL || HALF) questions.push({ field: 'amount', problem: ALL ? 'all' : 'half', question: `"${ALL ? 'All' : 'Half'}" depends on the balance at the moment you sign. Give the exact amount to send.` });
  else if (distinct.length === 1 && (others.length || SEVERAL)) questions.push({ field: 'amount', problem: 'several-payments', question: others.length ? `I found ${[distinct[0], ...others].join(' and ')}. This sounds like more than one payment, and I prepare one payment at a time: which is the amount of THIS payment?` : 'This sounds like a repeating or split payment. I prepare one payment at a time (the Recurring Payment Agent handles schedules): what is the amount of this one payment?', options: [distinct[0], ...others] });
  else if (distinct.length === 1) amount = distinct[0];
  else if (distinct.length > 1) questions.push({ field: 'amount', problem: 'several-amounts', question: `I found more than one number (${distinct.join(', ')}). Which one is the amount?`, options: distinct });
  else questions.push({ field: 'amount', problem: 'missing', question: 'How much should be sent?' });

  if (!VERBS.test(text) && !(amount && to)) {
    return { intent: 'not-a-payment', understood: {}, questions: [], notes, text };
  }

  // the answers a person gave to earlier questions win over what the sentence said
  const answered = (field) => answers[field] != null && String(answers[field]).trim() !== '';
  const drop = (field) => { for (let i = questions.length - 1; i >= 0; i--) if (questions[i].field === field) questions.splice(i, 1); };
  if (answered('amount')) { amount = String(answers.amount).trim(); drop('amount'); }
  if (answered('token')) {
    const v = String(answers.token).trim();
    token = isAddress(v) ? tokenByAddress(v) ?? { symbol: null, address: v.toLowerCase(), decimals: null, custom: true } : tokenBySymbol(v);
    if (!token) throw new UserError(`I do not know a token called "${v}": give one of ${TOKENS.map((t) => t.symbol).join(', ')} or a 0x contract address`);
    drop('token');
  }
  if (answered('recipient')) {
    const v = String(answers.recipient).trim();
    const hit = Object.entries(contacts).find(([name]) => name.toLowerCase() === v.toLowerCase());
    to = hit ? hit[1] : v;
    drop('recipient');
  }
  if (answered('from')) from = String(answers.from).trim();
  from ??= defaults.from ?? null;
  if (!from) questions.push({ field: 'from', problem: 'missing', question: 'Which wallet is paying? I need its address to check the balance.' });

  return { intent: 'payment', understood: { amount, token, recipient: to, from }, questions, notes, text };
}

// ---- building the transaction --------------------------------------------------------------------------------------------------------------------

// A reference (an invoice number, a payment id) rides in the calldata AFTER the transfer's own arguments. The token's ABI decoder ignores trailing bytes, so the
// transfer is unchanged and the reference stays readable on chain in the transaction's input. Bytes only, at most 64.
export function referenceHex(reference) {
  if (reference == null || reference === '') return '';
  const bytes = Buffer.from(String(reference), 'utf8');
  if (bytes.length > 64) throw new UserError('a reference can be at most 64 bytes (an invoice number or payment id, not a description)');
  if (/[\u0000-\u001f]/.test(String(reference))) throw new UserError('a reference cannot contain control characters');
  return bytes.toString('hex');
}
export function readReference(input, { native = false } = {}) {
  const hex = String(input ?? '0x').replace(/^0x/, '');
  const body = native ? hex : hex.slice(8 + 128); // selector + (to, amount) for transfer(address,uint256)
  return body ? Buffer.from(body, 'hex').toString('utf8') : null;
}

export function buildTransfer({ token, to, amountRaw, reference = null }) {
  const ref = referenceHex(reference);
  if (token.native) return { to: to.toLowerCase(), value: amountRaw, data: '0x' + ref };
  return { to: token.address.toLowerCase(), value: 0n, data: TRANSFER + addrWord(to) + word(amountRaw) + ref };
}

// ---- checking it against the chain ---------------------------------------------------------------------------------------------------------------

const check = (id, name, ok, detail, level = ok ? 'pass' : 'fail') => ({ id, name, ok, level, detail });

// Validates one transfer on Pharos mainnet and, if it holds up, prepares the unsigned transaction. `token` is a TOKENS entry (or { address } for an unlisted contract).
export async function assessTransfer({ chain, rpc = publicRpc, from, to, token, amountRaw = null, amountText = null, reference = null, block = null, tr = tracer(), serialize = true }) {
  if (!isAddress(from)) throw new UserError('the paying wallet must be a 0x address');
  const checks = [];
  const lowerFrom = from.toLowerCase();
  const head = await blockNumber(chain);
  const at = block ?? head - 2;
  if (!Number.isInteger(at) || at < 1 || at > head - 2) throw new UserError(`block must be a whole number from 1 to ${head - 2}`);
  const header = await getBlock(chain, at, 'Block header: the time of the block everything is read at');

  // recipient
  const cs = checksumStatus(to);
  if (cs === 'malformed') {
    checks.push(check('recipient', 'The recipient is a well-formed address', false, `"${String(to).slice(0, 20)}" is not 0x followed by 40 hex characters`));
    return { ok: false, checks, block: { number: at, head, timestamp: header.timestamp }, tr };
  }
  checks.push(check('recipient', 'The recipient is a well-formed address', cs !== 'invalid', cs === 'valid' ? 'mixed-case, and its EIP-55 checksum is correct' : cs === 'unchecked' ? 'all one case, so it carries no checksum to verify: check it against the source' : `it is mixed-case but the checksum does not match: a character is probably mistyped (it should read ${toChecksumAddress(to)})`, cs === 'unchecked' ? 'note' : cs === 'valid' ? 'pass' : 'fail'));
  const lowerTo = to.toLowerCase();
  if (lowerTo === ZERO) checks.push(check('recipient-zero', 'The recipient is not the zero address', false, 'anything sent there is burned'));
  if (lowerTo === lowerFrom) checks.push(check('recipient-self', 'The recipient is not the sender', true, 'the payer and the recipient are the same address: nothing would change except the fee', 'note'));
  if (!token.native && lowerTo === token.address) checks.push(check('recipient-token', 'The recipient is not the token contract itself', false, 'tokens sent to their own contract are usually lost'));

  // the token, and what the sender holds
  const reader = makeReader({ chain, rpc, tr, block: at });
  const calls = [{ id: 'nativeBalance', target: MULTICALL3, data: DEFI_SEL.getEthBalance + addrWord(from), label: 'getEthBalance(address)' }];
  if (!token.native) {
    calls.push({ id: 'symbol', target: token.address, data: SYMBOL, label: 'symbol()' }, { id: 'decimals', target: token.address, data: DEFI_SEL.decimals, label: 'decimals()' }, { id: 'balance', target: token.address, data: DEFI_SEL.balanceOf + addrWord(from), label: 'balanceOf(address)' });
  }
  const rows = await reader.batch(calls, `The sender's ${token.native ? 'PROS balance' : 'PROS balance and the token'}`, at);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const nativeBalance = asUint(by.nativeBalance) ?? 0n;
  let decimals = token.decimals;
  let symbol = token.symbol;
  let tokenBalance = null;
  if (!token.native) {
    const code = await getCode(chain, token.address, at, 'Is there a contract at the token address?');
    checks.push(check('token-code', 'The token address holds a contract', Boolean(code), code ? `${token.address} has contract code` : `no contract code at ${token.address}`));
    if (!code) return { ok: false, checks, block: { number: at, head, timestamp: header.timestamp }, tr };
    const onchainDecimals = asUint(by.decimals);
    const onchainSymbol = asString(by.symbol);
    if (onchainDecimals == null) {
      checks.push(check('token-erc20', 'The contract answers like an ERC-20 token', false, 'decimals() did not answer: this is not a token this agent can pay with'));
      return { ok: false, checks, block: { number: at, head, timestamp: header.timestamp }, tr };
    }
    if (token.decimals != null && Number(onchainDecimals) !== token.decimals) checks.push(check('token-decimals', 'The token’s decimals are what the registry says', false, `the registry says ${token.decimals}, the contract says ${onchainDecimals}`));
    decimals = Number(onchainDecimals);
    symbol = onchainSymbol ?? token.symbol ?? '?';
    checks.push(check('token-erc20', 'The contract answers like an ERC-20 token', true, `${symbol} with ${decimals} decimals${token.symbol ? ' (matches the Token Registry)' : ' (not in the Token Registry: check the address with the source)'}`, token.symbol ? 'pass' : 'note'));
    tokenBalance = asUint(by.balance);
  }
  let raw = amountRaw;
  if (raw == null) {
    try { raw = parseDecimal(amountText, decimals, 'amount'); } catch (err) { checks.push(check('amount', 'The amount is exact for this token', false, err.message)); return { ok: false, checks, block: { number: at, head, timestamp: header.timestamp }, tr }; }
  }
  checks.push(check('amount', 'The amount is more than zero and exact for this token', raw > 0n, raw > 0n ? `${fmtUnits(raw, decimals, decimals)} ${symbol} = ${raw} base units` : 'the amount is zero'));
  const fmt = (n) => `${fmtUnits(n, decimals, Math.min(decimals, 8))} ${symbol}`;
  const price = await chain.callTool('get_gas_price', {}, { why: 'The gas price, to cost the transfer and to keep gas back when the payment is in PROS' });
  const tx = buildTransfer({ token, to, amountRaw: raw, reference });

  // the simulation, as the sender (eth_call + estimate_gas), at the same block
  const sim = await dryRun({ chain }, { from, to: tx.to, data: tx.data, value: tx.value.toString() }, { block: at });
  tr.agent('simulate', sim.verdict === 'go' ? `The transfer would succeed: ${sim.gas?.units?.toLocaleString('en-US')} gas.` : `The transfer would fail: ${sim.revert?.message ?? sim.summary}`, { uses: [], output: { verdict: sim.verdict } });
  const gasUnits = sim.gas?.units ?? 100_000;
  const gasLimit = Math.ceil(gasUnits * 1.2);
  const feeWei = BigInt(gasLimit) * BigInt(price.gasPriceWei);

  // balance
  if (token.native) {
    const need = raw + feeWei;
    checks.push(check('balance', 'The sender can cover the payment and its gas', nativeBalance >= need, nativeBalance >= need ? `holds ${fmt(nativeBalance)}; the payment is ${fmt(raw)} and the gas about ${fmtUnits(feeWei, 18, 6)} PROS` : `holds ${fmt(nativeBalance)} but needs ${fmt(need)} (${fmt(raw)} plus about ${fmtUnits(feeWei, 18, 6)} PROS of gas)`));
  } else {
    checks.push(check('balance', `The sender holds enough ${symbol}`, tokenBalance != null && tokenBalance >= raw, tokenBalance == null ? 'the balance could not be read' : tokenBalance >= raw ? `holds ${fmt(tokenBalance)}; after the payment ${fmt(tokenBalance - raw)}` : `holds ${fmt(tokenBalance)} but ${fmt(raw)} was asked: ${fmt(raw - tokenBalance)} short`));
    const fromCode = nativeBalance >= feeWei ? null : await getCode(chain, from, at, 'Is the sender a smart-contract wallet (whose gas may be sponsored)?');
    checks.push(check('gas-balance', 'The sender holds enough PROS for the gas', nativeBalance >= feeWei || Boolean(fromCode),
      nativeBalance >= feeWei ? `holds ${fmtUnits(nativeBalance, 18, 6)} PROS; the gas is about ${fmtUnits(feeWei, 18, 6)} PROS`
        : fromCode ? `holds ${fmtUnits(nativeBalance, 18, 6)} PROS and the gas is about ${fmtUnits(feeWei, 18, 6)} PROS, but the sender is a smart-contract wallet: its gas may be paid by someone else (a bundler or paymaster)`
          : `holds ${fmtUnits(nativeBalance, 18, 6)} PROS but the gas is about ${fmtUnits(feeWei, 18, 6)} PROS: an ordinary account with no PROS cannot send anything`,
      nativeBalance >= feeWei ? 'pass' : fromCode ? 'warn' : 'fail'));
  }
  checks.push(check('simulation', 'The transfer succeeds when simulated as the sender', sim.verdict === 'go', sim.verdict === 'go' ? `eth_call succeeds and estimate_gas says ${gasUnits.toLocaleString('en-US')} gas, at block ${at.toLocaleString('en-US')}` : `it would fail: ${sim.revert?.message ?? sim.summary}`));
  const ok = checks.every((c) => c.ok || c.level === 'note' || c.level === 'warn');

  const out = {
    ok, checks, block: { number: at, head, timestamp: header.timestamp, iso: new Date(header.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') },
    token: { symbol, decimals, native: Boolean(token.native), address: token.address ?? null }, amountRaw: raw, amountText: fmt(raw),
    balances: { native: nativeBalance, token: tokenBalance }, gas: { units: gasUnits, limit: gasLimit, priceWei: BigInt(price.gasPriceWei), feeWei, feeText: `${fmtUnits(feeWei, 18, 6)} PROS` },
    simulation: { verdict: sim.verdict, revert: sim.revert, outcome: sim.outcome }, tr,
  };
  if (ok) out.transaction = await prepareUnsigned({ rpc, from, tx, gasLimit, gasPriceWei: BigInt(price.gasPriceWei), serialize });
  return out;
}

// The unsigned transaction in the forms a wallet takes: a JSON-RPC request, an EIP-681 link, and the RLP bytes a signer signs.
export async function prepareUnsigned({ rpc = publicRpc, from, tx, gasLimit, gasPriceWei, serialize = true }) {
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const params = { from, to: tx.to, data: tx.data, value: hex(tx.value), gas: hex(gasLimit), chainId: hex(CHAIN.id) };
  const out = { chainId: CHAIN.id, from, to: tx.to, value: tx.value.toString(), data: tx.data, gas: gasLimit, walletRequest: { method: 'eth_sendTransaction', params: [params] } };
  if (serialize) {
    const nonce = BigInt(await rpc('eth_getTransactionCount', [from, 'pending']));
    const u = unsignedLegacyTx({ nonce, gasPrice: gasPriceWei, gasLimit, to: tx.to, value: tx.value, data: tx.data, chainId: CHAIN.id });
    out.unsignedRaw = { nonce: Number(nonce), gasPriceWei: gasPriceWei.toString(), serialization: 'rlp([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]) (EIP-155 legacy)', hex: u.raw, signingHash: u.signingHash };
  }
  return out;
}
export function eip681({ token, to, amountRaw }) {
  return token.native ? `ethereum:${to}@${CHAIN.id}?value=${amountRaw}` : `ethereum:${token.address}@${CHAIN.id}/transfer?address=${to}&uint256=${amountRaw}`;
}

// ---- the whole thing, from a sentence ------------------------------------------------------------------------------------------------------------

// A sentence in; questions, a refusal, or a summary and an unsigned transaction out. `answers` carries what the person said to the questions asked before.
export async function preparePayment({ chain, rpc = publicRpc, text, from = null, contacts = {}, answers = {}, block = null }) {
  const tr = tracer();
  const parsed = parsePaymentText(text, { contacts, answers, defaults: { from } });
  tr.agent('parse', parsed.intent === 'payment' ? `Read: ${parsed.understood.amount ?? '?'} ${parsed.understood.token?.symbol ?? '?'} to ${parsed.understood.recipient ? short(parsed.understood.recipient) : '?'}${parsed.questions.length ? `, ${parsed.questions.length} thing${parsed.questions.length === 1 ? '' : 's'} to ask` : ''}.` : 'This is not a payment request.', { uses: [], output: { questions: parsed.questions.map((q) => q.field) } });
  const base = { text: parsed.text, notes: parsed.notes, understood: show(parsed.understood), steps: tr.steps, chainCalls: 0, rpcCalls: 0 };
  if (parsed.intent === 'not-a-payment') return { ...base, status: 'refused', reason: 'I prepare payments: tell me an amount, a token and who gets it, for example "send 100 USDC to 0x…". I did not find a payment in this.' };
  if (parsed.questions.length) return { ...base, status: 'needs-info', questions: parsed.questions };

  const { amount, token, recipient, from: sender } = parsed.understood;
  if (!isAddress(recipient)) return { ...base, status: 'needs-info', questions: [{ field: 'recipient', problem: 'bad-address', question: `"${String(recipient).slice(0, 20)}" is not a 0x address with 40 hex characters. Please give the full address.` }] };
  if (!isAddress(sender)) return { ...base, status: 'needs-info', questions: [{ field: 'from', problem: 'bad-address', question: 'The paying wallet must be a 0x address.' }] };
  const result = await assessTransfer({ chain, rpc, from: sender, to: recipient, token, amountText: amount, block, tr });
  const steps = tr.steps.sort((a, b) => a.n - b.n);
  const counts = { chainCalls: steps.filter((s) => s.actor === 'chain-mcp').length, rpcCalls: steps.filter((s) => s.actor === 'public-rpc').length };
  if (!result.token) return { ...base, ...counts, steps, status: 'blocked', checks: result.checks, block: result.block, reason: result.checks.find((c) => !c.ok)?.detail ?? 'a check failed' };
  const summary = summaryLines({ from: sender, to: recipient, result });
  const view = { ...base, ...counts, steps, checks: result.checks, block: result.block, token: result.token, amountText: result.amountText, gas: { units: result.gas.units, limit: result.gas.limit, feeText: result.gas.feeText }, summary, summaryText: summary.join('\n') };
  if (!result.ok) return { ...view, status: 'blocked', reason: result.checks.find((c) => !c.ok && c.level !== 'warn' && c.level !== 'note')?.detail ?? 'a check failed' };
  return { ...view, status: 'ready', transaction: result.transaction, eip681: eip681({ token: result.token.native ? { native: true } : { address: result.token.address }, to: recipient, amountRaw: result.amountRaw }), neverSent: 'Nothing was signed or sent. This is an unsigned transaction: your wallet signs it, or you do.' };
}

const show = (u) => (u ? { amount: u.amount ?? null, token: u.token ? { symbol: u.token.symbol, address: u.token.address ?? null, native: Boolean(u.token.native) } : null, recipient: u.recipient ?? null, from: u.from ?? null } : {});

export function summaryLines({ from, to, result, reference = null }) {
  const t = result.token;
  const lines = [
    `Send ${result.amountText} from ${short(from)} to ${short(to)} on ${CHAIN.name}.`,
    t.native ? 'This is a plain PROS transfer.' : `It is a call to the ${t.symbol} contract (${short(t.address)}): transfer(${short(to)}, ${result.amountRaw}).`,
  ];
  if (reference) lines.push(`Reference ${JSON.stringify(reference)} is written into the transaction data after the transfer, so it can be read on chain.`);
  const after = t.native ? result.balances.native - result.amountRaw - result.gas.feeWei : (result.balances.token ?? 0n) - result.amountRaw;
  lines.push(`Network fee: about ${result.gas.feeText} (${result.gas.units.toLocaleString('en-US')} gas at ${Number(result.gas.priceWei) / 1e9} gwei).`);
  lines.push(after >= 0n ? `Balance after: ${fmtUnits(after, t.decimals, Math.min(t.decimals, 6))} ${t.symbol}${t.native ? ' (after gas)' : ''}.` : `Balance after: not possible, the sender does not hold enough ${t.symbol}.`);
  return lines;
}

// ---- signing, for tests and for the testnet proofs only --------------------------------------------------------------------------------------------

export { signedLegacyTx, unsignedLegacyTx, keccak256, explorerAddress };
export const explorerTx = (hash) => `${CHAIN.explorer}/tx/${hash}`;
