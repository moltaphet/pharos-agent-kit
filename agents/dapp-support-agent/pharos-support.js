#!/usr/bin/env node
// Task 27: paste the hash of a failed transaction, get a plain-language explanation and what to do about it.
import { fail, parseCli } from '../../lib/cli.js';
import { McpClient, PHAROS_CHAIN_MCP } from '../../lib/mcp.js';
import { rpcCall } from '../../lib/rpc.js';
import { ATLANTIC } from '../../lib/rpc-chain.js';
import { diagnose, mcpTools, rpcTools } from '../../lib/support.js';

const usage = 'Usage: pharos-support <tx hash> [--chain mainnet|atlantic] [--json]';
const { values, positionals } = parseCli({ usage, options: { chain: { type: 'string' }, json: { type: 'boolean' } } });
const [hash] = positionals;
if (!hash) fail('give the transaction hash', usage);
const net = values.chain ?? 'mainnet';
if (!['mainnet', 'atlantic'].includes(net)) fail('--chain must be mainnet or atlantic', usage);
const client = net === 'mainnet' ? new McpClient(PHAROS_CHAIN_MCP, { label: 'support' }) : null;
try {
  const tools = net === 'mainnet' ? mcpTools(client) : rpcTools((m, p = []) => rpcCall(m, p, { url: ATLANTIC.rpc, why: `support agent: ${m}` }), 'Atlantic RPC');
  const d = await diagnose({ hash, tools, explorer: net === 'mainnet' ? 'https://www.pharosscan.xyz' : 'https://atlantic.pharosscan.xyz' });
  if (values.json) { console.log(JSON.stringify(d, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)); } else {
    console.log(`${d.headline}\n\n${d.plain}\n`);
    if (d.fix?.length) console.log('What you can do:\n' + d.fix.map((f) => `  • ${f}`).join('\n') + '\n');
    if (d.reason) console.log(`The contract’s own words: ${d.reason}`);
    console.log('What I checked:\n' + (d.steps ?? []).map((s) => `  - ${s.tool}: ${s.what} → ${s.result}`).join('\n') + `\n${d.links.explorer}`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally { await client?.close(); }
