// The Invoice-to-Payment Agent's engine: an invoice in (plain text, JSON, or an EIP-681 payment link), and either a list of what is wrong with it or a payment summary and
// an UNSIGNED transaction that carries the invoice's reference. Nothing is guessed: a field the invoice does not give, or two places in it that disagree, is a flag, and a
// flag that is an error means no transaction is prepared. Nothing here signs or sends.

import { checksumStatus, toChecksumAddress } from './address.js';
import { CHAIN, TOKENS, assessTransfer, eip681, parseDecimal, summaryLines, tokenByAddress, tokenBySymbol } from './payments.js';
import { publicRpc } from './onchain.js';
import { isAddress } from './abi.js';
import { tracer } from './steps.js';
import { UserError } from './snapshot.js';

export const FIAT = { USD: 'US dollars', EUR: 'euros', GBP: 'pounds', JPY: 'yen', CAD: 'Canadian dollars', AUD: 'Australian dollars', CHF: 'Swiss francs', CNY: 'yuan', INR: 'rupees', AED: 'dirhams' };
const MAX_INVOICE = 6000;
const money = (s) => {
  const raw = String(s ?? '').trim().replace(/^[$€£]\s*/, '');
  if (raw.includes(',') && !/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) throw new UserError('invoice amounts need correctly grouped thousands, such as 1,250.50');
  const value = raw.replace(/,/g, '');
  if (!/^-?(?:\d+(\.\d+)?|\.\d+)$/.test(value)) throw new UserError('invoice amounts and quantities must be plain decimal numbers');
  return value;
};
const flag = (severity, code, message, field = null) => ({ severity, code, message, field });
const short = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;

// ---- reading the three formats -------------------------------------------------------------------------------------------------------------------

export function detectFormat(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new UserError('paste an invoice: plain text, JSON, or an ethereum: payment link');
  if (t.length > MAX_INVOICE) throw new UserError(`the invoice is too long (${MAX_INVOICE.toLocaleString('en-US')} characters at most)`);
  if (/^\s*[{[]/.test(t)) return 'json';
  if (/^(ethereum|pay):/i.test(t)) return 'link';
  return 'text';
}

const LABELS = {
  reference: /^(?:invoice\s*(?:no\.?|number|#|id|ref(?:erence)?)\s*[:#-]?\s*|inv\s*(?:no\.?|#)\s*[:#-]?\s*|invoice\s*[:#]\s*|(?:payment\s*)?ref(?:erence)?(?:\s*(?:no\.?|number))?\s*[:#-]\s*|order\s*(?:no\.?|number|id)\s*[:#-]?\s*)(.+)$/i,
  payee: /^(?:pay\s*to|payable\s*to|payment\s*address|wallet(?:\s*address)?|remit\s*to|send\s*to|recipient|payee)\s*[:-]\s*(.+)$/i,
  name: /^(?:from|issued\s*by|seller|vendor|supplier|bill(?:ed)?\s*from|company)\s*[:-]\s*(.+)$/i,
  due: /^(?:due(?:\s*date)?|pay\s*by|payment\s*due)\s*[:-]\s*(.+)$/i,
  issued: /^(?:date|issued|invoice\s*date|issue\s*date)\s*[:-]\s*(.+)$/i,
  total: /^(?:total(?:\s*due)?|amount\s*due|balance\s*due|grand\s*total|please\s*pay|to\s*pay|amount(?:\s*payable)?)\s*[:-]?\s*(.+)$/i,
  subtotal: /^sub\s*-?\s*total\s*[:-]?\s*(.+)$/i,
  tax: /^(?:tax|vat|gst|sales\s*tax)(?:\s*\(?[\d.]+%?\)?)?\s*[:-]?\s*(.+)$/i,
  discount: /^discount\s*[:-]?\s*-?\s*(.+)$/i,
  currency: /^currency\s*[:-]\s*(.+)$/i,
  token: /^(?:token|asset|pay\s*in)\s*[:-]\s*(.+)$/i,
  network: /^(?:network|chain)\s*[:-]\s*(.+)$/i,
};

// "250.00 USDC", "USDC 250", "$250", "€1,200.50", "250" → { number, unit }
export function parseMoney(raw) {
  const t = String(raw ?? '').trim();
  const sym = t.match(/\b([A-Za-z]{2,6})\b/)?.[1]?.toUpperCase() ?? (t.includes('$') ? 'USD' : t.includes('€') ? 'EUR' : t.includes('£') ? 'GBP' : null);
  const num = t.replace(/[A-Za-z$€£]/g, '').trim().match(/^(?:-?\d[\d,]*(?:\.\d+)?|-?\.\d+)$/);
  if (!num) return null;
  return { text: money(num[0]), unit: sym };
}

function readText(text) {
  const fields = { items: [], addresses: [], totals: [], conflicts: [] };
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const line of lines) {
    for (const a of line.matchAll(/0x[0-9a-fA-F]+/g)) fields.addresses.push({ value: a[0], line });
    const heading = line.match(/^invoice\b\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*([\w][\w./-]*)\s*$/i);
    if (heading && !fields.reference && /\d/.test(heading[1])) { fields.reference = heading[1]; continue; }
    let hit = false;
    for (const key of ['subtotal', 'tax', 'discount', 'total', 'reference', 'payee', 'name', 'due', 'issued', 'currency', 'token', 'network']) {
      const m = line.match(LABELS[key]);
      if (!m) continue;
      hit = true;
      if (key === 'total') fields.totals.push({ label: line.split(/[:\s]/)[0], ...parseMoney(m[1]), raw: m[1] });
      else if (['subtotal', 'tax', 'discount'].includes(key)) fields[key] = parseMoney(m[1]);
      else {
        const value = m[1].trim();
        if (fields[key] != null && fields[key] !== value) fields.conflicts.push(key);
        fields[key] = fields[key] ?? value;
      }
      break;
    }
    if (hit) continue;
    const item = line.match(/^(?:[-*•]\s*)?(.+?)\s+(?:x\s*)?(\d+(?:\.\d+)?)\s*(?:x|×|@)\s*([\d,]+(?:\.\d+)?)\s*[A-Za-z]{0,6}\s*(?:=\s*([\d,]+(?:\.\d+)?))?$/i)
      ?? line.match(/^(?:[-*•]\s*)?(.+?)\s*[:\-–]\s*([\d,]+(?:\.\d+)?)\s*[A-Za-z]{0,6}$/);
    if (item) fields.items.push(item.length === 5 ? { description: item[1], quantity: item[2], unit: money(item[3]), amount: item[4] ? money(item[4]) : mulDecimal(money(item[3]), item[2]) } : { description: item[1], quantity: '1', unit: money(item[2]), amount: money(item[2]) });
  }
  return fields;
}

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o); if (v != null && v !== '') return v; } return undefined; };

function readJson(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (err) { throw new UserError(`the invoice is not valid JSON: ${err.message}`); }
  const body = doc.invoice ?? doc;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new UserError('the JSON invoice must be an object (or {"invoice": {…}})');
  const inv = { ...body, payment: body.payment ?? doc.payment }; // the payment details may sit beside the invoice or inside it
  const fields = { items: [], addresses: [], totals: [] };
  fields.reference = pick(inv, 'id', 'number', 'invoiceNumber', 'invoice_number', 'reference', 'ref');
  fields.name = pick(inv, 'payee.name', 'seller.name', 'vendor.name', 'from.name', 'from', 'issuer');
  fields.payee = pick(inv, 'payee.address', 'payee.wallet', 'payTo', 'pay_to', 'wallet', 'address', 'payment.address', 'payment.to', 'seller.wallet');
  const payeeObj = typeof inv.payee === 'string' ? inv.payee : null;
  if (!fields.payee && payeeObj) fields.payee = payeeObj;
  fields.due = pick(inv, 'due', 'dueDate', 'due_date', 'payBy');
  fields.issued = pick(inv, 'issued', 'date', 'issueDate', 'issue_date');
  const cur = pick(inv, 'currency', 'total.currency', 'amount.currency', 'payment.currency', 'payment.token.symbol');
  fields.currency = cur != null ? String(cur) : undefined;
  fields.token = pick(inv, 'payment.token.address', 'payment.token', 'token.address', 'token', 'asset');
  if (typeof fields.token === 'object') fields.token = fields.token?.address ?? fields.token?.symbol;
  fields.network = pick(inv, 'payment.chainId', 'chainId', 'payment.network', 'network', 'chain');
  const total = pick(inv, 'total.amount', 'total', 'amountDue', 'amount_due', 'amount.value', 'amount', 'payment.amount');
  if (total != null) fields.totals.push({ label: 'total', text: money(typeof total === 'object' ? total.value ?? total.amount : total), unit: fields.currency ?? null, raw: String(total) });
  for (const k of ['subtotal', 'tax', 'discount']) { const v = pick(inv, k, `${k}.amount`); if (v != null) fields[k] = { text: money(typeof v === 'object' ? v.amount ?? v.value : v), unit: fields.currency ?? null }; }
  for (const it of Array.isArray(inv.items) ? inv.items : Array.isArray(inv.lineItems) ? inv.lineItems : []) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new UserError('each invoice item must be an object');
    const q = money(pick(it, 'quantity', 'qty') ?? 1);
    const unit = pick(it, 'unitPrice', 'unit_price', 'price');
    const amount = pick(it, 'amount', 'total');
    fields.items.push({ description: String(pick(it, 'description', 'name') ?? 'item'), quantity: String(q), unit: unit != null ? money(unit) : null, amount: amount != null ? money(amount) : unit != null ? mulDecimal(money(unit), String(q)) : null });
  }
  const walk = (v) => { if (typeof v === 'string') for (const a of v.matchAll(/0x[0-9a-fA-F]+/g)) fields.addresses.push({ value: a[0], line: v }); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(doc);
  return fields;
}

// "payment link": ethereum:0xTOKEN@1672/transfer?address=0xPAYEE&uint256=250000000&ref=INV-7  (EIP-681)  or  ethereum:0xPAYEE@1672?value=1e18
function readLink(text) {
  const m = text.trim().match(/^(?:ethereum|pay):(?:pay-)?([^@/?]+)(?:@(\d+))?(?:\/([^?]+))?(?:\?(.*))?$/i);
  if (!m) throw new UserError('that payment link does not look like ethereum:0x…@1672/transfer?address=0x…&uint256=…');
  const [, target, chain, fn, query = ''] = m;
  const q = Object.fromEntries(new URLSearchParams(query));
  const fields = { items: [], addresses: [{ value: target, line: text }], totals: [], network: chain ?? undefined, link: { target, fn: fn ?? null } };
  fields.reference = q.ref ?? q.reference ?? q.invoice ?? q.label ?? q.memo ?? undefined;
  if (fn === 'transfer') {
    fields.token = target;
    fields.payee = q.address;
    if (q.address) fields.addresses.push({ value: q.address, line: text });
    if (q.uint256) fields.totals.push({ label: 'uint256', text: q.uint256, unit: 'BASE', raw: q.uint256 });
  } else if (fn) {
    throw new UserError(`the payment link calls "${fn}", and only transfer is a payment`);
  } else {
    fields.payee = target;
    fields.currency = 'PROS';
    if (q.value) fields.totals.push({ label: 'value', text: q.value, unit: 'WEI', raw: q.value });
  }
  return fields;
}

const mulDecimal = (a, b) => {
  a = money(a); b = money(b);
  const [aw, af = ''] = a.split('.');
  const [bw, bf = ''] = b.split('.');
  const scale = af.length + bf.length;
  const n = BigInt(aw + af) * BigInt(bw + bf);
  const s = n.toString().padStart(scale + 1, '0');
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return out.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

// ---- reading it against the rules ---------------------------------------------------------------------------------------------------------------

const addDec = (a, b, sign = 1) => {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length);
  const n = (x) => BigInt(x.replace('.', '') + '0'.repeat(scale - (x.split('.')[1] ?? '').length));
  const r = n(a) + BigInt(sign) * n(b);
  const neg = r < 0n;
  const s = (neg ? -r : r).toString().padStart(scale + 1, '0');
  return `${neg ? '-' : ''}${scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s}`;
};
const eqDec = (a, b) => { const sc = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length); return BigInt(a.replace('.', '') + '0'.repeat(sc - (a.split('.')[1] ?? '').length)) === BigInt(b.replace('.', '') + '0'.repeat(sc - (b.split('.')[1] ?? '').length)); };

// An invoice read into what it says, with every flag. `payIn` is the token the payer chooses when the invoice is in a currency, not a token.
export function interpretInvoice(text, { payIn = null, now = Date.now() } = {}) {
  const format = detectFormat(text);
  const f = format === 'json' ? readJson(text) : format === 'link' ? readLink(text) : readText(text);
  const flags = [];
  for (const field of f.conflicts ?? []) flags.push(flag('error', 'conflicting-field', `The invoice gives conflicting values for ${field}; confirm one value with the issuer.`, field));
  const out = { format, reference: f.reference ? String(f.reference).trim() : null, payee: { name: f.name ?? null, address: null }, amount: null, token: null, currency: null, due: f.due ?? null, issued: f.issued ?? null, items: f.items, chainId: null };

  // reference
  if (!out.reference) flags.push(flag('error', 'missing-reference', 'The invoice has no reference number, so the payment could not be matched to it. Ask the issuer for one; I will not invent one.', 'reference'));
  else if (out.reference.length > 40 || /[^\w ./#:-]/.test(out.reference)) flags.push(flag('error', 'bad-reference', `The reference "${out.reference.slice(0, 30)}" is not a plain invoice number (letters, digits and . / # : - only, at most 40 characters).`, 'reference'));

  // payee address
  const declared = f.payee ? String(f.payee).trim().match(/0x[0-9a-fA-F]+/)?.[0] ?? null : null;
  const payeeRaw = declared;
  if (!f.payee) flags.push(flag('error', 'missing-payee', 'The invoice does not say where to pay. There is no wallet address in it.', 'payee'));
  else if (!payeeRaw) flags.push(flag('error', 'payee-not-address', `"${String(f.payee).slice(0, 40)}" is not a wallet address: a payment needs a 0x address, and a name or an account number is not one.`, 'payee'));
  else if (!isAddress(payeeRaw)) flags.push(flag('error', 'bad-payee', `The pay-to address ${payeeRaw.length > 14 ? payeeRaw.slice(0, 10) + '…' : payeeRaw} has ${payeeRaw.length - 2} hex characters; an address has exactly 40.`, 'payee'));
  else {
    out.payee.address = payeeRaw;
    const cs = checksumStatus(payeeRaw);
    if (cs === 'invalid') flags.push(flag('error', 'checksum', `The pay-to address is mixed-case but its checksum is wrong: a character is mistyped (it should read ${toChecksumAddress(payeeRaw)}). Do not pay it until the issuer confirms the address.`, 'payee'));
    else if (cs === 'unchecked') flags.push(flag('info', 'no-checksum', 'The pay-to address is all one case, so it carries no checksum to catch a typo: confirm it with the issuer.', 'payee'));
    if (/^0x0{40}$/.test(payeeRaw)) flags.push(flag('error', 'zero-payee', 'The pay-to address is the zero address: anything sent there is burned.', 'payee'));
  }
  const others = [...new Set(f.addresses.map((a) => a.value.toLowerCase()))].filter((a) => isAddress(a) && a !== out.payee.address?.toLowerCase() && a !== (f.token && isAddress(String(f.token)) ? String(f.token).toLowerCase() : ''));
  if (others.length && out.payee.address) flags.push(flag('error', 'several-addresses', `The invoice contains another address besides the pay-to one (${others.map(short).join(', ')}). Two addresses on one invoice is how payments get redirected: confirm which one is right.`, 'payee'));

  // amount and currency
  const totals = f.totals.filter((t) => t.text != null);
  const distinct = [...new Set(totals.map((t) => t.text))];
  if (!totals.length) flags.push(flag('error', 'missing-amount', 'The invoice does not state a total to pay.', 'amount'));
  else if (distinct.length > 1 && !totals.every((t) => eqDec(t.text, totals[0].text))) flags.push(flag('error', 'amount-mismatch', `The invoice states different totals: ${totals.map((t) => `${t.label} ${t.text}${t.unit ? ' ' + t.unit : ''}`).join(' vs ')}. I will not pick one.`, 'amount'));
  const total = totals[0];
  const unit = (f.currency ? String(f.currency).trim().toUpperCase() : null) ?? total?.unit ?? null;
  const units = [...new Set([unit, ...totals.map((t) => t.unit), ...['subtotal', 'tax', 'discount'].map((k) => f[k]?.unit)].filter(Boolean).map((u) => String(u).toUpperCase()))];
  if (units.length > 1) flags.push(flag('error', 'currency-mismatch', `The invoice gives conflicting currencies (${units.join(', ')}). I will not pick one.`, 'token'));
  out.currency = unit;
  let token = null;
  const tokenRef = f.token != null ? String(f.token).trim() : null;
  if (tokenRef && isAddress(tokenRef)) {
    token = tokenByAddress(tokenRef) ?? { symbol: null, address: tokenRef.toLowerCase(), decimals: null, custom: true };
    if (unit && tokenBySymbol(unit) && !token.custom && token.symbol !== unit) flags.push(flag('error', 'token-mismatch', `The invoice says ${unit} but the token contract it names is ${token.symbol}.`, 'token'));
    if (unit && tokenBySymbol(unit) && token.custom) flags.push(flag('error', 'token-mismatch', `The invoice says ${unit}, but the contract it names (${short(tokenRef)}) is not the ${unit} on Pharos (${tokenBySymbol(unit).address ? short(tokenBySymbol(unit).address) : 'native'}). A look-alike token is worth nothing: do not pay it.`, 'token'));
    if (token.custom && !unit) flags.push(flag('warn', 'unlisted-token', `The token ${short(tokenRef)} is not in the Pharos Token Registry: check that it is the one the issuer means.`, 'token'));
  } else if (tokenRef) {
    token = tokenBySymbol(tokenRef);
    if (!token) flags.push(flag('error', 'unknown-token', `I do not know a token called "${tokenRef}" on Pharos.`, 'token'));
  } else if (unit && tokenBySymbol(unit)) token = tokenBySymbol(unit);
  else if (unit && FIAT[unit]) {
    const chosen = payIn ? tokenBySymbol(payIn) : null;
    if (unit === 'USD' && chosen?.symbol === 'USDC') { token = chosen; flags.push(flag('warn', 'usd-as-usdc', 'The invoice is in US dollars and you chose to pay in USDC. That treats 1 USDC as 1 USD, which is how stablecoin payment usually works, but the invoice does not say it accepts USDC: confirm with the issuer.', 'token')); }
    else if (unit === 'USD') flags.push(flag('error', 'currency-needs-token', 'The invoice is in US dollars, not in a token. Say which token to pay in (USDC is the dollar token on Pharos); I will not choose for you.', 'token'));
    else flags.push(flag('error', 'no-conversion', `The invoice is in ${FIAT[unit]} (${unit}). I have no exchange-rate source, so I cannot say how many tokens that is: ask the issuer for an amount in a token.`, 'token'));
  } else if (unit && unit !== 'BASE' && unit !== 'WEI') flags.push(flag('error', 'unknown-currency', `The invoice's currency "${unit}" is neither a token I know nor a currency I can convert.`, 'token'));
  else if (!unit) flags.push(flag('error', 'missing-currency', 'The invoice gives an amount but not what it is in (a token or a currency).', 'token'));
  if (token && unit && tokenBySymbol(unit) && token.symbol !== unit && !(tokenRef && isAddress(tokenRef))) flags.push(flag('error', 'token-mismatch', `The invoice says ${unit}, but its payment token is ${token.symbol ?? token.address}.`, 'token'));
  if (token && unit && FIAT[unit] && !(unit === 'USD' && token.symbol === 'USDC')) flags.push(flag('error', 'no-conversion', `The invoice is in ${unit}, but requests ${token.symbol ?? token.address}. No exchange rate or token amount is provided.`, 'token'));
  if (token && unit && !FIAT[unit] && !tokenBySymbol(unit) && !['BASE', 'WEI'].includes(unit)) flags.push(flag('error', 'unknown-currency', `The invoice's currency ${unit} is not supported.`, 'token'));
  out.token = token && { symbol: token.symbol ?? null, address: token.address ?? null, native: Boolean(token.native), custom: Boolean(token.custom) };

  // chain
  if (f.network != null) {
    const n = String(f.network).trim();
    const id = /^(?:eip155:)?(\d+)$/.exec(n)?.[1];
    out.chainId = id ? Number(id) : null;
    const pharos = /pharos/i.test(n) && !/atlantic|testnet/i.test(n);
    if (!(out.chainId === CHAIN.id || pharos)) flags.push(flag('error', 'wrong-chain', `The invoice is for "${n}", not for ${CHAIN.name} (chain ${CHAIN.id}). Paying here would not pay it.`, 'network'));
  }

  // amount in base units
  if (total && token) {
    const dec = token.decimals ?? (unit === 'BASE' || unit === 'WEI' ? 0 : null);
    if (total.unit === 'BASE' || total.unit === 'WEI') {
      try {
        if (!/^\d+$/.test(total.text) || parseDecimal(total.text, 0) <= 0n) throw new UserError('base units must be a positive uint256 integer');
        out.amount = { text: total.text, raw: total.text, base: true };
      } catch (err) { flags.push(flag('error', 'amount-precision', err.message, 'amount')); }
    }
    else if (dec != null) { try { parseDecimal(total.text, dec, 'amount'); out.amount = { text: total.text }; } catch (err) { flags.push(flag('error', 'amount-precision', err.message, 'amount')); } }
    else out.amount = { text: total.text };
    if (out.amount && Number(out.amount.text) <= 0) flags.push(flag('error', 'amount-zero', 'The total is zero or negative.', 'amount'));
  } else if (total && !token) out.amount = { text: total.text };

  // the arithmetic of the invoice itself
  for (const i of f.items) {
    if (i.unit != null && i.amount != null && !eqDec(mulDecimal(i.unit, i.quantity), i.amount)) flags.push(flag('error', 'line-total-mismatch', `Line item ${i.description}: quantity times unit price does not match its stated total.`, 'amount'));
    if (i.amount == null) flags.push(flag('error', 'missing-line-amount', `Line item ${i.description} has no amount or unit price.`, 'amount'));
  }
  if ((f.items.length || f.subtotal) && total) {
    const known = f.items.filter((i) => i.amount != null);
    if (known.length === f.items.length) {
      let sum = '0';
      for (const i of known) sum = addDec(sum, i.amount);
      if (f.items.length && f.subtotal && !eqDec(sum, f.subtotal.text)) flags.push(flag('error', 'subtotal-mismatch', `The line items add up to ${sum} but the subtotal says ${f.subtotal.text}.`, 'amount'));
      let expect = f.subtotal?.text ?? sum;
      if (f.tax) expect = addDec(expect, f.tax.text);
      if (f.discount) expect = addDec(expect, f.discount.text, -1);
      if (!eqDec(expect, total.text)) flags.push(flag('error', 'total-mismatch', `The invoice does not add up: ${f.subtotal ? 'subtotal' : 'the line items'} ${f.subtotal?.text ?? sum}${f.tax ? ` + tax ${f.tax.text}` : ''}${f.discount ? ` − discount ${f.discount.text}` : ''} = ${expect}, but the total says ${total.text}.`, 'amount'));
    }
  }

  // dates
  const dueTs = out.due ? Date.parse(String(out.due)) : NaN;
  if (out.due && Number.isFinite(dueTs) && dueTs < now) flags.push(flag('warn', 'overdue', `The invoice was due on ${String(out.due).slice(0, 10)}, which is in the past: check that it has not already been paid or replaced.`, 'due'));
  if (!out.due) flags.push(flag('info', 'no-due', 'The invoice has no due date.', 'due'));
  return { out, flags, hasErrors: flags.some((x) => x.severity === 'error') };
}

// ---- the whole thing ----------------------------------------------------------------------------------------------------------------------------

export async function prepareInvoicePayment({ chain, rpc = publicRpc, invoice, from = null, payIn = null, block = null, now = Date.now() }) {
  const tr = tracer();
  const { out, flags, hasErrors } = interpretInvoice(invoice, { payIn, now });
  tr.agent('read-invoice', `Read a ${out.format} invoice${out.reference ? ` (${out.reference})` : ''}: ${flags.filter((x) => x.severity === 'error').length} error(s), ${flags.filter((x) => x.severity === 'warn').length} warning(s).`, { uses: [], output: { errors: flags.filter((x) => x.severity === 'error').map((x) => x.code) } });
  const base = { format: out.format, invoice: out, flags, steps: tr.steps, chainCalls: 0, rpcCalls: 0 };
  if (hasErrors) return { ...base, status: 'blocked', reason: flags.find((x) => x.severity === 'error').message, summary: null };
  if (!from) return { ...base, status: 'needs-info', questions: [{ field: 'from', question: 'Which wallet pays? I need its address to check the balance and simulate the payment.' }] };
  if (!isAddress(from)) throw new UserError('the paying wallet must be a 0x address');
  const token = out.token.native ? TOKENS[0] : { symbol: out.token.symbol, address: out.token.address, decimals: tokenByAddress(out.token.address)?.decimals ?? null };
  const amountRaw = out.amount.base ? BigInt(out.amount.raw) : null;
  const result = await assessTransfer({ chain, rpc, from, to: out.payee.address, token, amountText: out.amount.base ? null : out.amount.text, amountRaw, reference: out.reference, block, tr });
  const steps = tr.steps.sort((a, b) => a.n - b.n);
  const counts = { chainCalls: steps.filter((s) => s.actor === 'chain-mcp').length, rpcCalls: steps.filter((s) => s.actor === 'public-rpc').length };
  if (!result.token) return { ...base, ...counts, steps, status: 'blocked', checks: result.checks, block: result.block, reason: result.checks.find((c) => !c.ok)?.detail ?? 'a check failed', summary: null };
  const summary = [
    `Pay invoice ${out.reference}${out.payee.name ? ` from ${out.payee.name}` : ''}: ${result.amountText} to ${out.payee.address}${out.due ? `, due ${String(out.due).slice(0, 10)}` : ''}.`,
    ...summaryLines({ from, to: out.payee.address, result, reference: out.reference }).slice(1),
  ];
  const view = { ...base, ...counts, steps, checks: result.checks, block: result.block, token: result.token, amountText: result.amountText, summary, summaryText: summary.join('\n') };
  if (!result.ok) return { ...view, status: 'blocked', reason: result.checks.find((c) => !c.ok && c.level !== 'warn' && c.level !== 'note')?.detail ?? 'a check failed' };
  return { ...view, status: flags.some((x) => x.severity === 'warn') ? 'ready-with-warnings' : 'ready', transaction: result.transaction, eip681: eip681({ token: result.token.native ? { native: true } : { address: result.token.address }, to: out.payee.address, amountRaw: result.amountRaw }), neverSent: 'Nothing was signed or sent. This is an unsigned transaction: your wallet signs it, or you do.' };
}
