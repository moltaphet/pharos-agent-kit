// Invoice intake: turns pasted invoice or payment-request text into form fields.
// Deterministic on purpose. It never guesses: anything ambiguous or missing becomes a question for the user,
// and the fields it does return still go through validateInvoice() before any plan is prepared.
import { UserError } from '../snapshot.js';

const MAX_TEXT = 4000;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const REFERENCE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9./#:_-]{0,63}$/;
const STOP = new Set(['number', 'no', 'to', 'for', 'from', 'date', 'due', 'amount', 'total', 'the', 'and', 'of']);

const unique = (list) => [...new Set(list)];

function findAddresses(text) {
  return unique((text.match(ADDRESS) ?? []).map((address) => address.toLowerCase()));
}

function findReferences(text) {
  const found = [];
  for (const match of text.matchAll(/\b(INV(?:[-_/]|(?=\d))[A-Za-z0-9][A-Za-z0-9./_-]{0,60})/gi)) found.push(match[1]);
  if (!found.length) {
    for (const match of text.matchAll(/\b(?:invoice|reference|ref)\b\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9./#:_-]{1,63})/gi)) {
      if (!STOP.has(match[1].toLowerCase())) found.push(match[1]);
    }
  }
  return unique(found.filter((value) => REFERENCE_SHAPE.test(value)).map((value) => value.replace(/[.,;:]+$/, '')));
}

function findAmounts(text) {
  const found = [];
  const clean = (value) => value.replace(/,(?=\d{3}(\D|$))/g, '');
  const patterns = [
    /(\d[\d,]*(?:\.\d+)?)\s*(?:tusdc|usdc|usd|dollars?)\b/gi,
    /\$\s*(\d[\d,]*(?:\.\d+)?)/g,
    /\b(?:amount|total|pay|payment|due|send|owed)\b[^\d\n]{0,24}(\d[\d,]*(?:\.\d+)?)/gi,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(clean(match[1]));
  return unique(found);
}

export function readInvoiceText(input) {
  if (typeof input !== 'string' || !input.trim()) throw new UserError('Paste the invoice or payment request text first.');
  if (input.length > MAX_TEXT) throw new UserError(`Keep the pasted text under ${MAX_TEXT} characters.`);
  const addresses = findAddresses(input);
  // Remove addresses before looking for references and amounts, so hex digits are never read as money.
  const withoutAddresses = input.replace(ADDRESS, ' ');
  const references = findReferences(withoutAddresses);
  const withoutReference = references.length === 1 ? withoutAddresses.replace(references[0], ' ') : withoutAddresses;
  const amounts = findAmounts(withoutReference);

  const fields = {};
  const questions = [];
  const readings = [];
  const resolve = (name, values, label, plural, missingText) => {
    if (values.length === 1) { fields[name] = values[0]; readings.push({ field: name, value: values[0], status: 'read' }); }
    else if (!values.length) { questions.push(missingText); readings.push({ field: name, value: null, status: 'missing' }); }
    else { questions.push(`I found ${values.length} possible ${plural} (${values.slice(0, 4).join(', ')}). Which one is correct?`); readings.push({ field: name, value: null, status: 'ambiguous', candidates: values.slice(0, 4) }); }
  };
  resolve('reference', references, 'invoice reference', 'invoice references', 'I could not find an invoice reference. Add one such as INV-2026-001.');
  resolve('recipient', addresses, 'recipient address', 'recipient addresses', 'I could not find a recipient wallet address (0x followed by 40 characters).');
  resolve('amount', amounts, 'amount', 'amounts', 'I could not find a payment amount. State it with the token, for example 25 tUSDC.');
  return { status: questions.length ? 'needs-clarification' : 'complete', fields, questions, readings };
}
