// Recipient intelligence: what the chain says about the address a payment is about to go to.
// These are advisories, not hard failures. A warning makes the agent ask the user to confirm the address
// before the signing button unlocks; it never blocks a payment the user has deliberately confirmed.
import { readHistory } from './history.js';
import { formatUnits } from '../abi.js';

const PRIOR_WINDOW = 10000; // about 4.5 hours of Atlantic blocks
const PRIOR_DEADLINE_MS = 8000;

export async function inspectRecipient(config, { recipient, payer, rpc, window = PRIOR_WINDOW, deadlineMs = PRIOR_DEADLINE_MS }) {
  const [code, nonce, balance] = await Promise.all([
    rpc('eth_getCode', [recipient, 'latest']),
    rpc('eth_getTransactionCount', [recipient, 'latest']),
    rpc('eth_getBalance', [recipient, 'latest']),
  ]);
  if (typeof code !== 'string' || typeof nonce !== 'string' || typeof balance !== 'string') throw new Error('The recipient address could not be read from Atlantic.');
  const isContract = code !== '0x';
  const sentTransactions = Number(BigInt(nonce));
  const nativeRaw = BigInt(balance);
  const prior = await readHistory(config, { rpc, payer, recipient, window, deadlineMs, limit: 50 }).catch(() => null);
  const paidBefore = prior?.total ?? 0;

  const advisories = [];
  if (isContract) advisories.push({ id: 'contract-recipient', level: 'warn', message: 'The recipient is a smart contract, not a plain wallet. Confirm it can receive and use tUSDC; tokens sent to a contract that cannot move them are stuck.' });
  if (!isContract && sentTransactions === 0 && nativeRaw === 0n && paidBefore === 0) advisories.push({ id: 'unused-recipient', level: 'warn', message: 'This address has never sent a transaction and holds no PHRS. It may be brand new or mistyped, so confirm it with the recipient.' });
  if (paidBefore > 0) advisories.push({ id: 'paid-before', level: 'info', message: `Your wallet has paid this recipient ${paidBefore} time${paidBefore === 1 ? '' : 's'} through this router in blocks ${prior.fromBlock?.toLocaleString('en-US') ?? '?'} to ${prior.toBlock.toLocaleString('en-US')}.` });
  else if (prior) advisories.push({ id: 'first-payment', level: 'info', message: `No earlier payment from your wallet to this recipient in blocks ${prior.fromBlock?.toLocaleString('en-US') ?? '?'} to ${prior.toBlock.toLocaleString('en-US')} (the newest ${Math.round(window / 1000)}k blocks).` });
  else advisories.push({ id: 'history-unavailable', level: 'info', message: 'Earlier payments to this recipient could not be checked right now.' });

  const reasons = advisories.filter((entry) => entry.level === 'warn').map((entry) => entry.id);
  const detail = `${isContract ? 'Smart contract' : 'Wallet'}, ${sentTransactions} transaction${sentTransactions === 1 ? '' : 's'} sent, ${formatUnits(nativeRaw, 18)} PHRS, ${paidBefore} earlier payment${paidBefore === 1 ? '' : 's'} from this wallet.`;
  return { isContract, sentTransactions, nativeRaw: nativeRaw.toString(), paidBefore, advisories, acknowledgement: { required: reasons.length > 0, reasons }, detail };
}
