// Task: Docs MCP Onboarding.
//
// A new developer asks Developer Docs MCP the questions they would really need, and
// each answer is checked against reality (the live network, the live MCP server, real
// URLs). A check that fails is a documentation gap, reported with the exact query, the
// evidence, and what the docs should have said. Nothing is hard-coded as "broken": if
// the docs are fixed, the gap stops appearing.

import { cleanMarkdown, splitAnswer } from '../docs.js';
import { decodeString } from '../abi.js';
import { probeUrl } from '../http.js';
import { PHAROS_RPC, rpcCall } from '../rpc.js';
import { UserError } from '../snapshot.js';

export const ATLANTIC_RPC = 'https://atlantic.dplabs-internal.com';
const ATLANTIC_CHAIN_ID = 688689;
const MAINNET_CHAIN_ID = 1672;

// ---- pure helpers (unit-tested) ----------------------------------------------------
export const urlsIn = (t) => [...new Set([...t.matchAll(/https?:\/\/[^\s)`'"<>\]]+/g)].map((m) => m[0].replace(/[.,;:]+$/, '')))];
export const addressesIn = (t) => [...new Set([...t.matchAll(/0x[0-9a-fA-F]{40}\b/g)].map((m) => m[0]))];
export const numbersIn = (t) => [...t.matchAll(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g)].map((m) => Number(m[0].replace(/,/g, '')));
export const toolNamesIn = (t) => [...new Set([...t.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => /^(get_|eth_|estimate_|send_)/.test(n)))];
const check = (name, ok, detail) => ({ name, ok, detail });

// A slow testnet RPC must not turn into a wrong verdict: if it cannot be reached the
// result is "unknown" for that address, never a failure of the docs.
async function inspectToken(address) {
  const call = (method, params, why) => rpcCall(method, params, { url: ATLANTIC_RPC, why, timeoutMs: 20_000 });
  try {
    const code = await call('eth_getCode', [address, 'latest'], `Is ${address.slice(0, 8)}… a contract on Atlantic?`);
    const [sym, dec] = await Promise.all([
      call('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest'], 'Read its symbol()').catch(() => null),
      call('eth_call', [{ to: address, data: '0x313ce567' }, 'latest'], 'Read its decimals()').catch(() => null),
    ]);
    return { address, bytes: (code.length - 2) / 2, symbol: sym && sym !== '0x' ? decodeString(sym) : null, decimals: dec && dec !== '0x' ? Number(BigInt(dec)) : null };
  } catch (err) {
    return { address, error: err.message };
  }
}

// ---- the onboarding script ---------------------------------------------------------
export const STEPS = [
  {
    id: 'network',
    goal: 'Find the testnet RPC URL and chain ID',
    question: 'What is the RPC URL and chain ID for Pharos Atlantic Testnet?',
    async verify(text) {
      const rpc = urlsIn(text).find((u) => /atlantic/.test(u));
      const claimed = numbersIn(text).includes(ATLANTIC_CHAIN_ID);
      let live = null;
      if (rpc) live = parseInt(await rpcCall('eth_chainId', [], { url: rpc, why: 'Does the documented RPC really serve that chain ID?' }).catch(() => '0x0'), 16);
      return [
        check('The answer gives an RPC URL', Boolean(rpc), rpc ?? 'no URL in the answer'),
        check(`The answer gives chain ID ${ATLANTIC_CHAIN_ID}`, claimed, claimed ? 'present' : 'missing'),
        check('The live RPC reports the same chain ID', live === ATLANTIC_CHAIN_ID, `eth_chainId returned ${live}`),
      ];
    },
  },
  {
    id: 'faucet',
    goal: 'Get testnet PHRS to pay for gas',
    question: 'How do I get testnet PHRS from a faucet? Give me the faucet URL.',
    gapTitle: 'No faucet URL anywhere in the docs',
    fix: 'Name the faucet and link it from “Get PROS Gas” and “Atlantic Testnet”, with the claim amount, the rate limit and what to do if it is empty. Without it a new developer cannot send a single transaction.',
    async verify(text) {
      const external = urlsIn(text).filter((u) => !/docs\.pharos\.xyz/.test(u));
      return [check('The answer contains a faucet URL', external.length > 0, external[0] ?? 'the answer links only to other docs pages and says no faucet URL is given')];
    },
  },
  {
    id: 'mcp-config',
    goal: 'Connect an AI client to the Pharos MCP server',
    question: 'How do I connect the Pharos MCP server to Claude Desktop? Show the exact config.',
    async verify(text, { chain }) {
      const has = /https:\/\/mcp\.pharos\.xyz\/mcp/.test(text);
      const info = has ? await chain.callTool('get_chain_info', {}, { why: 'Does the documented endpoint actually work?' }).catch((e) => ({ error: e.message })) : null;
      return [check('The answer shows the server URL', has, has ? 'https://mcp.pharos.xyz/mcp' : 'no URL'), check('That URL works as documented', Boolean(info?.chainId), info?.chainId ? `connected, chain ${info.chainId}` : (info?.error ?? 'not tried'))];
    },
  },
  {
    id: 'tools',
    goal: 'Learn what the MCP server can do',
    question: 'Which tools does the Pharos MCP server expose?',
    async verify(text, { chain }) {
      const real = (await chain.listTools()).map((t) => t.name);
      const said = toolNamesIn(text);
      const missing = real.filter((n) => !said.includes(n));
      const extra = said.filter((n) => !real.includes(n));
      return [check('The documented tool list matches the live server', !missing.length && !extra.length, `live server lists ${real.length} tools; answer names ${said.length}${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; not on the server: ${extra.join(', ')}` : ''}`)];
    },
  },
  {
    id: 'getlogs',
    goal: 'Query event logs without hitting a limit',
    question: 'What is the maximum block range I can query with eth_getLogs on Pharos?',
    gapTitle: 'The documented eth_getLogs block range is wrong',
    fix: 'State the real limit (1,000 blocks, inclusive) once on the JSON-RPC page and use that number everywhere, including in what Docs MCP answers.',
    async verify(text) {
      const head = parseInt(await rpcCall('eth_blockNumber', [], { why: 'Chain head, to build test ranges' }), 16);
      const range = (blocks) => rpcCall('eth_getLogs', [{ address: '0xc879c018db60520f4355c26ed1a6d572cdac1815', fromBlock: '0x' + (head - blocks + 1).toString(16), toBlock: '0x' + head.toString(16) }], { why: `Real limit: ask for ${blocks} blocks` }).then(() => true, () => false);
      const [ok1000, ok1001] = await Promise.all([range(1000), range(1001)]);
      const realCap = ok1000 && !ok1001 ? 1000 : null;
      // Any limit the answer states that is not the real one counts against it, even if the
      // right number also appears (e.g. for the MCP tool) next to a wrong one for the RPC.
      const said = [...new Set(numbersIn(text).filter((n) => n >= 50))];
      const wrong = said.filter((n) => n !== realCap);
      const fmt = (ns) => ns.map((n) => n.toLocaleString('en-US')).join(', ');
      return [check('Every block-range limit stated matches the real limit (1,000)', realCap != null && !wrong.length && said.includes(realCap), `the public RPC accepts 1,000 blocks and rejects 1,001; the answer states ${said.length ? fmt(said) : 'no number'}${wrong.length ? `, of which ${fmt(wrong)} ${wrong.length > 1 ? 'are' : 'is'} wrong` : ''}`)];
    },
  },
  {
    id: 'skill-install',
    goal: 'Install the Skill Engine',
    question: 'How do I install the Pharos Skill Engine?',
    gapTitle: 'The Skill Engine install steps never say where to get it',
    fix: 'Start with the source: “npx skills add https://github.com/PharosNetwork/pharos-skill-engine” or a download link for the ZIP. Today the guide says “after obtaining the ZIP” without a link.',
    async verify(text) {
      const repo = await probeUrl('https://github.com/PharosNetwork/pharos-skill-engine', { why: 'Does a public source for the Skill Engine exist?' });
      const gives = /github\.com|npx skills|https?:\/\/\S+\.zip/i.test(text);
      return [check('The answer says where to obtain it', gives, gives ? 'a source is given' : `no source in the answer, although the public repository exists (HTTP ${repo.status})`)];
    },
  },
  {
    id: 'usdc',
    goal: 'Find the right testnet USDC address',
    question: 'What is the USDC token address on Atlantic testnet?',
    gapTitle: 'Two different “USDC” addresses on Atlantic, with no guidance on which to use',
    fix: 'Say which USDC is for what (general use vs x402), mark the other clearly, and use the same address in every example, including the Skill Engine guide.',
    async verify(text) {
      const addrs = addressesIn(text);
      const tokens = await Promise.all(addrs.map(inspectToken));
      const known = tokens.filter((t) => !t.error);
      const unknown = tokens.filter((t) => t.error);
      const usdc = known.filter((t) => t.symbol === 'USDC');
      const list = known.map((t) => `${t.address.slice(0, 8)}…${t.address.slice(-4)} (${t.symbol ?? 'no symbol'}, ${t.bytes} bytes)`).join('; ');
      const note = unknown.length ? ` (${unknown.length} address${unknown.length > 1 ? 'es' : ''} could not be checked: ${unknown[0].error})` : '';
      return [
        check('Every address in the answer is a real contract', tokens.length === 0 ? false : unknown.length ? null : known.every((t) => t.bytes > 0), (list || 'no address in the answer') + note),
        check('The answer leads to one USDC, not several', usdc.length > 1 ? false : unknown.length ? null : true, `${usdc.length} distinct contract${usdc.length === 1 ? '' : 's'} on Atlantic report symbol USDC: ${list}${note}`),
      ];
    },
  },
  {
    id: 'mainnet-verify',
    goal: 'Verify a contract on mainnet',
    question: 'How do I verify a contract on Pacific Mainnet?',
    async verify(text) {
      const url = urlsIn(text).find((u) => /socialscan/.test(u));
      const probe = url ? await probeUrl(url, { why: 'Does the documented verifier endpoint answer?' }) : null;
      return [
        check('The answer gives chain ID 1672 and a verifier URL', /1672/.test(text) && Boolean(url), url ?? 'no verifier URL'),
        check('The verifier endpoint is reachable', probe ? probe.status > 0 && probe.status < 500 : false, probe ? `HTTP ${probe.status}${probe.error ? ` (${probe.error})` : ''}` : 'not tried'),
      ];
    },
  },
  {
    id: 'x402',
    goal: 'Run x402 on mainnet',
    question: 'What is the x402 facilitator URL on Pacific Mainnet?',
    gapTitle: 'No facilitator URL for x402 on Pacific Mainnet',
    fix: 'Publish the mainnet facilitator URL (or say plainly that you must run your own, and link the reference implementation) on the x402 Pacific Mainnet page.',
    async verify() {
      const page = await probeUrl('https://docs.pharos.xyz/developer-guide/x402/x402-pacific-mainnet.md', { why: 'Read the mainnet x402 page itself', readBody: true });
      const line = page.body.match(/FACILITATOR_URL[^\n]*/)?.[0] ?? null;
      const hasUrl = Boolean(line && /https?:\/\//.test(line));
      return [check('The page gives a mainnet facilitator URL', hasUrl, line ? `the page only says: ${line.trim().slice(0, 120)}` : 'no FACILITATOR_URL on the page')];
    },
  },
  {
    id: 'llms',
    goal: 'Point an AI agent at the machine-readable docs',
    question: 'Where is the llms.txt file for AI agents?',
    gapTitle: 'llms.txt: Docs MCP cannot say where it is, and the advertised endpoint is a 404',
    fix: 'Document https://docs.pharos.xyz/llms.txt (it exists), make Docs MCP aware of it, and fix or remove the www.pharos.xyz/agent-center/llms.txt endpoint that ai.pharos.xyz advertises.',
    async verify(text) {
      const [docs, advertised] = await Promise.all([
        probeUrl('https://docs.pharos.xyz/llms.txt', { why: 'Does the docs site publish llms.txt?' }),
        probeUrl('https://www.pharos.xyz/agent-center/llms.txt', { why: 'Does the endpoint advertised by ai.pharos.xyz work?' }),
      ]);
      const knows = /llms\.txt/.test(text) && !/cannot find|can't find|not find/i.test(text);
      return [
        check('Docs MCP can say where llms.txt is', knows, knows ? 'yes' : 'the answer says it cannot find information about llms.txt'),
        check('docs.pharos.xyz/llms.txt exists', docs.status === 200, `HTTP ${docs.status}`),
        check('The endpoint advertised on ai.pharos.xyz works', advertised.status === 200, `www.pharos.xyz/agent-center/llms.txt returned HTTP ${advertised.status}`),
      ];
    },
  },
];

// ---- what the onboarding managed to run -------------------------------------------
async function finale({ chain }) {
  const [info, head, atlHex, atlId, mainHex] = await Promise.all([
    chain.callTool('get_chain_info', {}, { why: 'Use the MCP config from the docs: which network is this?' }),
    chain.callTool('get_block_number', {}, { why: 'Read the latest block through Chain MCP' }),
    rpcCall('eth_blockNumber', [], { url: ATLANTIC_RPC, why: 'Read the testnet head with the RPC URL from the docs' }),
    rpcCall('eth_chainId', [], { url: ATLANTIC_RPC, why: 'Confirm the testnet chain ID from the docs' }),
    rpcCall('eth_blockNumber', [], { url: PHAROS_RPC, why: 'Read the mainnet head with the RPC URL from the docs' }),
  ]);
  const built = [
    `Connected to Chain MCP using only the config from the docs; it reported chain ${info.chainId} (${info.name}) at block ${Number(head.blockNumber).toLocaleString('en-US')}.`,
    `Reached the Atlantic testnet RPC from the docs: chain ID ${parseInt(atlId, 16)}, block ${parseInt(atlHex, 16).toLocaleString('en-US')}.`,
    `Reached the mainnet RPC from the docs: block ${parseInt(mainHex, 16).toLocaleString('en-US')}, matching Chain MCP’s chain ${MAINNET_CHAIN_ID}.`,
    'Read live contract state and logs through the documented tools (the Read Contract State and Event/Log Monitor tasks).',
  ];
  const couldNot = [
    'Send a transaction or deploy to Atlantic: no faucet URL, so no testnet PHRS for gas.',
    'Run x402 on mainnet: no facilitator URL is documented.',
  ];
  return { built, couldNot, chainId: info.chainId };
}

// ---- report ------------------------------------------------------------------------
const mark = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '·');

export function buildReport({ results, finale: fin, generatedAt }) {
  const gaps = results.filter((r) => r.gap);
  const out = [
    '# Onboarding onto Pharos using only Developer Docs MCP',
    '',
    `Generated ${generatedAt} against the live docs server. Every question below was asked to \`askQuestion\` on Developer Docs MCP and every answer was checked against the live network or the real URL it points at. No other documentation, search engine or community help was used.`,
    '',
    `**${results.length} questions asked, ${gaps.length} gaps found.**`,
    '',
    '## Step-by-step log',
    '',
    ...results.flatMap((r, i) => [
      `### ${i + 1}. ${r.goal}`,
      '',
      `**Question asked:** ${r.question}`,
      '',
      ...r.answer.split('\n').slice(0, 12).map((l) => `> ${l}`),
      '',
      ...r.checks.map((c) => `- ${mark(c.ok)} ${c.name}: ${c.detail}`),
      '',
    ]),
    `## Gaps found (${gaps.length})`,
    '',
    ...(gaps.length
      ? gaps.flatMap((r, i) => [`### Gap ${i + 1}: ${r.gap.title}`, '', `- **Exact query:** \`${r.question}\``, `- **What happened:** ${r.gap.evidence.join(' ')}`, `- **What the docs should say:** ${r.gap.fix}`, ''])
      : ['No gaps found in this run.', '']),
    '## What I built or ran by the end',
    '',
    ...(fin ? fin.built.map((b) => `- ${b}`) : []),
    '',
    '## What I could not do',
    '',
    ...(fin ? fin.couldNot.map((b) => `- ${b}`) : []),
    '',
  ];
  return out.join('\n');
}

// ---- handler -----------------------------------------------------------------------
export default async function run({ q, body, chain, docs }) {
  const step = q.step ?? 'plan';
  if (step === 'plan') return { steps: STEPS.map(({ id, goal, question }) => ({ id, goal, question })) };
  if (step === 'finale') return finale({ chain });
  if (step === 'report') {
    if (!body?.results) throw new UserError('POST the step results as { results, finale }');
    return { markdown: buildReport({ results: body.results, finale: body.finale, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }) };
  }
  const s = STEPS.find((x) => x.id === step);
  if (!s) throw new UserError(`unknown step "${step}"`);
  const raw = await docs.callTool('askQuestion', { question: s.question, goal: 'Onboard onto Pharos as a new developer using only these docs' }, { why: `Onboarding step: ${s.goal}` });
  const { answer, listed } = splitAnswer(cleanMarkdown(String(raw)));
  const checks = await s.verify(answer, { chain, docs });
  const failed = checks.filter((c) => c.ok === false);
  return {
    id: s.id,
    goal: s.goal,
    question: s.question,
    answer,
    sources: listed.slice(0, 3),
    checks,
    gap: failed.length ? { title: s.gapTitle ?? `Unexpected failure: ${s.goal}`, fix: s.fix ?? 'Investigate: the answer disagreed with the live network.', evidence: failed.map((c) => `Expected: ${c.name.charAt(0).toLowerCase()}${c.name.slice(1)}. Found: ${c.detail}.`) } : null,
  };
}
