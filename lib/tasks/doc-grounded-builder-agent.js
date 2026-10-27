// Task: Doc-Grounded Builder Agent. The web side of lib/builder.js: ask a "how do I…" question and get the plan from the docs, the action through Chain MCP and the verification on
// chain; give back the hash of a transaction you signed to have its outcome checked against the plan; and the recorded runs (their Atlantic transactions re-read from the chain).
// The agent holds no key: anything that moves funds comes back prepared, unsigned.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runRequest, verifyOutcome } from '../builder.js';
import { atlanticChain } from '../rpc-chain.js';
import { rpcCall } from '../rpc.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const atl = (m, p = []) => rpcCall(m, p, { url: 'https://atlantic.dplabs-internal.com', why: `builder agent: ${m}` });

// the two real Atlantic transactions of the recording are read back: they succeeded, and the deployment really left the compiled Counter code at its address
async function verify(rec) {
  const send = rec.cases.find((c) => c.id === 'send-atlantic').afterSigning; const dep = rec.cases.find((c) => c.id === 'deploy').afterSigning;
  const code = dep.result?.contract ? await atl('eth_getCode', [dep.result.contract, 'latest']) : '0x';
  const bal = send.result?.recipient ? await atl('eth_getBalance', [send.result.recipient, 'latest']) : '0x0';
  const checks = [
    { what: 'the deployed Counter contract still has code on Atlantic', ok: code !== '0x', detail: dep.result?.contract },
    { what: 'the transfer’s recipient holds at least the amount that was sent', ok: BigInt(bal) >= BigInt(send.result?.valueWei ?? 0), detail: send.result?.recipient },
    { what: 'both signed transactions were recorded as verified against their plans', ok: send.status === 'success' && dep.status === 'success', detail: `${send.status}, ${dep.status}` },
  ];
  return { checkedAt: new Date().toISOString(), checks, total: checks.length, verifiedCount: checks.filter((c) => c.ok).length };
}

export default async function run({ q, body, chain, docs }) {
  const clients = { chain, docs, atlantic: atlanticChain() };
  if (q.recorded) { const rec = await json('reports/builder-run.json'); return { run: rec, verification: await verify(rec) }; }
  if (q.examples) { const rec = await json('reports/builder-run.json'); return { examples: rec.cases.map((c) => ({ id: c.id, title: c.title, question: c.question })) }; }
  if (q.ask) {
    const question = String(q.question ?? '').trim();
    if (!question) throw new UserError('ask a question, like “How do I read the BTC/USD price on Pharos?”');
    return jsonSafe({ result: await runRequest({ question, clients }) });
  }
  if (q.verify) {
    const { prepared, hash, network } = body ?? {};
    if (!prepared || typeof prepared !== 'object') throw new UserError('POST { "prepared": …, "hash": "0x…", "network": "atlantic" }: the prepared transaction the agent gave you and the hash of the transaction you signed');
    if (!['mainnet', 'atlantic'].includes(network)) throw new UserError('network must be mainnet or atlantic');
    return jsonSafe({ outcome: await verifyOutcome({ prepared, hash, clients, network }) });
  }
  throw new UserError('use ?ask=1&question=…, POST ?verify=1, ?examples=1 or ?recorded=1');
}
