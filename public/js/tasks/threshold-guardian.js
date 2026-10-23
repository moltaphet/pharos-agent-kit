// Threshold Guardian: content and a factory panel.
import { esc } from '../util.js';
import { mountTestnet } from '../panels/testnet.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb';
const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const VAULT = '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268';
const config = (name, gas, move) =>
  JSON.stringify(
    {
      name,
      action: 'prepare the vault rebalance',
      require: 'all',
      conditions: [
        { id: 'gas-is-cheap', type: 'gas-price', op: '<=', threshold: gas },
        { id: 'morpho-has-usdc-liquidity', type: 'token-balance', token: USDC, holder: MORPHO, op: '>=', threshold: 1000 },
        { id: 'vault-share-price-moved', type: 'share-price-change', vault: VAULT, blockWindow: 1500000, op: '>=', threshold: move },
      ],
    },
    null,
    2,
  );
const FIRES = config('rebalance-gate (lenient)', 1000, 0.1);
const HOLDS = config('rebalance-gate (strict)', 1, 5);

export const content = {
  tagline: 'Decide whether to act by checking several live conditions together, and explain the decision condition by condition.',
  tools: ['chain'],
  skill: true,
  story: [
    'Most bots fail the same way: they fire on one noisy signal. A rebalance that is cheap in gas but pointless, or profitable on paper but with no liquidity to execute against. The Threshold Guardian is a Pharos Skill that refuses to act on one reading. It evaluates several independent on-chain conditions together and answers FIRE or HOLD.',
    'You describe the conditions in a JSON config: what to read, how to compare it, and the threshold. Nothing about the decision is hard-coded. A run reads every condition at one pinned block and prints a trace: each condition’s value, its threshold, pass or fail, the rule, and the final decision. It never sends a transaction; acting on a FIRE is a separate, human-approved step.',
    'Below, edit the config and run it. The two chips load a lenient config that fires and a strict one that holds, both against live Pharos mainnet data.',
  ],
  how: [
    { server: 'local', tool: 'parse + validate config', text: 'Reject a bad config with a precise message: unknown type, bad operator, non-numeric threshold, malformed address, fewer than three conditions.' },
    { server: 'chain', tool: 'get_block_number', text: 'Pin every condition to one block so the decision describes one moment.' },
    { server: 'chain', tool: 'get_gas_price · eth_call · get_balance', text: 'Read each condition in parallel: gas in gwei, a token balance via balanceOf, a vault’s share price now and N blocks ago via convertToAssets.' },
    { server: 'local', tool: 'compare', text: 'Apply each operator and threshold. A condition that cannot be read counts as not met: the guardian fails safe.' },
    { server: 'local', tool: 'apply rule', text: 'Count met conditions against the rule (all, any, or at least n) and decide FIRE or HOLD.' },
    { server: 'local', tool: 'trace', text: 'Print one line per condition plus the rule and the decision. The CLI exits 0 for FIRE and 10 for HOLD so scripts can branch on it.' },
  ],
  decisions: [
    { title: 'Fail safe, not fail open', text: 'If a vault does not answer, that condition is marked ERROR and counts as not met. A guardian that fires when it is blind is worse than none.' },
    { title: 'One block for everything', text: 'Conditions are read at the same pinned block, so “gas is cheap and liquidity is high” cannot straddle two different moments.' },
    { title: 'The skill decides; a separate script acts, and only on FIRE', text: 'The skill itself is read-only: on FIRE it reports what would fire and asks, and no key is involved (SKILL.md says so). To show the decision driving a real action, scripts/testnet-guardian.mjs runs the same guardian code against Pharos Atlantic testnet and, only when it decides FIRE, sends the configured action: one real transaction, with the chain asked afterwards whether it happened. On HOLD it sends nothing, and the chain is asked that too. Both runs are in the card above, with the transaction re-read from the chain each time the page loads.' },
    { title: 'A real Pharos Skill, not a script with a README', text: 'SKILL.md has the Capability Index in the user’s own words, the reference follows the Skill Engine template (command, parameters, output parsing, errors, agent guidelines), and the `cast` equivalents in it were run before being written down.' },
    { title: 'Cross-checked by hand', text: 'The share-price change the guardian reported (0.245232%) matches what we computed independently from two `cast` calls at different blocks.' },
  ],
  evidence: [
    'Three independent conditions are read from chain: gas price (get_gas_price), a token balance (eth_call balanceOf), and a vault’s share-price change (eth_call convertToAssets now versus N blocks earlier).',
    'Condition types, operators, thresholds, addresses, the look-back window and the rule are all in the JSON config; edit it above and run again. Nothing is hard-coded.',
    'Every run prints a trace: each condition’s value, threshold and pass/fail, the rule, and the final decision. The same lines are recorded in the run log.',
    'examples/fires.json fires and examples/holds.json holds, both on live data; each is a chip above. The testnet card shows both outcomes acting for real: the FIRE sent a real transaction and the HOLD sent nothing.',
  ],
  files: ['scripts/testnet-guardian.mjs', 'lib/testnet-signer.js', 'reports/testnet-guardian.json', 'skills/pharos-threshold-guardian/SKILL.md', 'skills/pharos-threshold-guardian/references/threshold-guardian.md', 'skills/pharos-threshold-guardian/scripts/guardian.mjs', 'lib/tasks/threshold-guardian.js'],
  run: {
    commands: ['node skills/pharos-threshold-guardian/scripts/guardian.mjs skills/pharos-threshold-guardian/examples/fires.json   # exit 0', 'node skills/pharos-threshold-guardian/scripts/guardian.mjs skills/pharos-threshold-guardian/examples/holds.json   # exit 10'],
    sample: `rebalance-gate (strict: should HOLD)  ·  block 20,917,208

FAIL  gas-is-cheap: 10 gwei <= 1  →  not met
PASS  morpho-has-usdc-liquidity: 1,312,441.56 tokens >= 1,000  →  met
FAIL  vault-share-price-moved-a-lot: 0.245232 % >= 5  →  not met
RULE  all conditions must be met: 1 of 3 met
DECISION  HOLD: 2 more conditions needed before prepare the vault rebalance`,
  },
  verify: [
    { title: 'Open the real transaction the guardian sent', text: 'The FIRE run called ping() on the counter contract on Atlantic testnet; the HOLD run sent nothing.', link: ['https://atlantic.pharosscan.xyz/tx/0x5d8f3f1eba84e9fa488de8714485b39ed160bc514ec36095d42f5b39d1ff09fe', 'The FIRE transaction on the Atlantic explorer'] },
    { title: 'Check gas yourself', text: 'The guardian said 10 gwei. This is the same number straight from the public RPC, in wei.', code: 'cast gas-price --rpc-url https://rpc.pharos.xyz   # 10000000000' },
    { title: 'Check the share-price change yourself', text: 'Two calls at different blocks; divide the first by the second and subtract 1. Over 1,500,000 blocks it was +0.2452%.', code: `H=$(cast block-number --rpc-url https://rpc.pharos.xyz)\ncast call ${VAULT} "convertToAssets(uint256)(uint256)" 1000000 --rpc-url https://rpc.pharos.xyz\ncast call ${VAULT} "convertToAssets(uint256)(uint256)" 1000000 --rpc-url https://rpc.pharos.xyz --block $((H-1500000))` },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the script and both example configs are in the repository.', link: [`${REPO}/tree/main/skills/pharos-threshold-guardian`, 'skills/pharos-threshold-guardian'] },
  ],
};

const tone = (r) => (r.pass ? 'ok' : r.error ? 'warn' : 'bad');

const livePanel = makePanel({
  intro: 'Edit the guardian config (it is plain JSON) and run it against live Pharos mainnet. Nothing is sent on chain.',
  fields: [{ name: 'config', label: 'Guardian config', type: 'textarea', rows: 16, wide: true, value: FIRES, hint: 'Types: gas-price, native-balance, token-balance, share-price-change. Operators: >= > <= < ==. Rule: "all", "any" or { "atLeast": n }.' }],
  button: 'Evaluate the guardian',
  examples: [
    { label: 'Lenient config (should FIRE)', values: { config: FIRES } },
    { label: 'Strict config (should HOLD)', values: { config: HOLDS } },
  ],
  title: () => 'Evaluate guardian',
  call: (v) => ({ params: { config: v.config } }),
  decode: (d) => [
    ...d.results.map((r) => ({ kind: 'decision', ok: r.pass || !r.error, title: `${r.pass ? 'Met' : r.error ? 'Unreadable' : 'Not met'}: ${r.id}`, detail: r.error ?? `${r.detail}; needs ${r.op} ${r.threshold}`, lines: r.value == null ? undefined : [['value read', `${r.value} ${r.unit}`], ['rule', `${r.op} ${r.threshold}`]] })),
    { kind: 'decision', title: `Decision: ${d.decision.toUpperCase()}`, detail: d.trace[d.trace.length - 1] },
  ],
  summary: (d) => `${d.decision.toUpperCase()} · ${d.passed}/${d.total} conditions met · block ${d.block.toLocaleString('en-US')}`,
  render: (d) => `
    <div class="verdict ${d.decision === 'fire' ? 'ok' : 'warn'}">${d.decision === 'fire' ? 'FIRE' : 'HOLD'}<small>${esc(d.name)} · ${d.passed} of ${d.total} conditions met (needs ${d.need}) · read at block ${d.block.toLocaleString('en-US')}</small></div>
    ${table(
      ['Condition', 'Value read', 'Rule', 'Result'],
      d.results.map((r) => [`<code>${esc(r.id)}</code><br><small class="muted">${esc(r.type)}</small>`, r.error ? `<span class="bad">${esc(r.error)}</span>` : `<b>${esc(r.detail)}</b>`, `<code>${esc(r.op)} ${esc(r.threshold)}</code>`, pill(r.pass ? 'met' : r.error ? 'error → not met' : 'not met', tone(r))]),
    )}
    <h4 class="list-h">Decision trace</h4><pre class="plain">${esc(d.trace.join('\n'))}</pre>`,
});

// The recorded real run on Atlantic testnet sits above the live panel, which reads mainnet and only decides.
export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="testnet"></div><div data-slot="live"></div>';
  mountTestnet(root.querySelector('[data-slot=testnet]'), { slug: ctx.slug, kind: 'guardian' });
  return livePanel(root.querySelector('[data-slot=live]'), ctx);
}
