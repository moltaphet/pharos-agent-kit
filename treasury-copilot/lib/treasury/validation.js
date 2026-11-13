import { isAddress } from '../abi.js';
import { checksumStatus } from '../address.js';
import { parseDecimal } from '../payments.js';
import { keccak256, selectorOf } from '../keccak.js';
import { UserError } from '../snapshot.js';

export const hex = (n) => '0x' + BigInt(n).toString(16);
export const word = (n) => BigInt(n).toString(16).padStart(64, '0');
export const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, '0');
export const invoiceIdOf = (reference) => '0x' + keccak256('pharos-treasury:v1:' + reference);
export const PAYMENT_TOPIC = '0x' + keccak256('InvoicePaid(address,bytes32,address,address,uint256)');

export function validAddress(value, label) {
  if (typeof value !== 'string' || !isAddress(value) || /^0x0{40}$/i.test(value) || checksumStatus(value) === 'invalid') throw new UserError(`${label} must be a nonzero Ethereum address with a valid checksum when mixed-case.`);
  return value.toLowerCase();
}

export function validateInvoice({ payer, invoice, policy = {} }, config, { checkPolicy = true } = {}) {
  const from = validAddress(payer, 'Paying wallet');
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) throw new UserError('Give the invoice reference, recipient and amount.');
  const reference = String(invoice.reference ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./#:_-]{0,63}$/.test(reference)) throw new UserError('Invoice reference must contain 1–64 letters, digits, spaces or . / # : _ - .');
  const recipient = validAddress(invoice.recipient, 'Recipient');
  const amount = String(invoice.amount ?? '').trim();
  const raw = parseDecimal(amount, config.token.decimals);
  if (raw <= 0n) throw new UserError('Invoice amount must be greater than zero.');
  if ([config.router, config.token.address].filter(Boolean).some((address) => address.toLowerCase() === recipient)) throw new UserError('The recipient cannot be the payment router or demo token contract.');
  const checks = [{ id: 'invoice', ok: true, message: 'Reference, recipient and exact token amount are valid.' }];
  if (checkPolicy) {
    const cap = String(policy.maxAmount ?? '100').trim();
    const max = parseDecimal(cap, config.token.decimals, 'Per-invoice limit');
    if (max <= 0n) throw new UserError('Per-invoice limit must be greater than zero.');
    if (!Array.isArray(policy.allowlist ?? []) || (policy.allowlist ?? []).length > 100) throw new UserError('Allowed recipients must be a list of at most 100 addresses.');
    const allowlist = (policy.allowlist ?? []).map((address) => validAddress(address, 'Allowed recipient'));
    checks.push({ id: 'amount-limit', ok: raw <= max, message: raw <= max ? `${amount} ${config.token.symbol} is within your ${cap} per-invoice limit.` : `${amount} ${config.token.symbol} exceeds your ${cap} per-invoice limit.` });
    checks.push({ id: 'recipient-policy', ok: !allowlist.length || allowlist.includes(recipient), message: !allowlist.length ? 'No recipient allowlist is configured. Confirm this address before signing.' : allowlist.includes(recipient) ? 'Recipient is on your allowlist.' : 'Recipient is not on your allowlist.' });
  }
  return { payer: from, invoice: { reference, recipient, amount, amountRaw: raw.toString(), invoiceId: invoiceIdOf(reference) }, checks };
}

export const paymentData = (invoice) => selectorOf('payInvoice(bytes32,address,uint256)') + invoice.invoiceId.slice(2) + addressWord(invoice.recipient) + word(invoice.amountRaw);
export const approvalData = (router, raw) => selectorOf('approve(address,uint256)') + addressWord(router) + word(raw);
export function requireDeployment(config) {
  if (config.chainId !== 688689) throw new UserError('This product is configured exclusively for Atlantic Testnet (688689).');
  if (!config.router || !config.token?.address) throw new UserError('The Treasury contracts have not been deployed yet. Signing becomes available after the Atlantic deployment.');
  validAddress(config.router, 'Router');
  validAddress(config.token.address, 'Demo token');
}
