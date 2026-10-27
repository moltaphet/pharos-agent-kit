#!/usr/bin/env node
// The Multi-Protocol Aggregator, run on Pharos MAINNET (read-only; nothing is signed or sent). Five venues of three protocols (R25 × 3, Morpho Vault V2, Morpho Blue) behind one
// interface: queries (rates, liquidity, positions of three real wallets), routed deposits and withdrawals with the reasons, the unsigned transactions with their simulations, and
// outages: a protocol's reads pointed at an unreachable endpoint, to show that the others carry on.
//
//   node scripts/aggregator-run.mjs        writes reports/aggregator-run.json

import { writeFileSync } from 'node:fs';
import { PROTOCOLS, prepare, route, snapshot, summarize } from '../lib/aggregator.js';

const say = (s) => process.stderr.write(s + '\n');
const ser = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const WALLETS = [
  { id: 'rockaway-holder', address: '0xbe2174ff12a71b6deeca5b9aaf4c2931e8c62ae5', title: 'A holder of the RockawayX vault' },
  { id: 'r25-holder', address: '0x40836f8f1bd7e13d99a4cc9de5c0b80a83109819', title: 'A holder of R25 VRPC Quarterly' },
  { id: 'morpho-supplier', address: '0xba3b260596d8412318ee6ef5476291f6c8e3b68a', title: 'A supplier to the Morpho Blue market' },
];
const base = await snapshot({});
const block = base.block;
say(`block ${block}`);

// 1. queries: the same call for every wallet
const queries = [];
for (const w of WALLETS) {
  const snap = await snapshot({ wallet: w.address, block });
  const s = summarize(snap);
  say(`query ${w.id}: ${s.text}`);
  queries.push({ ...w, summary: s });
}
const rates = summarize(await snapshot({ block }));

// 2. routing
const scenarios = [];
const go = async (id, title, wallet, action, amount, opts = {}) => {
  const snap = await snapshot({ wallet, block, probe: { action, amountRaw: BigInt(Math.round(Number(amount) * 1e6)) }, down: opts.down ?? [] });
  const routed = route({ snap, action, amount });
  const prepared = routed.legs.length ? await prepare({ snap, routed, wallet }) : null;
  say(`${id}: ${routed.why}`);
  scenarios.push(ser({ id, title, wallet, action, amount, down: opts.down ?? [], available: snap.available, unavailable: snap.unavailable, routed, prepared, venues: summarize(snap).rows }));
};
const RW = WALLETS[0].address; const ANYONE = '0x1159105d91825b0615c9fbe23c2055676676f96d';
await go('deposit-small', 'A small deposit from a wallet nobody has special access for', ANYONE, 'deposit', '500');
await go('deposit-rockaway-wallet', 'The same deposit from a wallet the permissioned vaults know', RW, 'deposit', '2500');
await go('withdraw', 'A withdrawal: from the venue that earns the least and can pay', RW, 'withdraw', '1000');
await go('withdraw-too-much', 'A withdrawal larger than the wallet holds', RW, 'withdraw', '100000');
await go('outage-best-venue', 'The best venue’s protocol is down: the others carry on', RW, 'deposit', '2500', { down: ['Morpho Vault V2'] });
await go('outage-r25', 'R25 is down: the deposit is routed among the rest', ANYONE, 'deposit', '500', { down: ['R25'] });
await go('outage-all-but-one', 'Everything but Morpho Blue is down', ANYONE, 'deposit', '500', { down: ['R25', 'Morpho Vault V2'] });
await go('outage-all', 'Everything is down: a clear answer, no crash', ANYONE, 'deposit', '500', { down: PROTOCOLS });
const queryDown = summarize(await snapshot({ wallet: RW, block, down: ['R25'] }));
const report = {
  recordedAt: new Date().toISOString(), network: 'Pharos mainnet (1672), read-only: nothing was signed or sent. Outages are made by pointing a protocol’s reads at an unreachable endpoint.', block,
  venues: rates.rows.map((r) => ({ id: r.id, name: r.name, protocol: r.protocol })), protocols: PROTOCOLS, rates, queries, queryWithR25Down: queryDown, scenarios,
  summary: { venues: rates.rows.length, protocols: PROTOCOLS.length, queriedWallets: queries.length, scenarios: scenarios.length, outageScenarios: scenarios.filter((s) => s.down.length).length },
};
writeFileSync(new URL('../reports/aggregator-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote reports/aggregator-run.json: ${report.summary.venues} venues of ${report.summary.protocols} protocols, ${report.summary.scenarios} routed requests (${report.summary.outageScenarios} with an outage)`);
