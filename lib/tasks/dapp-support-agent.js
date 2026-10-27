// Task: dApp Support Agent. The web side of lib/support.js: diagnose any transaction hash on Pharos mainnet (through Chain MCP) or Atlantic testnet, and the recorded diagnoses of
// thirteen real failed transactions, whose failed status is re-read from the chain on every load.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { diagnose, mcpTools, rpcTools } from '../support.js';
import { batchRpcStrict } from '../rpc-batch.js';
import { ATLANTIC } from '../rpc-chain.js';
import { rpcCall } from '../rpc.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const atl = (m, p = []) => rpcCall(m, p, { url: ATLANTIC.rpc, why: `support agent: ${m}` });

async function verify(run) {
  const by = { mainnet: run.cases.filter((c) => c.chain === 'mainnet'), atlantic: run.cases.filter((c) => c.chain === 'atlantic') };
  const url = { mainnet: undefined, atlantic: ATLANTIC.rpc };
  const results = {};
  for (const [chain, cases] of Object.entries(by)) {
    const rows = await batchRpcStrict(cases.map((c) => ({ method: 'eth_getTransactionReceipt', params: [c.hash] })), { url: url[chain] });
    cases.forEach((c, i) => { results[c.id] = { failed: rows[i]?.status === '0x0', block: rows[i] ? parseInt(rows[i].blockNumber, 16) : null }; });
  }
  return { checkedAt: new Date().toISOString(), total: run.cases.length, failedCount: Object.values(results).filter((r) => r.failed).length, results };
}

export default async function run({ q, chain }) {
  if (q.recorded) { const r = await json('reports/support-run.json'); return { run: jsonSafe(r), verification: await verify(r) }; }
  if (q.diagnose) {
    const hash = String(q.hash ?? '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new UserError('a transaction hash is 0x followed by 64 hexadecimal digits');
    const net = q.chain ?? 'mainnet';
    if (!['mainnet', 'atlantic'].includes(net)) throw new UserError('chain must be mainnet or atlantic');
    const tools = net === 'mainnet' ? mcpTools(chain) : rpcTools(atl, 'Atlantic RPC');
    return jsonSafe({ chain: net, diagnosis: await diagnose({ hash, tools, explorer: net === 'mainnet' ? 'https://www.pharosscan.xyz' : 'https://atlantic.pharosscan.xyz' }) });
  }
  throw new UserError('use ?diagnose=1&hash=0x…&chain=mainnet|atlantic or ?recorded=1');
}
