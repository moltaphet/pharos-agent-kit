#!/usr/bin/env node
// Task 24: gas history and quote for either Pharos network; on Atlantic testnet, hold a real transfer until the gas price is favourable or the deadline.
//   history [--chain mainnet|atlantic]
//   send    --to <address> --value <wei> --deadline <seconds> [--max-gwei <n>]      Atlantic testnet only (throwaway key from .wallet/atlantic-testnet.json)
//   prepare --to <address> --value <wei> [--chain mainnet]                           prints the unsigned EIP-1559 fields; sends nothing
import { fail, parseCli } from '../../lib/cli.js';
import { isAddress } from '../../lib/abi.js';
import { rpcCall } from '../../lib/rpc.js';
import { ATLANTIC } from '../../lib/rpc-chain.js';
import { fmtGwei, gasHistory, sampleGas, effectivePrice, feesFor, submitWithin } from '../../lib/gas.js';

const usage = `Usage: pharos-gas <history|prepare|send> [--chain mainnet|atlantic] [--to 0x…] [--from 0x…] [--value <wei>] [--deadline <seconds>] [--max-gwei <n>] [--wallet-file <path>]`;
const { values, positionals } = parseCli({ usage, options: { chain: { type: 'string' }, to: { type: 'string' }, from: { type: 'string' }, value: { type: 'string' }, deadline: { type: 'string' }, 'max-gwei': { type: 'string' }, 'wallet-file': { type: 'string' } } });
const [cmd] = positionals;
const chains = { mainnet: 'https://rpc.pharos.xyz', atlantic: ATLANTIC.rpc };
const chain = values.chain ?? (cmd === 'send' ? 'atlantic' : 'mainnet');
if (!chains[chain]) fail('--chain must be mainnet or atlantic', usage);
const rpc = (m, p = []) => rpcCall(m, p, { url: chains[chain], why: `gas optimizer: ${m}` });
const toWei = (text) => { const [w, f = ''] = String(text).split('.'); if (!/^\d+$/.test(w) || !/^\d{0,9}$/.test(f)) fail('--max-gwei must be a plain number like 0.5', usage); return BigInt(w) * 10n ** 9n + BigInt(f.padEnd(9, '0')); };

try {
  if (cmd === 'history') {
    const h = await gasHistory(rpc, { span: 3000, points: 20 });
    const now = await sampleGas(rpc);
    console.log(`${chain}: base fee now ${fmtGwei(now.baseFee)}, eth_gasPrice ${fmtGwei(now.gasPrice)}, suggested tip ${fmtGwei(now.tip)}`);
    for (const r of h.rows) console.log(`  block ${r.block}  ${new Date(r.time * 1000).toISOString().slice(11, 19)}  base fee ${fmtGwei(r.baseFee)}  fullness ${(r.fullness * 100).toFixed(2)}%`);
    console.log(`  min ${fmtGwei(h.stats.min)} · median ${fmtGwei(h.stats.median)} · max ${fmtGwei(h.stats.max)}${h.stats.flat ? ' (flat: the price did not move)' : ''}`);
  } else if (cmd === 'prepare') {
    if (!isAddress(values.to)) fail('--to must be an address', usage);
    const now = await sampleGas(rpc);
    // a plain transfer to an ordinary wallet is always 21,000 gas; anything else needs the sender (--from) to be estimated
    const isWallet = (await rpc('eth_getCode', [values.to, 'latest'])) === '0x';
    if (!isWallet && !isAddress(values.from)) fail('--to is a contract: give --from so the gas can be estimated', usage);
    const gas = isWallet ? 21000n : BigInt(await rpc('eth_estimateGas', [{ from: values.from, to: values.to, value: '0x' + BigInt(values.value ?? 0).toString(16) }]));
    const fees = feesFor(now);
    console.log(JSON.stringify({ chain, type: 2, to: values.to, value: String(values.value ?? 0), gasLimit: String(gas), maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas), expectedCostWei: String(gas * effectivePrice(now)), naiveCostWei: String(gas * now.gasPrice), note: 'unsigned; nothing was sent' }, null, 2));
  } else if (cmd === 'send') {
    if (chain !== 'atlantic') fail('send works on Atlantic testnet only; use "prepare" for mainnet', usage);
    if (!isAddress(values.to)) fail('--to must be an address', usage);
    const deadline = Number(values.deadline);
    if (!Number.isFinite(deadline) || deadline < 5) fail('--deadline must be a number of seconds, at least 5', usage);
    const { makeSigner, WALLET_FILE } = await import('../../lib/testnet-signer.js');
    const signer = makeSigner({ rpcUrl: chains.atlantic, walletFile: values['wallet-file'] ?? WALLET_FILE, log: (s) => console.error(s) });
    const history = await gasHistory(rpc, { span: 3000, points: 20 });
    const r = await submitWithin({
      sampler: () => sampleGas(rpc), history, maxPrice: values['max-gwei'] != null ? toWei(values['max-gwei']) : null, deadlineMs: Date.now() + deadline * 1000, pollMs: 5000, leadMs: 4000,
      onSample: (s) => console.error(`  t+${(s.t / 1000).toFixed(1)}s price ${fmtGwei(s.price)} vs target ${fmtGwei(s.target)} → ${s.favorable ? 'favourable' : 'hold'}`),
      submit: async (fees) => { const tx = await signer.send({ label: 'gas optimizer', to: values.to, value: BigInt(values.value ?? 0), gas: 21000, fees }); const rc = await rpc('eth_getTransactionReceipt', [tx.hash]); return { hash: tx.hash, gasUsed: Number(BigInt(rc.gasUsed)), effectiveGasPrice: BigInt(rc.effectiveGasPrice) }; },
    });
    console.log(`submitted (${r.reason}) after ${(r.heldMs / 1000).toFixed(1)}s, ${r.submittedBeforeDeadline ? 'before' : 'AFTER'} the deadline: ${r.tx.hash}\n  price when asked ${fmtGwei(r.atRequest.gasPrice)} · paid ${fmtGwei(r.paid.effectiveGasPrice)} · cost ${r.paid.costWei} wei vs ${r.naiveCostWei} wei at the quoted price (saved ${r.savedWei})\n  https://atlantic.pharosscan.xyz/tx/${r.tx.hash}`);
  } else fail('use history, prepare or send', usage);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
