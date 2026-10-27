#!/usr/bin/env node
// The Doc-Grounded Builder Agent, run on real services: Developer Docs MCP for the plan and the facts, Chain MCP (mainnet) and an RPC client (Atlantic testnet) for the actions.
//   - two reads on mainnet (a balance, two price feeds), each checked against a second source;
//   - a transfer of PROS prepared on mainnet (nothing is signed or sent: that is the point), and the same request on Atlantic testnet, where this script plays the user, signs the
//     prepared transaction with the throwaway testnet wallet, and gives the hash back for the agent to verify against the plan;
//   - a contract deployment prepared for Atlantic, signed by the same "user", verified: receipt, code, a call;
//   - requests the docs do not cover, and one the docs explain but the agent cannot do.
//
//   node scripts/builder-run.mjs        writes reports/builder-run.json

import { writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from '../lib/mcp.js';
import { atlanticChain, ATLANTIC } from '../lib/rpc-chain.js';
import { runRequest, verifyOutcome } from '../lib/builder.js';
import { makeSigner } from '../lib/testnet-signer.js';

const say = (s) => process.stderr.write(s + '\n');
const chain = new McpClient(PHAROS_CHAIN_MCP, { label: 'builder-run-chain' });
const docs = new McpClient(PHAROS_DOCS_MCP, { label: 'builder-run-docs' });
const clients = { chain, docs, atlantic: atlanticChain() };
const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, budgetWei: 5n * 10n ** 15n });
const ME = signer.from; // the "user": the throwaway Atlantic wallet
const RICH = '0x1159105d91825b0615c9fbe23c2055676676f96d'; const DEAD = '0x000000000000000000000000000000000000dEaD';
const ser = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const cases = [];
const ask = async (id, title, question, then = null) => {
  say(`${id}: ${question}`);
  const r = await runRequest({ question, clients });
  const c = { id, title, question, run: r };
  if (then) c.afterSigning = await then(r);
  say(`  → ${r.verdict.status}: ${r.verdict.headline}${c.afterSigning ? ` → ${c.afterSigning.status}` : ''}`);
  cases.push(ser(c));
};

try {
  await ask('balance', 'A read: the PROS balance of an address', `How do I check the PROS balance of ${RICH}?`);
  await ask('price-pros', 'A read: a price from the docs-listed oracle', 'How do I read the PROS/USD price on Pharos?');
  await ask('price-btc', 'The same recipe for another feed the docs list', 'How do I read the BTC/USD price on Pharos?');
  await ask('send-mainnet', 'Funds: a transfer prepared on mainnet, never signed', `How do I send 0.001 PROS to ${DEAD} from ${RICH}?`);
  await ask('send-atlantic', 'Funds: prepared on Atlantic; the user signs; the agent verifies', `How do I send 0.0001 PHRS to ${DEAD} from ${ME} on the Atlantic testnet?`, async (r) => {
    const p = r.prepared; if (!p) return null;
    const tx = await signer.send({ label: 'user signs the prepared transfer', to: p.to, value: BigInt(p.valueWei), gas: Number(p.gasLimit) * 2 });
    return verifyOutcome({ prepared: p, hash: tx.hash, clients, network: 'atlantic' });
  });
  await ask('deploy', 'Funds: a deployment prepared for Atlantic; the user signs; the agent verifies', `How do I deploy a smart contract to the Pharos Atlantic testnet from ${ME}?`, async (r) => {
    const p = r.prepared; if (!p) return null;
    const tx = await signer.send({ label: 'user signs the prepared deployment', to: null, create: p.data, gas: Number(p.gasLimit) * 2 });
    return verifyOutcome({ prepared: p, hash: tx.hash, clients, network: 'atlantic' });
  });
  await ask('not-covered-1', 'Not in the docs: liquidity on FaroSwap', 'How do I earn yield by providing liquidity on FaroSwap?');
  await ask('not-covered-2', 'Not in the docs: something unrelated', 'How do I bake sourdough bread with Pharos?');
  await ask('explained-only', 'In the docs, but not something the agent can do', 'How do I run a validator node on Pharos?');
} finally { await chain.close(); await docs.close(); }
const status = (id) => cases.find((c) => c.id === id)?.run.verdict.status;
const report = {
  recordedAt: new Date().toISOString(), network: 'Developer Docs MCP, Chain MCP (Pharos mainnet, read-only) and Pharos Atlantic testnet (two real transactions signed by the throwaway wallet standing in for the user)', cases,
  summary: { cases: cases.length, doThings: ['balance', 'price-pros', 'price-btc', 'send-mainnet', 'send-atlantic', 'deploy'].length, verifiedOnChain: cases.filter((c) => c.run.verdict.status === 'success' || c.afterSigning?.status === 'success').length, notCovered: cases.filter((c) => c.run.verdict.status === 'not-covered').length, preparedMainnet: status('send-mainnet') === 'prepared' },
};
writeFileSync(new URL('../reports/builder-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote reports/builder-run.json: ${report.summary.verifiedOnChain} requests done and verified, ${report.summary.notCovered} not covered by the docs, mainnet transfer prepared and not sent: ${report.summary.preparedMainnet}`);
