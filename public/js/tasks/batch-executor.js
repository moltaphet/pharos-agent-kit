// Batch Executor: content and a factory panel.
import { esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const PAIRS = ['0xb7d5d299c671e4a4c7c0c5a33b812185182fc417', '0xb9f329a51837d27a20dff113679d47d673d5e45b', '0x7F4A462FC320db1E26dd1366DcE9E276eE6c5930'];
const SYNC = JSON.stringify([...PAIRS.map((to) => ({ to, data: '0xfff6cae9' })), { to: '0xc879c018db60520f4355c26ed1a6d572cdac1815', data: '0xdeadbeef' }], null, 2);
const NATIVE = JSON.stringify([{ to: '0x1111111111111111111111111111111111111111', amountPros: '0.001' }, { to: '0x2222222222222222222222222222222222222222', amountPros: '0.002' }, { to: '0x3333333333333333333333333333333333333333', amountPros: '0.003' }], null, 2);
const ERC20 = JSON.stringify([{ to: '0x1111111111111111111111111111111111111111', amountPros: '0.001' }, { to: '0x2222222222222222222222222222222222222222', amountPros: '0.001' }, { to: '0xc879c018db60520f4355c26ed1a6d572cdac1815', data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240' }], null, 2);
const FROM = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
const g = (n) => Number(n).toLocaleString('en-US');

export const content = {
  tagline: 'Do several independent things in one transaction, with the real gas change and a clear answer to “which one failed?”.',
  tools: ['chain'],
  skill: true,
  story: [
    'Sometimes you have a handful of independent jobs: poke several pools, pay several people. Sending them one by one means one signature, one fee and one chance to fail for each. The Batch Executor is a Pharos Skill that bundles three or more of them into a single Multicall3 transaction and prepares it for you to sign.',
    'Before bundling, it simulates every action alone, so a failing one is named with its reason instead of being discovered on chain. A policy decides what happens then: leave the failing action out and batch the rest, or prepare nothing at all. If a failing action is forced into the batch anyway, the whole batch reverts and nothing is half-done.',
    'It is honest about the numbers. Batching is not magic: plain PROS transfers are already the cheapest a transaction can be, so batching them costs more gas (63,000 one by one against 107,196 batched on a fork). Calls that do real work save the per-transaction base: four FaroSwap sync() calls used 178,977 gas one by one and 150,762 batched, a 15.8% saving. And it refuses the dangerous case: an ERC-20 transfer would come from Multicall3, not from you.',
  ],
  how: [
    { server: 'local', tool: 'validate', text: 'At least 3 and at most 25 actions, valid addresses and hex, exact PROS amounts. ERC-20 transfer, approve and transferFrom are refused with the reason.' },
    { server: 'chain', tool: 'get_block_number', text: 'Pin the whole plan to one block.' },
    { server: 'chain', tool: 'eth_call · estimate_gas (each action)', text: 'Simulate each action on its own and cost it as a separate transaction.' },
    { server: 'local', tool: 'apply the failure policy', text: 'exclude: batch the passing actions and name the rest. abort: if any action fails, prepare nothing.' },
    { server: 'local', tool: 'encode aggregate3Value', text: 'One call per action with allowFailure=false, and a single payment equal to the sum of the values. The encoder matches `cast calldata` byte for byte.' },
    { server: 'chain', tool: 'eth_call · estimate_gas (the batch)', text: 'Simulate the whole batch and compare its gas with the sum of the separate transactions.' },
  ],
  decisions: [
    { title: 'A batch is not always cheaper, and we say so', text: 'The first test run used two precompile addresses and showed a 13% saving, which was an accident. With ordinary recipients a native-transfer batch costs 70% more on a fork. The page reports the measured number either way.' },
    { title: 'Refuse what Multicall3 breaks', text: 'The inner sender is Multicall3. An ERC-20 transfer would move Multicall3’s tokens, and approving Multicall3 so it could move yours would let anyone spend them. Those actions are rejected with that explanation.' },
    { title: 'All-or-nothing on chain', text: 'Every inner call has allowFailure=false. With allowFailure on, a failed call’s value stays inside Multicall3 and is lost. Failures are caught in simulation instead, by name.' },
    { title: 'A test setup that fooled us', text: 'Our first “forced failure” demo seemed to prove the batch reverts, but the reason was “insufficient funds for gas”: the node gave up at gas estimation. With explicit gas the revert happens inside the EVM and the real reason, “Multicall3: call failed”, appears.' },
    { title: 'Prepared, never sent', text: 'The output is an unsigned transaction. No key is involved.' },
  ],
  evidence: [
    'Accepts a list of at least 3 independent actions (up to 25), validated one by one.',
    'Executes them as one batch: a single Multicall3.aggregate3Value transaction, prepared unsigned, whose encoding matches `cast calldata`.',
    'Reports the gas and step change against sending them one by one: estimated here, and measured on a real-EVM fork (178,977 → 150,762 gas for the sync workload; and honestly +70% for plain transfers).',
    'Handles partial failure by name: each failing action is listed with its reason, the policy decides whether to exclude it or abort, and forcing it in makes the whole batch revert with nothing changed.',
  ],
  files: ['skills/pharos-batch-executor/SKILL.md', 'skills/pharos-batch-executor/references/batch-executor.md', 'skills/pharos-batch-executor/scripts/batch.mjs', 'lib/tasks/batch-executor.js', 'lib/multicall.js'],
  run: {
    commands: ['node skills/pharos-batch-executor/scripts/batch.mjs --from 0x9f8ea09770dc38fc61f5a62031b3be0526d54d92 --actions skills/pharos-batch-executor/examples/sync-pairs.json', '… --fork --out run.json   # real execution on a local fork', '… --actions skills/pharos-batch-executor/examples/native-transfers.json   # shows a batch that costs MORE'],
    sample: `PLAN @ block 20,920,350  ·  3 actions in 1 transaction: saves 36,893 gas (15.2%); 1 left out.
  a1  IN   0 PROS → 0xb7d5d299…  solo gas 80,751
  a4  FAILS 0 PROS → 0xc879c018…  the call reverted without a reason
  1 transaction instead of 3: estimated gas 243,043 → 206,150

FORK (real EVM, throwaway): one by one used 178,977 gas; the batch used 150,762 gas (success); saved 28,215 (15.8%)
  forcing the failing action into the batch: the WHOLE batch reverts (Multicall3: call failed); no recipient balance changed: yes`,
  },
  verify: [
    { title: 'Check the encoding yourself', text: 'cast encodes a batch of two calls to the same bytes the planner produces for them.', code: 'cast calldata "aggregate3Value((address,bool,uint256,bytes)[])" "[(0x1111111111111111111111111111111111111111,false,1000000000000000,0x),(0x2222222222222222222222222222222222222222,true,2,0xdeadbeef)]"' },
    { title: 'Check a solo cost yourself', text: 'The planner’s “solo gas” for one sync() call.', code: 'cast estimate 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417 "sync()" --from 0x9f8ea09770dc38fc61f5a62031b3be0526d54d92 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Reproduce the real-EVM comparison', text: 'Needs Foundry. Prints actual gas used for both ways and the all-or-nothing revert.', code: 'node skills/pharos-batch-executor/scripts/batch.mjs --from 0x9f8ea09770dc38fc61f5a62031b3be0526d54d92 --actions skills/pharos-batch-executor/examples/sync-pairs.json --fork' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the script and the example action lists are in the repository.', link: [`${REPO}/tree/main/skills/pharos-batch-executor`, 'skills/pharos-batch-executor'] },
  ],
};

export const mount = makePanel({
  intro: 'Describe at least 3 independent actions as JSON and plan the batch. Nothing is sent: the result is a prepared, unsigned transaction.',
  fields: [
    { name: 'from', label: 'From (sender address)', type: 'text', value: FROM, grow: true },
    { name: 'onFailure', label: 'If an action would fail', type: 'select', options: [['exclude', 'Leave it out, batch the rest'], ['abort', 'Prepare nothing']], value: 'exclude' },
    { name: 'actions', label: 'Actions (JSON)', type: 'textarea', rows: 9, wide: true, value: SYNC, hint: '{ "to": "0x…", "amountPros": "0.001", "data": "0x…" }, amount and data optional.' },
  ],
  button: 'Plan the batch',
  examples: [
    { label: 'Sync 3 pools + 1 failing action', values: { from: FROM, onFailure: 'exclude', actions: SYNC } },
    { label: 'Same, but abort on failure', values: { from: FROM, onFailure: 'abort', actions: SYNC } },
    { label: 'Three plain PROS transfers (batch costs more)', values: { from: FROM, onFailure: 'exclude', actions: NATIVE } },
    { label: 'Include an ERC-20 transfer (refused)', values: { from: FROM, onFailure: 'exclude', actions: ERC20 } },
  ],
  title: (v) => `Plan batch (${v.onFailure})`,
  call: (v) => ({ params: { from: v.from, onFailure: v.onFailure, actions: v.actions } }),
  decode: ({ plan: p }) => [
    ...p.actions.map((a) => ({ kind: 'decision', ok: a.status === 'ok', title: `${a.id}: ${a.status === 'ok' ? (a.included ? 'in the batch' : 'passes but left out') : 'would FAIL'}`, detail: a.reason ?? `solo gas ${g(a.soloGas)}` })),
    { kind: 'decision', title: p.summary },
  ],
  summary: ({ plan: p }) => p.summary,
  render: ({ plan: p }) => `
    <div class="verdict ${p.verdict === 'ready' ? (p.comparison?.gasSaved >= 0 ? 'ok' : 'warn') : 'bad'}">${p.verdict === 'ready' ? 'BATCH READY' : p.verdict === 'batch-would-fail' ? 'BATCH WOULD FAIL' : 'NOTHING TO SEND'}<small>${esc(p.summary)} · planned at block ${p.block.toLocaleString('en-US')}</small></div>
    ${table(['Action', 'To', 'Value', 'Alone', 'In batch'], p.actions.map((a) => [`<code>${esc(a.id)}</code>`, `<code>${esc(a.to.slice(0, 10))}…</code>`, `${esc(a.valuePros)} PROS`, a.status === 'ok' ? `${pill('passes', 'ok')} <span class="muted">${g(a.soloGas)} gas</span>` : `${pill('fails', 'bad')}<br><small class="bad">${esc(a.reason)}</small>`, a.included ? pill('in', 'ok') : pill('left out', 'warn')]))}
    ${p.excluded.length ? `<p class="check warn"><b>Left out:</b><br>${p.excluded.map((x) => `${esc(x.id)}: ${esc(x.why)}`).join('<br>')}<br>Nothing was stranded: the batch is all-or-nothing and these were never in it.</p>` : ''}
    ${p.comparison ? `<h4 class="list-h">One transaction instead of ${p.comparison.transactionsBefore}</h4>${table(['Sent one by one', 'As one batch', 'Difference'], [[`${g(p.comparison.soloGasTotal)} gas`, `${g(p.comparison.batchGas)} gas`, `<b class="${p.comparison.gasSaved >= 0 ? 'ok' : 'bad'}">${p.comparison.gasSaved >= 0 ? 'saves' : 'costs'} ${g(Math.abs(p.comparison.gasSaved))} gas (${Math.abs(p.comparison.gasSavedPct).toFixed(1)}%)</b>`]])}${p.comparison.gasSaved < 0 ? '<p class="check warn">These actions are already the cheapest a transaction can be, so batching them costs more gas. Batch them only for convenience (one signature), not to save gas.</p>' : ''}<p class="muted">Estimates from estimate_gas. The real-EVM fork run is in the story above.</p>` : ''}
    ${p.batch?.tx ? `<h4 class="list-h">Prepared transaction (unsigned)</h4><pre class="plain">to    ${esc(p.batch.to)}  (Multicall3)\nvalue ${esc(p.batch.valuePros)} PROS\ncalls ${p.batch.calls}\ndata  ${esc(p.batch.data.slice(0, 90))}…</pre><p class="muted">Nothing was sent. Signing is your step.</p>` : ''}`,
});
