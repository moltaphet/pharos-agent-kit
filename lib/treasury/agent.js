import { readFile } from 'node:fs/promises';
import { docsClient } from '../server.js';
import { splitAnswer, extractLinks } from '../docs.js';
import { formatUnits } from '../abi.js';
import { validateInvoice, requireDeployment, paymentData, approvalData } from './validation.js';
import { treasuryRpc, assertNetwork, estimateTransaction, verifyPayment } from './chain.js';
import { createTreasuryTools, SKILL_SOURCE } from './tools.js';
import { inspectRecipient } from './recipient.js';

export const readConfig = async () => JSON.parse(await readFile(new URL('../../config/treasury.json', import.meta.url), 'utf8'));
const networkOf = (config) => ({ name: 'Pharos Atlantic Testnet', chainId: config.chainId, explorer: config.explorer, symbol: 'PHRS' });

export async function documentation({ docs = docsClient() } = {}) {
  const question = 'What are the chain ID and native gas token for Pharos Atlantic Testnet, and how should an ERC-20 payment using approve and transferFrom be prepared for a user wallet signature?';
  const raw = await docs.callTool('askQuestion', { question, goal: 'Explain the network and user-signing checks for an invoice payment. Use only documented facts. Answer in at most 120 words and cite the Atlantic network page. Never ask for or accept a private key.' }, { why: 'Treasury agent: verify Atlantic network and token-payment procedure before preparing a signature.' });
  const text = typeof raw === 'string' ? raw : raw?.text ?? JSON.stringify(raw);
  const result = splitAnswer(text);
  const sources = [...result.listed, ...extractLinks(result.answer)].filter((source) => source.url.startsWith('https://docs.pharos.xyz/'));
  if (!result.answer || !sources.length || !/688689/.test(result.answer) || !/PHRS/i.test(result.answer)) throw new Error('Docs MCP did not provide a cited Atlantic chain ID and gas token. Preparation stopped; retry the documentation check.');
  return { answer: result.answer, sources: [...new Map(sources.map((source) => [source.url, source])).values()], checkedAt: new Date().toISOString() };
}

export async function planInvoice(input, { config, tools, docs, rpc } = {}) {
  config ??= await readConfig();
  const request = validateInvoice(input, config);
  const result = { ...request, status: 'blocked', checks: request.checks, steps: [], docs: null, transaction: null, approval: null, balances: null, network: networkOf(config) };
  if (request.checks.some((check) => !check.ok)) return result;
  requireDeployment(config);
  rpc ??= treasuryRpc(config);
  tools ??= createTreasuryTools(config);
  try {
    const recipientCheck = inspectRecipient(config, { recipient: request.invoice.recipient, payer: request.payer, rpc }).catch((error) => ({ failed: error.message }));
    const reads = await Promise.allSettled([tools.readWallet({ payer: request.payer, recipient: request.invoice.recipient, invoiceId: request.invoice.invoiceId }), documentation({ docs })]);
    const failure = reads.find((read) => read.status === 'rejected');
    if (failure) throw failure.reason;
    const [wallet, evidence] = reads.map((read) => read.value);
    result.docs = evidence;
    const inspection = await recipientCheck;
    if (inspection.failed) {
      result.advisories = [{ id: 'recipient-unreadable', level: 'warn', message: 'The recipient address could not be inspected right now, so confirm it with the recipient before signing.' }];
      result.acknowledgement = { required: true, reasons: ['recipient-unreadable'] };
    } else {
      result.advisories = inspection.advisories;
      result.acknowledgement = inspection.acknowledgement;
      result.recipient = { isContract: inspection.isContract, sentTransactions: inspection.sentTransactions, paidBefore: inspection.paidBefore };
    }
    result.steps.push({ tool: 'Developer Docs MCP', source: 'https://docs.pharos.xyz/~gitbook/mcp', title: 'Confirm the payment network and signing procedure', status: 'passed', detail: 'The cited documentation confirms chain 688689 and PHRS gas. Its network requirement is checked against the live reads.' });
    result.steps.push({ tool: 'Pharos SkillEngine', source: SKILL_SOURCE, title: 'Read balances, allowance and the invoice registry', status: 'passed', detail: `Official read-command templates executed against Atlantic at block ${wallet.block}. These results decide whether approval, funding or payment is possible.` });
    result.checks.push({ id: 'network', ok: Number(wallet.chainId) === 688689, message: 'Live network matches the documented Atlantic chain ID.' });
    result.checks.push({ id: 'contracts', ok: wallet.tokenCode !== '0x' && wallet.routerCode !== '0x' && wallet.routerToken.toLowerCase() === config.token.address.toLowerCase(), message: 'Router and demo token are deployed and the router uses the expected token.' });
    result.balances = { token: formatUnits(BigInt(wallet.tokenBalanceRaw), config.token.decimals), native: formatUnits(BigInt(wallet.nativeBalanceRaw), 18), allowance: formatUnits(BigInt(wallet.allowanceRaw), config.token.decimals) };
    if (result.checks.some((check) => !check.ok)) return result;
    if (wallet.paid) {
      result.status = 'already-paid';
      result.checks.push({ id: 'duplicate', ok: false, message: 'This wallet already paid this invoice reference. The contract prevents another payment.' });
      return result;
    }
    const raw = BigInt(request.invoice.amountRaw);
    result.checks.push({ id: 'balance', ok: BigInt(wallet.tokenBalanceRaw) >= raw, message: BigInt(wallet.tokenBalanceRaw) >= raw ? 'Wallet has enough demo tokens for this invoice.' : 'Wallet has insufficient tUSDC. Mint free demo tokens, then review again.' });
    result.checks.push({ id: 'gas-balance', ok: BigInt(wallet.nativeBalanceRaw) > 0n, message: BigInt(wallet.nativeBalanceRaw) > 0n ? 'Wallet has PHRS for gas; the exact fee is checked before signing.' : 'Wallet needs Atlantic PHRS for gas. Fund it through the testnet faucet.' });
    if (result.checks.some((check) => !check.ok)) return result;
    await assertNetwork(rpc);
    const needsApproval = BigInt(wallet.allowanceRaw) < raw;
    const tx = { from: request.payer, to: needsApproval ? config.token.address : config.router, data: needsApproval ? approvalData(config.router, raw) : paymentData(request.invoice), value: '0x0' };
    let estimated;
    try { estimated = await estimateTransaction(rpc, tx); }
    catch (error) {
      result.checks.push({ id: 'simulation', ok: false, message: `Simulation could not succeed: ${String(error.message).slice(0, 220)}` });
      return result;
    }
    const gasPrice = BigInt(await rpc('eth_gasPrice'));
    const fee = BigInt(estimated.gas) * gasPrice;
    const enoughGas = BigInt(wallet.nativeBalanceRaw) >= fee;
    result.checks.push({ id: 'fee', ok: enoughGas, message: enoughGas ? `Estimated fee ceiling for this step: ${formatUnits(fee, 18)} PHRS at the current gas price.` : 'The wallet does not have enough PHRS for the estimated fee.' });
    if (!enoughGas) return result;
    result.status = needsApproval ? 'needs-approval' : 'ready';
    result[needsApproval ? 'approval' : 'transaction'] = estimated;
    result.checks.push({ id: 'simulation', ok: true, message: needsApproval ? 'Exact-amount approval was simulated. The payment will be rechecked and simulated after approval confirms.' : 'The exact invoice payment was simulated successfully.' });
    if (!inspection.failed) result.steps.push({ tool: 'Atlantic RPC', source: config.rpc, title: 'Inspect the recipient address', status: 'passed', detail: inspection.detail + (inspection.acknowledgement.required ? ' The agent asks for your confirmation before signing.' : '') });
    result.steps.push({ tool: 'Atlantic RPC', source: config.rpc, title: needsApproval ? 'Simulate the exact approval' : 'Simulate the invoice payment', status: 'passed', detail: 'eth_call and gas estimation succeeded. Nothing was signed or submitted.' });
    return result;
  } finally { await tools.close?.(); }
}

export async function verifyInvoice(input, dependencies = {}) {
  const config = dependencies.config ?? await readConfig();
  requireDeployment(config);
  const request = validateInvoice(input, config, { checkPolicy: false });
  return verifyPayment(config, { ...request, hash: input.hash }, dependencies.rpc);
}
