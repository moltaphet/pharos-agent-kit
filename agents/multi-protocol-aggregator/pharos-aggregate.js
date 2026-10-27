#!/usr/bin/env node
// Task 30: one interface over several Pharos protocols. Queries (rates, positions) and actions (deposit, withdraw: unsigned) routed to the best venue, with the reasons.
//   pharos-aggregate rates
//   pharos-aggregate positions <wallet>
//   pharos-aggregate deposit  <wallet> <amount USDC>        pharos-aggregate withdraw <wallet> <amount USDC>        (add --down R25 to see an outage)
import { fail, parseCli } from '../../lib/cli.js';
import { PROTOCOLS, prepare, route, snapshot, summarize } from '../../lib/aggregator.js';

const usage = `Usage: pharos-aggregate rates | positions <wallet> | deposit <wallet> <amount> | withdraw <wallet> <amount>   [--down <${PROTOCOLS.join('|')}>[,…]] [--json]`;
const { values, positionals } = parseCli({ usage, options: { down: { type: 'string' }, json: { type: 'boolean' } } });
const [cmd, wallet, amount] = positionals;
const down = values.down ? values.down.split(',').map((s) => s.trim()) : [];
const bj = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
try {
  if (cmd === 'rates' || cmd === 'positions') {
    if (cmd === 'positions' && !wallet) fail('give a wallet', usage);
    const snap = await snapshot({ wallet: cmd === 'positions' ? wallet : null, down });
    const s = summarize(snap);
    if (values.json) console.log(bj({ block: snap.block, ...s })); else {
      console.log(`Pharos mainnet, block ${snap.block.toLocaleString('en-US')}\n`);
      for (const r of s.rows) console.log(r.status === 'ok' ? `  ${r.name.padEnd(46)} ${r.apyText.padStart(7)}  locked ${r.tvlText.padEnd(22)} ${r.positionText ? `you: ${r.positionText}` : ''}` : `  ${r.name.padEnd(46)} UNAVAILABLE: ${r.error}`);
      console.log(`\n${cmd === 'positions' ? s.text : s.best ? `Best measured return: ${s.best.name} at ${s.best.apyText}.` : 'No rate could be read.'}`);
    }
  } else if (cmd === 'deposit' || cmd === 'withdraw') {
    if (!wallet || !amount) fail('give a wallet and an amount', usage);
    const probe = route({ snap: { venues: [] }, action: cmd, amount });
    const snap = await snapshot({ wallet, down, probe: { action: cmd, amountRaw: BigInt(probe.amountRaw) } });
    const routed = route({ snap, action: cmd, amount });
    const prepared = routed.legs.length ? await prepare({ snap, routed, wallet }) : null;
    if (values.json) console.log(bj({ routed, prepared })); else {
      console.log(`${routed.why}\n${routed.unavailableNote ? `${routed.unavailableNote}\n` : ''}\nWhy not the others:`);
      for (const c of routed.considered) console.log(`  ${c.eligible ? '✓' : '✗'} ${c.name}: ${c.reason}`);
      if (prepared) { console.log(`\n${prepared.signing}`); for (const l of prepared.legs) { console.log(`\n${l.venue}${l.simulation ? ` (${l.simulation.ok ? 'simulation ok' : 'SIMULATION FAILED'}: ${l.simulation.note})` : ''}`); for (const t of l.transactions) console.log(`  - ${t.label}\n    to ${t.to}\n    data ${t.data.slice(0, 74)}${t.data.length > 74 ? '…' : ''}`); } }
    }
  } else fail('use rates, positions, deposit or withdraw', usage);
} catch (err) { console.error(`error: ${err.message}`); process.exitCode = 1; }
