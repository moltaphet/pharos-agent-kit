// Dry-Run Executor: content and a factory panel with presets.
import { esc } from '../util.js';
import { mountTestnet } from '../panels/testnet.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const EMPTY = '0x0000000000000000000000000000000000000001';
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const a = (x) => x.replace('0x', '').toLowerCase().padStart(64, '0');
const transfer = (to, amount) => `0xa9059cbb${a(to)}${w(amount)}`;
const approve = (spender, amount) => `0x095ea7b3${a(spender)}${w(amount)}`;

export const content = {
  tagline: 'Know what a transaction will do, and what it will cost, before it is sent. Block it automatically if it would fail.',
  tools: ['chain'],
  skill: true,
  story: [
    'Sending a transaction that reverts still costs gas, and sending one that does the wrong thing can cost much more. The Dry-Run Executor is a Pharos Skill that answers three questions first: will it succeed, what will it cost, and what will change.',
    'It simulates the call on the live chain with eth_call and estimate_gas at one block. A revert is decoded into plain words (a revert string, a panic code, or a known custom error with its arguments). For token transfers, approvals and native value it also reads the balances and shows each one before and after. And there is a gate: if the simulation fails, the transaction is never handed to an executor.',
    'To check the predictions against reality, the skill can also run the transaction on a throwaway local fork of Pharos mainnet. In the recorded run, a 1 USDC transfer was predicted to move a balance from 1,242,441.562141 to 1,242,440.562141 USDC, and executing it on the fork produced exactly that change.',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number', text: 'Pin the whole simulation to one block.' },
    { server: 'chain', tool: 'eth_call', text: 'Run the call without broadcasting it. A revert comes back with its raw bytes.' },
    { server: 'chain', tool: 'estimate_gas · get_gas_price', text: 'Estimate the gas units and multiply by the live gas price for the cost; suggest a limit 20% above the estimate.' },
    { server: 'local', tool: 'decode the revert', text: 'Error(string), Panic(code), or a known custom error with its arguments; otherwise say it reverted without a reason.' },
    { server: 'chain', tool: 'eth_call · get_balance', text: 'For transfers, approvals and native value, read balances or allowance before, and compute the after.' },
    { server: 'local', tool: 'gate', text: 'Return GO or BLOCKED. Only GO may reach an executor; BLOCKED returns without ever calling send.' },
  ],
  decisions: [
    { title: 'Real transactions on a real testnet, not only a fork', text: 'The recorded run on Pharos Atlantic testnet (the card above the live panel) simulates three transactions and then does what the verdict says: the passing transfer is really sent and its gas matches the estimate, the unaffordable transfer is never sent, and the blocked ERC-20 transfer is sent once anyway, with a fixed gas limit, to prove the prediction. It really reverted. The page re-reads all of it from the chain every time it loads, so you are not asked to trust our file.' },
    { title: 'A bug the real run found: a call to an address with no code can never fail', text: 'While testing batches on the testnet we planned a call to a contract deployed a moment earlier. The simulation said GO, because a call with data to an address without code is just a value transfer: it cannot revert. The planners pin to a block two behind the head, which did not have the contract yet, so the “success” meant nothing. Now a call with data to an address that has no code at the pinned block is BLOCKED with an explanation (a wrong address, or a contract deployed in the last few blocks), in this skill and in the Batch Executor. A plain value transfer to such an account is still allowed.' },
    { title: 'A network failure is not a revert', text: 'Only a node reply that carries revert data counts as a failed simulation. A timeout is reported as an error to retry, never as “the transaction would fail”.' },
    { title: 'Either tool failing blocks it', text: 'eth_call and estimate_gas are both checked. If the call passes but gas estimation reverts, the transaction is still blocked.' },
    { title: 'Predict what we can prove', text: 'Transfers, approvals and native value have an exact after-state. For any other call the page says a state diff cannot be predicted from the call data, and points to the fork run.' },
    { title: 'The gate is tested', text: 'Unit tests assert that after a failed simulation the executor’s send is never called, and that a passing simulation reaches it exactly once.' },
    { title: 'The estimate is not a guarantee', text: 'For the simple token transfer the recorded run estimated 58,353 gas and used 44,843, so the estimate was generous. For a nested call it can be too tight: in the Saga Executor’s real-EVM run a vault withdrawal ran out of gas on a limit that had been estimated exactly. That is why this report also gives a suggested limit 20% above the estimate. Send with at least that.' },
    { title: 'No key, ever', text: 'A simulation needs only the sender’s address. The skill ships no signer; on a fork the sender is impersonated, which only exists locally. The testnet card on this page comes from a separate script (scripts/testnet-run.mjs) that signs with a throwaway Atlantic wallet holding test tokens only; the skill never sees that key.' },
  ],
  evidence: [
    'Uses eth_call and estimate_gas on the live chain at a pinned block to simulate the transaction without broadcasting it.',
    'Reports predicted success or revert, including the decoded revert reason (string, panic, or known custom error), and the estimated gas and its cost in PROS.',
    'Shows the expected before/after for ERC-20 transfers, approvals and native value; the real testnet run and the fork run produce the actual outcome to compare against.',
    'The gate blocks execution automatically when the simulation fails: the executor’s send is never called (unit-tested), and the CLI prints “EXECUTION BLOCKED”.',
  ],
  files: ['scripts/testnet-run.mjs', 'lib/rpc-chain.js', 'lib/testnet-report.js', 'reports/testnet-runs.json', 'skills/pharos-dry-run-executor/SKILL.md', 'skills/pharos-dry-run-executor/references/dry-run-executor.md', 'skills/pharos-dry-run-executor/scripts/dryrun.mjs', 'lib/tasks/dry-run-executor.js', 'lib/revert.js'],
  run: {
    commands: [`node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from ${MORPHO} --to ${USDC} --data $(cast calldata "transfer(address,uint256)" ${DEAD} 1000000)`, '… --fork --execute --watch ' + USDC + '   # really executes on a local fork and prints the real diff', `node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from ${EMPTY} --to ${USDC} --data <same calldata> --execute   # BLOCKED`],
    sample: `DRY RUN  ·  block 20,918,943  ·  GO
  The simulation succeeded: the transaction would go through.
  gas: 58,353 units (suggest a limit of 70,024) at 10 gwei = 0.00058353 PROS
  outcome: Move 1 USDC from 0x1857…4efb to 0x0000…dead
    0x1857…4efb USDC: 1,242,441.562141 USDC  →  1,242,440.562141 USDC

  EXECUTED on the local fork: 0xa166bd2b…  (success, gas used 44843)
    fork state diff 0xc879c0…: 1242441562141 → 1242440562141 (-1000000)`,
  },
  verify: [
    { title: 'Open the real transactions', text: 'Every hash on the testnet card links to the Atlantic explorer. The sender is a throwaway wallet that only ever holds test tokens.', link: ['https://atlantic.pharosscan.xyz/address/0x0eC197b8A30543c93e521a6C3F2DB5d110e60850', 'Sender on the Atlantic explorer'] },
    { title: 'Re-run it with your own key', text: 'Needs Foundry and a funded Atlantic testnet key in .wallet/atlantic-testnet.json. Without --live it rehearses on a free local fork of Atlantic.', code: 'node scripts/testnet-run.mjs --live' },
    { title: 'Simulate it yourself', text: 'The same simulation straight from the public RPC. A reverting call prints the revert reason.', code: `cast call ${USDC} "transfer(address,uint256)(bool)" ${DEAD} 1000000 --from ${EMPTY} --rpc-url https://rpc.pharos.xyz   # reverts: ERC20: transfer amount exceeds balance` },
    { title: 'Estimate the gas yourself', text: 'Compare with the page’s estimate for the passing transfer.', code: `cast estimate ${USDC} "transfer(address,uint256)" ${DEAD} 1000000 --from ${MORPHO} --rpc-url https://rpc.pharos.xyz` },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference and the script are in the repository.', link: [`${REPO}/tree/main/skills/pharos-dry-run-executor`, 'skills/pharos-dry-run-executor'] },
  ],
};

const PRESETS = {
  ok: { label: 'Transfer 1 USDC from a holder (passes)', v: { from: MORPHO, to: USDC, data: transfer(DEAD, 1_000_000), value: '0' } },
  empty: { label: 'Transfer 1 USDC from an empty account (reverts)', v: { from: EMPTY, to: USDC, data: transfer(DEAD, 1_000_000), value: '0' } },
  approve: { label: 'Approve 5 USDC (predicts the allowance)', v: { from: MORPHO, to: USDC, data: approve(DEAD, 5_000_000), value: '0' } },
  unknown: { label: 'Call a function that does not exist (reverts, no reason)', v: { from: MORPHO, to: USDC, data: '0xdeadbeef', value: '0' } },
  native: { label: 'Send 0.001 PROS to a token contract (reverts)', v: { from: '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92', to: USDC, data: '0x', value: '1000000000000000' } },
};

const livePanel = makePanel({
  intro: 'Describe a transaction (sender, target, calldata, value) or load an example. Nothing is sent: it is simulated on the live chain.',
  fields: [
    { name: 'from', label: 'From (sender address)', type: 'text', value: PRESETS.ok.v.from, grow: true },
    { name: 'to', label: 'To', type: 'text', value: PRESETS.ok.v.to, grow: true },
    { name: 'data', label: 'Calldata', type: 'textarea', rows: 3, wide: true, value: PRESETS.ok.v.data, hint: 'Hex. Build it with: cast calldata "transfer(address,uint256)" <to> <amount>' },
    { name: 'value', label: 'Value (wei)', type: 'text', value: '0' },
  ],
  button: 'Dry-run it',
  examples: Object.values(PRESETS).map((p) => ({ label: p.label, values: p.v })),
  title: (v) => `Dry-run ${v.data.slice(0, 10)} → ${v.to.slice(0, 8)}…`,
  call: (v) => ({ params: { from: v.from, to: v.to, data: v.data, value: v.value } }),
  decode: ({ report: r }) => [
    { kind: 'decision', ok: r.verdict === 'go', title: `Simulation: ${r.prediction.toUpperCase()}`, detail: r.summary, lines: r.revert ? [['revert kind', r.revert.kind], ['decoded', r.revert.message], ['raw data', r.revert.raw.slice(0, 74) + (r.revert.raw.length > 74 ? '…' : '')]] : [['return data', r.returnData ?? '0x']] },
    ...(r.gas ? [{ kind: 'decision', title: `Gas: ${r.gas.units.toLocaleString('en-US')} units = ${r.gas.costPros} PROS`, lines: [['suggested limit (+20%)', r.gas.suggestedLimit.toLocaleString('en-US')], ['gas price', `${r.gas.priceGwei} gwei`]] }] : []),
    { kind: 'decision', ok: r.verdict === 'go', title: `Gate: ${r.verdict === 'go' ? 'GO, may reach an executor' : 'BLOCKED, never reaches an executor'}` },
  ],
  verdict: ({ report: r }) => (r.verdict === 'go' ? 'ok' : 'ok'),
  summary: ({ report: r }) => `${r.verdict.toUpperCase()}${r.gas ? ` · ${r.gas.units.toLocaleString('en-US')} gas` : ''}`,
  render: ({ report: r }) => `
    <div class="verdict ${r.verdict === 'go' ? 'ok' : 'bad'}">${r.verdict === 'go' ? 'GO' : 'BLOCKED'}<small>${esc(r.summary)} · simulated at block ${r.block.toLocaleString('en-US')}</small></div>
    ${r.revert ? `<div class="card"><h4>Why it would fail</h4><p><b>${esc(r.revert.message)}</b></p><p class="muted">Kind: ${esc(r.revert.kind)}${r.revert.name ? ` · ${esc(r.revert.name)}` : ''}${r.revert.raw !== '0x' ? ` · raw <code>${esc(r.revert.raw.slice(0, 66))}${r.revert.raw.length > 66 ? '…' : ''}</code>` : ''}</p></div>` : ''}
    ${r.gas ? `<h4 class="list-h">Cost</h4>${table(['Gas units', 'Suggested limit (+20%)', 'Gas price', 'Cost'], [[r.gas.units.toLocaleString('en-US'), r.gas.suggestedLimit.toLocaleString('en-US'), `${r.gas.priceGwei} gwei`, `<b>${esc(r.gas.costPros)} PROS</b>`]])}` : '<p class="muted">No gas estimate: the call would revert.</p>'}
    <h4 class="list-h">What would change</h4>
    <p>${esc(r.outcome.summary)}</p>
    ${r.outcome.rows.length ? table(['What', 'Before', 'After'], r.outcome.rows.map((x) => [esc(x.label), esc(x.before), `<b>${esc(x.after)}</b>`])) : ''}
    <p class="check ${r.verdict === 'go' ? 'ok' : 'bad'}"><b>Execution gate:</b> ${r.verdict === 'go' ? 'open. This transaction may be handed to an executor. (Here there is none: Chain MCP is read-only and no key is held.)' : 'closed. Nothing was sent, and nothing will be sent.'}</p>
    <p class="muted">A passing simulation is a prediction about the chain right now; state can change before a transaction is mined.</p>`,
});

// The recorded real run on Atlantic testnet sits above the live panel, which reads mainnet.
export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="testnet"></div><div data-slot="live"></div>';
  mountTestnet(root.querySelector('[data-slot=testnet]'), { slug: ctx.slug, kind: 'dry-run' });
  return livePanel(root.querySelector('[data-slot=live]'), ctx);
}
