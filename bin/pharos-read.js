#!/usr/bin/env node
// Task: Read Contract State (Chain MCP)
// Reads live state from a Pharos contract through the hosted Chain MCP server
// and prints it the way a non-developer would want to read it.

import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { readSnapshot } from '../lib/snapshot.js';
import { formatInt, isAddress } from '../lib/abi.js';
import { parseLabelFlags, shortAddress } from '../lib/labels.js';
import { fail, parseCli, utc } from '../lib/cli.js';

const DEFAULT_CONTRACT = '0xc879c018db60520f4355c26ed1a6d572cdac1815'; // USDC on Pharos mainnet

const usage = `Usage: pharos-read [contract] [options]

Read a token contract's state on Pharos via Chain MCP and show it in plain language.

  contract            0x address of an ERC-20-style contract (default: USDC on Pharos mainnet)

Options:
  --holder <0x…>      also show this wallet's balance (repeatable)
  --block <n>         read at this block instead of the latest
  --label <0x…=Name>  give an address a name in the output (repeatable)
  --json              machine-readable output
  -h, --help          show this help`;

const { values, positionals } = parseCli({
  usage,
  options: {
    holder: { type: 'string', multiple: true },
    block: { type: 'string' },
    label: { type: 'string', multiple: true },
    json: { type: 'boolean' },
  },
});

const address = (positionals[0] ?? DEFAULT_CONTRACT).toLowerCase();
if (!isAddress(address)) fail(`"${positionals[0]}" is not a valid 0x address`, usage);
for (const h of values.holder ?? []) if (!isAddress(h)) fail(`--holder "${h}" is not a valid 0x address`, usage);
if (values.block && !/^\d+$/.test(values.block)) fail('--block must be a block number', usage);

const client = new McpClient(PHAROS_CHAIN_MCP);

try {
  const s = await readSnapshot(client, {
    address,
    holders: values.holder ?? [],
    block: values.block ? Number(values.block) : undefined,
    labels: parseLabelFlags(values.label),
  });
  await client.close();

  if (values.json) {
    console.log(JSON.stringify({ ...s, block: { ...s.block, time: utc(s.block.timestamp) } }, null, 2));
  } else {
    const row = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`);
    const who = (a) => `${a.description}  ${shortAddress(a.address)}`;
    const unit = s.symbol ? ` ${s.symbol}` : '';
    const title = [s.name, s.symbol && s.symbol !== s.name && `(${s.symbol})`].filter(Boolean).join(' ');

    console.log(`\nPharos contract snapshot`);
    console.log('─'.repeat(60));
    row('Contract', title || '(unnamed contract)');
    row('Address', s.contract);
    row('Network', `${s.network.name} · chain ${s.network.chainId}`);
    row('Read at', `block ${formatInt(s.block.number)} · ${utc(s.block.timestamp)}`);
    row('Code size', `${formatInt(s.codeBytes)} bytes`);
    console.log('\nValues read via Chain MCP (eth_call at that block)');
    row('name', s.name ?? 'n/a');
    row('symbol', s.symbol ?? 'n/a');
    row('decimals', s.decimals ?? 'n/a');
    row('totalSupply', s.totalSupply ? `${s.totalSupply.formatted}${unit}   (raw ${s.totalSupply.raw})` : 'n/a');
    row('owner', s.owner ? who(s.owner) : 'n/a (contract has no owner())');
    for (const h of s.balances) row('balanceOf', h.raw == null ? `${who(h)} → n/a` : `${who(h)} → ${h.formatted}${unit}`);
    console.log();
  }
} catch (err) {
  await client.close();
  fail(err.message);
}
