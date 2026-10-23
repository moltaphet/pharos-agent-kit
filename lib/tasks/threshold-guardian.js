// Task: Threshold Guardian (Skill).
//
// Reads several independent on-chain conditions, compares each with a configurable
// threshold, and decides whether to FIRE the action or HOLD. It never executes anything:
// the decision (and its trace) is the product. A condition that cannot be read counts as
// not met, so the guardian fails safe.

import { optionalCall, pinnedBlock } from '../chain.js';
import { SELECTORS, decodeUint, encodeAddress, formatUnits, isAddress } from '../abi.js';
import { UserError } from '../snapshot.js';
import { stableRead } from '../stable.js';
import { testnetEvidence } from '../testnet-report.js';

const OPS = { '>=': (a, b) => a >= b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '<': (a, b) => a < b, '==': (a, b) => a === b };
const SELECTOR_CONVERT = '0x07a2d13a'; // convertToAssets(uint256)

const toNumber = (raw, decimals) => Number(formatUnits(raw, decimals, 18).replace(/,/g, ''));
const decimalsOf = async (chain, token, block) => {
  const raw = await optionalCall(chain, token, SELECTORS.decimals, block, 'decimals() of the token');
  return raw ? Number(decodeUint(raw)) : 18;
};

// Each reader returns { value, unit, detail } for one condition at one pinned block.
export const READERS = {
  'gas-price': {
    help: 'Current gas price in gwei.',
    async read({ chain }) {
      const g = await chain.callTool('get_gas_price', {}, { why: 'Condition: current gas price' });
      return { value: Number(g.gasPriceGwei), unit: 'gwei', detail: `${g.gasPriceGwei} gwei` };
    },
  },
  'native-balance': {
    help: 'PROS balance of an address (params: address).',
    needs: ['address'],
    async read({ chain }, c, block) {
      const b = await chain.callTool('get_balance', { address: c.address, block }, { why: `Condition: PROS balance of ${c.address.slice(0, 8)}…` });
      return { value: Number(b.balance), unit: 'PROS', detail: `${b.balance} PROS` };
    },
  },
  'token-balance': {
    help: 'ERC-20 balance of a holder, in token units (params: token, holder).',
    needs: ['token', 'holder'],
    async read({ chain }, c, block) {
      const [raw, decimals] = await Promise.all([
        optionalCall(chain, c.token, SELECTORS.balanceOf + encodeAddress(c.holder), block, `Condition: balanceOf(${c.holder.slice(0, 8)}…) on the token`),
        decimalsOf(chain, c.token, block),
      ]);
      if (raw == null) throw new Error('the token returned no balance');
      return { value: toNumber(decodeUint(raw), decimals), unit: 'tokens', detail: `${formatUnits(decodeUint(raw), decimals)} tokens` };
    },
  },
  'share-price-change': {
    help: 'Percent change of an ERC-4626 vault’s share price over a block window (params: vault, blockWindow).',
    needs: ['vault'],
    async read({ chain }, c, block) {
      const window = c.blockWindow ?? 100_000;
      const decimals = await decimalsOf(chain, c.vault, block);
      const unit = 10n ** BigInt(decimals);
      const call = (b) => optionalCall(chain, c.vault, SELECTOR_CONVERT + unit.toString(16).padStart(64, '0'), b, `Condition: vault share price at block ${b.toLocaleString('en-US')}`);
      // Sequential and confirmed: concurrent reads of different past blocks can return the wrong block's value.
      const confirmed = async (b) => (await stableRead(async () => String(await call(b)), { label: `vault share price at block ${b}` })).value;
      const now = await confirmed(block);
      const then = await confirmed(Math.max(0, block - window));
      if (now === 'null' || then === 'null') throw new Error('vault did not answer convertToAssets()');
      const a = Number(decodeUint(now));
      const b = Number(decodeUint(then));
      const pct = (a / b - 1) * 100;
      return { value: pct, unit: '%', detail: `${(a / 10 ** decimals).toFixed(6)} now vs ${(b / 10 ** decimals).toFixed(6)} ${window.toLocaleString('en-US')} blocks ago` };
    },
  },
};

// Validates and normalises a config so a bad one fails with a precise message.
export function parseConfig(input) {
  const c = typeof input === 'string' ? JSON.parse(input) : input;
  if (!c || typeof c !== 'object') throw new UserError('config must be a JSON object');
  if (!Array.isArray(c.conditions) || c.conditions.length === 0) throw new UserError('config.conditions must list at least one condition');
  const ids = new Set();
  const conditions = c.conditions.map((x, i) => {
    const where = `condition ${i + 1}${x?.id ? ` (${x.id})` : ''}`;
    if (!READERS[x?.type]) throw new UserError(`${where}: unknown type "${x?.type}". Known types: ${Object.keys(READERS).join(', ')}`);
    if (!OPS[x.op]) throw new UserError(`${where}: op must be one of ${Object.keys(OPS).join(' ')}`);
    if (typeof x.threshold !== 'number' || !Number.isFinite(x.threshold)) throw new UserError(`${where}: threshold must be a number`);
    for (const need of READERS[x.type].needs ?? []) if (!isAddress(x[need])) throw new UserError(`${where}: "${need}" must be a 0x address`);
    const id = x.id ?? `${x.type}-${i + 1}`;
    if (ids.has(id)) throw new UserError(`${where}: duplicate id "${id}"`);
    ids.add(id);
    return { ...x, id };
  });
  const rule = c.require ?? 'all';
  const need = rule === 'all' ? conditions.length : rule === 'any' ? 1 : Number.isInteger(rule?.atLeast) ? rule.atLeast : null;
  if (need == null || need < 1 || need > conditions.length) throw new UserError('config.require must be "all", "any", or { "atLeast": n } with 1 ≤ n ≤ number of conditions');
  if (conditions.length < 3 && c.allowFewConditions !== true) throw new UserError('a guardian needs at least 3 independent conditions (set allowFewConditions to override)');
  return { name: c.name ?? 'guardian', action: c.action ?? 'the configured action', conditions, rule, need };
}

const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(6))));

export async function evaluate({ chain }, configInput) {
  const config = parseConfig(configInput);
  const block = await pinnedBlock(chain, 'Pin every condition to one block (just behind the latest, which every backend node has)');
  const results = await Promise.all(
    config.conditions.map(async (c) => {
      const base = { id: c.id, type: c.type, op: c.op, threshold: c.threshold };
      try {
        const r = await READERS[c.type].read({ chain }, c, block);
        return { ...base, value: r.value, unit: r.unit, detail: r.detail, pass: OPS[c.op](r.value, c.threshold) };
      } catch (err) {
        return { ...base, value: null, error: err.message, pass: false }; // fail safe
      }
    }),
  );
  const passed = results.filter((r) => r.pass).length;
  const decision = passed >= config.need ? 'fire' : 'hold';
  const trace = [
    ...results.map((r) => `${r.pass ? 'PASS' : r.error ? 'ERROR' : 'FAIL'}  ${r.id}: ${r.error ? `could not be read (${r.error})` : `${fmt(r.value)} ${r.unit}`} ${r.op} ${fmt(r.threshold)}  →  ${r.pass ? 'met' : 'not met'}`),
    `RULE  ${config.rule === 'all' ? 'all conditions' : config.rule === 'any' ? 'any condition' : `at least ${config.need} conditions`} must be met: ${passed} of ${results.length} met`,
    decision === 'fire' ? `DECISION  FIRE: ${config.action}` : `DECISION  HOLD: ${config.need - passed} more condition${config.need - passed === 1 ? '' : 's'} needed before ${config.action}`,
  ];
  return { name: config.name, block, rule: config.rule, need: config.need, passed, total: results.length, decision, action: config.action, results, trace };
}

export default async function run({ q, chain }) {
  if (q.real === 'testnet') return { testnet: await testnetEvidence({ name: 'testnet-guardian.json' }) };
  if (q.config === undefined) throw new UserError('pass a JSON config in the "config" parameter');
  let config;
  try {
    config = JSON.parse(q.config);
  } catch (err) {
    throw new UserError(`config is not valid JSON: ${err.message}`);
  }
  return evaluate({ chain }, config);
}
