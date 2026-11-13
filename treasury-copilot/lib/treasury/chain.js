import { rpcCall } from '../rpc.js';
import { PAYMENT_TOPIC, addressWord, paymentData, hex } from './validation.js';

export const treasuryRpc = (config) => (method, params = []) => rpcCall(method, params, { url: config.rpc, why: `Treasury Atlantic: ${method}`, timeoutMs: 8000, retries: 1 });

export async function assertNetwork(rpc) {
  if (BigInt(await rpc('eth_chainId')) !== 688689n) throw new Error('RPC network is not Atlantic Testnet. Payment preparation stopped.');
}

export async function estimateTransaction(rpc, tx) {
  await rpc('eth_call', [tx, 'latest']);
  const gas = BigInt(await rpc('eth_estimateGas', [tx]));
  return { ...tx, chainId: hex(688689), gas: hex((gas * 13n + 9n) / 10n) };
}

export async function verifyPayment(config, { payer, invoice, hash }, rpc = treasuryRpc(config)) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new Error('Transaction hash must be 0x followed by 64 hexadecimal characters.');
  await assertNetwork(rpc);
  const [receipt, transaction] = await Promise.all([rpc('eth_getTransactionReceipt', [hash]), rpc('eth_getTransactionByHash', [hash])]);
  const base = { hash, explorer: `${config.explorer}/tx/${hash}`, invoice, payer };
  if (!transaction) return { ...base, status: 'pending', message: 'The hash is not yet visible on Atlantic. Do not submit a replacement payment.' };
  const checks = [
    { id: 'payer', ok: transaction.from?.toLowerCase() === payer, message: 'Transaction was sent by this payer.' },
    { id: 'target', ok: transaction.to?.toLowerCase() === config.router.toLowerCase(), message: 'Transaction calls the configured invoice router.' },
    { id: 'input', ok: transaction.input?.toLowerCase() === paymentData(invoice).toLowerCase(), message: 'Transaction contains the exact invoice reference, recipient and amount.' },
    { id: 'value', ok: BigInt(transaction.value ?? '0x0') === 0n, message: 'Payment sends the demo token, not native currency.' },
  ];
  if (checks.some((check) => !check.ok)) return { ...base, status: 'mismatch', checks, message: 'This transaction does not match the invoice. Check the wallet transaction before taking any action.' };
  if (!receipt) return { ...base, status: 'pending', checks, message: 'Transaction is pending. Keep this hash and wait for its receipt.' };
  if (receipt.status !== '0x1') return { ...base, status: 'reverted', checks, message: 'The payment reverted on Atlantic. The invoice was not paid by this transaction.' };
  const event = receipt.logs?.find((entry) => entry.address?.toLowerCase() === config.router.toLowerCase() && entry.topics?.length === 4 && entry.topics[0]?.toLowerCase() === PAYMENT_TOPIC && entry.topics[1]?.toLowerCase() === '0x' + addressWord(payer) && entry.topics[2]?.toLowerCase() === invoice.invoiceId && entry.topics[3]?.toLowerCase() === '0x' + addressWord(invoice.recipient) && entry.data?.toLowerCase() === '0x' + addressWord(config.token.address) + BigInt(invoice.amountRaw).toString(16).padStart(64, '0'));
  checks.push({ id: 'invoice-event', ok: Boolean(event), message: 'InvoicePaid event matches payer, reference, recipient, token and amount.' });
  if (!event) return { ...base, status: 'mismatch', checks, message: 'The transaction succeeded but the expected payment event is missing. No confirmed payment is claimed.' };
  return { ...base, status: 'confirmed', checks, blockNumber: Number(BigInt(receipt.blockNumber)), gasUsed: BigInt(receipt.gasUsed).toString(), message: 'The exact invoice payment was confirmed on Atlantic.' };
}
