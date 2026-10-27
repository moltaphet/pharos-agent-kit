// On-chain alert engine for Pharos mainnet (chain 1672). Four kinds of condition (a price crossing a threshold on a Chainlink-style feed, a large ERC-20 transfer, a contract event,
// a call to a contract), a scanner over a block range (public RPC; eth_getLogs is limited to 1,000 blocks a call), a formatter (what happened, the value, an explorer link), channels
// (Discord, Telegram, ntfy, a generic webhook, the console) and a cycle that never sends the same event to the same channel twice, and never loses one when a channel is down.

import { formatUnits, isAddress, topicToAddress } from './abi.js';
import { FEEDS, EXPLORER } from './defi.js';
import { keccak256, selectorOf } from './keccak.js';
import { makeLabeler, shortAddress } from './labels.js';
import { parseDecimal, TOKENS } from './payments.js';
import { publicRpc } from './onchain.js';
import { UserError } from './snapshot.js';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const MAX_LOG_RANGE = 1000;
export const MAX_SCAN_BLOCKS = 5000;
export const MAX_CALL_BLOCKS = 300; // call detection reads whole blocks, one request each
export const explorerTx = (hash) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (address) => `${EXPLORER}/address/${address}`;
const LATEST_ROUND_DATA = '0xfeaf968c';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => '0x' + n.toString(16);
const num = (hexString) => Number(BigInt(hexString));
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const tokenByRef = (ref) => {
  const s = String(ref ?? '').trim();
  const bySymbol = TOKENS.find((t) => !t.native && t.symbol === s.toUpperCase());
  if (bySymbol) return bySymbol;
  if (isAddress(s)) return TOKENS.find((t) => t.address === s.toLowerCase()) ?? { symbol: shortAddress(s), address: s.toLowerCase(), decimals: null };
  throw new UserError(`token must be a symbol (${TOKENS.filter((t) => !t.native).map((t) => t.symbol).join(', ')}) or a token contract address`);
};

// ---- conditions ---------------------------------------------------------------------------------------------------------------------------

export function validateConditions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new UserError('conditions must list 1 to 20 alert conditions');
  const ids = new Set();
  return input.map((c, i) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new UserError(`condition ${i + 1} must be an object`);
    const id = String(c.id ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(id) || ids.has(id)) throw new UserError(`condition ${i + 1} needs a unique id (letters, digits, hyphen, underscore)`);
    ids.add(id);
    const label = c.label ? String(c.label).slice(0, 80) : id;
    if (c.type === 'transfer') {
      const token = tokenByRef(c.token);
      if (token.decimals == null) throw new UserError(`condition ${id}: for a token that is not in the registry give "decimals"`);
      const decimals = token.decimals;
      const min = parseDecimal(c.min, decimals, `condition ${id} min`);
      if (min === 0n) throw new UserError(`condition ${id}: min must be above zero`);
      for (const k of ['involving']) if (c[k] != null && !isAddress(c[k])) throw new UserError(`condition ${id}: ${k} must be an address`);
      return { id, label, type: 'transfer', token, min, minText: String(c.min), involving: c.involving ? c.involving.toLowerCase() : null };
    }
    if (c.type === 'price') {
      const feed = Object.hasOwn(FEEDS, c.feed) ? FEEDS[c.feed] : null;
      if (!feed) throw new UserError(`condition ${id}: feed must be one of ${Object.keys(FEEDS).join(', ')}`);
      if (!['above', 'below'].includes(c.op)) throw new UserError(`condition ${id}: op must be "above" or "below"`);
      const threshold = parseDecimal(c.threshold, feed.decimals, `condition ${id} threshold`);
      if (threshold === 0n) throw new UserError(`condition ${id}: threshold must be above zero`);
      return { id, label, type: 'price', feed: c.feed, feedAddress: feed.address, decimals: feed.decimals, op: c.op, threshold, thresholdText: String(c.threshold) };
    }
    if (c.type === 'event') {
      if (!isAddress(c.contract)) throw new UserError(`condition ${id}: contract must be an address`);
      const sig = String(c.signature ?? '');
      if (!/^[A-Za-z_]\w*\([\w\[\](),]*\)$/.test(sig)) throw new UserError(`condition ${id}: signature must look like Transfer(address,address,uint256)`);
      return { id, label, type: 'event', contract: c.contract.toLowerCase(), signature: sig, topic0: eventTopic(sig) };
    }
    if (c.type === 'call') {
      if (!isAddress(c.contract)) throw new UserError(`condition ${id}: contract must be an address`);
      let selector = null;
      if (c.method != null) {
        const m = String(c.method);
        selector = /^0x[0-9a-f]{8}$/i.test(m) ? m.toLowerCase() : /^[A-Za-z_]\w*\([\w\[\](),]*\)$/.test(m) ? selectorOf(m) : null;
        if (!selector) throw new UserError(`condition ${id}: method must be a signature like transfer(address,uint256) or a 4-byte selector`);
      }
      return { id, label, type: 'call', contract: c.contract.toLowerCase(), selector, method: c.method ?? null };
    }
    throw new UserError(`condition ${i + 1}: type must be transfer, price, event or call`);
  });
}

// the topic of an event signature is the full keccak-256, not a selector
const eventTopic = (signature) => '0x' + keccak256(Buffer.from(signature));

// ---- scanning -----------------------------------------------------------------------------------------------------------------------------

async function logsIn(rpc, filter, from, to) {
  const out = [];
  for (let a = from; a <= to; a += MAX_LOG_RANGE) {
    const b = Math.min(a + MAX_LOG_RANGE - 1, to);
    out.push(...await rpc('eth_getLogs', [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }]));
  }
  return out.filter((l) => !l.removed);
}

const readFeed = async (rpc, c, block) => {
  const raw = await rpc('eth_call', [{ to: c.feedAddress, data: LATEST_ROUND_DATA }, hex(block)]);
  if (typeof raw !== 'string' || raw.length < 2 + 64 * 5) throw new Error(`the feed ${c.feed} did not answer latestRoundData at block ${block}`);
  const w = (i) => BigInt('0x' + raw.slice(2 + 64 * i, 2 + 64 * (i + 1)));
  return { answer: BigInt.asIntN(256, w(1)), updatedAt: Number(w(3)) };
};

/**
 * Every event the conditions describe in blocks [from, to]. Price conditions are sampled every `priceStep` blocks and reported on the sample where the
 * condition becomes true (`state.side` remembers the last side, so a price that stays above a threshold is one alert, not one per sample).
 */
export async function scanRange({ rpc: rawRpc = publicRpc, conditions, from, to, state = { side: {} }, priceStep = 100 }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new UserError('from/to must be block numbers with from <= to');
  if (to - from + 1 > MAX_SCAN_BLOCKS) throw new UserError(`a scan covers at most ${group(MAX_SCAN_BLOCKS)} blocks`);
  state.side ??= {};
  const rpc = async (m, p) => { for (let i = 0; ; i++) { try { return await rawRpc(m, p); } catch (err) { if (i >= 2) throw err; await sleep(500 * (i + 1)); } } };
  const events = [];
  for (const c of conditions) {
    if (c.type === 'transfer') {
      for (const l of await logsIn(rpc, { address: c.token.address, topics: [TRANSFER_TOPIC] }, from, to)) {
        if (l.topics.length !== 3) continue; // ERC-721 Transfer has four topics; this is the ERC-20 event
        const value = BigInt(l.data);
        const a = topicToAddress(l.topics[1]);
        const b = topicToAddress(l.topics[2]);
        if (value < c.min) continue;
        if (c.involving && a !== c.involving && b !== c.involving) continue;
        events.push({ key: `${l.transactionHash}:${num(l.logIndex)}`, conditionId: c.id, kind: 'transfer', block: num(l.blockNumber), txHash: l.transactionHash, logIndex: num(l.logIndex), token: c.token, from: a, to: b, value });
      }
    } else if (c.type === 'event') {
      for (const l of await logsIn(rpc, { address: c.contract, topics: [c.topic0] }, from, to)) {
        events.push({ key: `${l.transactionHash}:${num(l.logIndex)}`, conditionId: c.id, kind: 'event', block: num(l.blockNumber), txHash: l.transactionHash, logIndex: num(l.logIndex), contract: c.contract, signature: c.signature });
      }
    } else if (c.type === 'call') {
      if (to - from + 1 > MAX_CALL_BLOCKS) throw new UserError(`call conditions read whole blocks: scan at most ${MAX_CALL_BLOCKS} blocks at a time (use a transfer or event condition for longer ranges)`);
      for (let n = from; n <= to; n++) {
        const block = await rpc('eth_getBlockByNumber', [hex(n), true]);
        for (const tx of block?.transactions ?? []) {
          if (tx.to?.toLowerCase() !== c.contract || (c.selector && !tx.input.toLowerCase().startsWith(c.selector))) continue;
          events.push({ key: `${tx.hash}:call`, conditionId: c.id, kind: 'call', block: n, txHash: tx.hash, contract: c.contract, from: tx.from.toLowerCase(), selector: tx.input.slice(0, 10), value: BigInt(tx.value ?? 0), method: c.method });
        }
      }
    } else if (c.type === 'price') {
      let lastUpdated = 0;
      for (let n = from; n <= to; n += priceStep) {
        const isMet = (r) => (c.op === 'above' ? r.answer > c.threshold : r.answer < c.threshold);
        // a feed's updatedAt never goes back; a reading older than an earlier sample came from a node with stale state, so it is read again and, if still old, skipped
        let { answer, updatedAt } = await readFeed(rpc, c, n);
        for (let k = 0; k < 3 && updatedAt < lastUpdated; k++) ({ answer, updatedAt } = await readFeed(rpc, c, n));
        if (updatedAt < lastUpdated) continue;
        lastUpdated = updatedAt;
        let met = isMet({ answer });
        // the public RPC is load-balanced and has once answered from a node with other state: a change of side is accepted only when a second read agrees
        if (state.side[c.id] != null && met !== (state.side[c.id] === 'met')) {
          const again = await readFeed(rpc, c, n);
          if (isMet(again) !== met) continue;
        }
        const side = met ? 'met' : 'not-met';
        if (met && state.side[c.id] !== 'met') events.push({ key: `price:${c.id}:${updatedAt}`, conditionId: c.id, kind: 'price', block: n, txHash: null, feed: c.feed, feedAddress: c.feedAddress, answer, decimals: c.decimals, op: c.op, threshold: c.threshold, updatedAt });
        state.side[c.id] = side;
      }
    }
  }
  const unique = [...new Map(events.map((e) => [`${e.conditionId}|${e.key}`, e])).values()];
  return unique.sort((x, y) => x.block - y.block || (x.logIndex ?? 0) - (y.logIndex ?? 0));
}

// ---- messages -----------------------------------------------------------------------------------------------------------------------------

const price = (raw, decimals) => formatUnits(raw, decimals, 6);

export function formatAlert(ev, conditions, { labels = {} } = {}) {
  const c = conditions.find((x) => x.id === ev.conditionId);
  const label = makeLabeler(labels);
  const who = (a) => (label(a) ? `${label(a)} · ${shortAddress(a)}` : shortAddress(a));
  let title; let what; let value; let link;
  if (ev.kind === 'transfer') {
    const amount = `${formatUnits(ev.value, ev.token.decimals ?? 18)} ${ev.token.symbol}`;
    title = `Large ${ev.token.symbol} transfer`;
    what = `${amount} moved from ${who(ev.from)} to ${who(ev.to)}`;
    value = `${amount} (alert threshold ${c.minText} ${ev.token.symbol})`;
    link = explorerTx(ev.txHash);
  } else if (ev.kind === 'price') {
    title = `${ev.feed} is ${ev.op} ${price(ev.threshold, ev.decimals)}`;
    what = `${ev.feed} reads ${price(ev.answer, ev.decimals)}, ${ev.op} your threshold of ${price(ev.threshold, ev.decimals)}`;
    value = `${price(ev.answer, ev.decimals)} USD (feed updated ${new Date(ev.updatedAt * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')})`;
    link = explorerAddress(ev.feedAddress);
  } else if (ev.kind === 'event') {
    title = `${ev.signature.split('(')[0]} emitted`;
    what = `${who(ev.contract)} emitted ${ev.signature}`;
    value = ev.signature;
    link = explorerTx(ev.txHash);
  } else {
    title = `Call to ${who(ev.contract)}`;
    what = `${who(ev.from)} called ${ev.method ?? ev.selector} on ${who(ev.contract)}`;
    value = ev.value > 0n ? `${formatUnits(ev.value, 18)} PROS sent with the call` : 'no PROS sent with the call';
    link = explorerTx(ev.txHash);
  }
  const text = [`🔔 ${title}`, `What: ${what}`, `Value: ${value}`, `Block: ${group(ev.block)}`, `Link: ${link}`, `Alert: ${c?.label ?? ev.conditionId}`].join('\n');
  return { title, what, value, block: ev.block, link, key: ev.key, conditionId: ev.conditionId, text };
}

// ---- channels -----------------------------------------------------------------------------------------------------------------------------

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/;
function safeUrl(text, what) {
  let u;
  try { u = new URL(text); } catch { throw new UserError(`${what} must be an absolute URL`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.test(u.hostname))) throw new UserError(`${what} must be https (plain http only for localhost)`);
  if (u.username || u.password) throw new UserError(`${what} must not carry credentials in the URL`);
  return u;
}
// a secret in a URL or token never reaches a log or an error message
const scrub = (text, secrets) => secrets.reduce((t, s) => (s ? t.split(s).join('«secret»') : t), String(text));

async function post(fetchImpl, url, init, secrets, { retries = 2 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), ...init });
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      if (res.status !== 429 && res.status < 500) break;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 0.5 * (attempt + 1), 5);
      await sleep(wait * 1000);
    } catch (err) {
      last = { ok: false, status: null, error: scrub(err.message, secrets) };
      await sleep(300 * (attempt + 1));
    }
  }
  return last;
}

/** A channel is { id, type, send(alert) → { ok, status?, error? } }. Secrets stay inside the closure. */
export function makeChannel(spec, { fetchImpl = fetch, log = console.log } = {}) {
  switch (spec?.type) {
    case 'discord': {
      const url = safeUrl(spec.webhookUrl, 'discord webhookUrl');
      return { id: spec.id ?? 'discord', type: 'discord', send: (a) => post(fetchImpl, url.href, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: a.text.slice(0, 1900), allowed_mentions: { parse: [] } }) }, [url.href, url.pathname]) };
    }
    case 'telegram': {
      if (!/^\d{3,12}:[\w-]{20,}$/.test(spec.token ?? '')) throw new UserError('telegram token must be a bot token like 123456:ABC…');
      if (!/^(-?\d{1,20}|@[A-Za-z]\w{4,31})$/.test(String(spec.chatId ?? ''))) throw new UserError('telegram chatId must be a numeric chat id or @channelname');
      return { id: spec.id ?? 'telegram', type: 'telegram', send: (a) => post(fetchImpl, `https://api.telegram.org/bot${spec.token}/sendMessage`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: spec.chatId, text: a.text.slice(0, 4000), disable_web_page_preview: true }) }, [spec.token]) };
    }
    case 'ntfy': {
      const url = safeUrl(spec.url, 'ntfy url');
      return { id: spec.id ?? 'ntfy', type: 'ntfy', send: (a) => post(fetchImpl, url.href, { headers: { Title: a.title.replace(/[^\x20-\x7e]/g, ''), Click: a.link, Tags: 'bell' }, body: a.text }, [url.href]) };
    }
    case 'webhook': {
      const url = safeUrl(spec.url, 'webhook url');
      return { id: spec.id ?? 'webhook', type: 'webhook', send: (a) => post(fetchImpl, url.href, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: a.title, what: a.what, value: a.value, block: a.block, link: a.link, key: a.key, condition: a.conditionId, text: a.text }) }, [url.href]) };
    }
    case 'console':
      return { id: spec.id ?? 'console', type: 'console', send: async (a) => { log(a.text + '\n'); return { ok: true, status: null }; } };
    default:
      throw new UserError('channel type must be discord, telegram, ntfy, webhook or console');
  }
}

export function channelsFromEnv(env = process.env, opts = {}) {
  const specs = [];
  if (env.DISCORD_WEBHOOK_URL) specs.push({ type: 'discord', webhookUrl: env.DISCORD_WEBHOOK_URL });
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) specs.push({ type: 'telegram', token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID });
  if (env.NTFY_URL) specs.push({ type: 'ntfy', url: env.NTFY_URL });
  if (env.ALERT_WEBHOOK_URL) specs.push({ type: 'webhook', url: env.ALERT_WEBHOOK_URL });
  return specs.map((s) => makeChannel(s, opts));
}

// ---- the cycle ----------------------------------------------------------------------------------------------------------------------------

export const newState = () => ({ cursor: null, seen: {}, side: {} });
const KEEP_SEEN = 5000;

/**
 * One poll: read the new blocks, find the events, send each one to each channel it has not been sent to, remember what was sent.
 * The cursor moves forward only when every delivery of the window succeeded, so a channel that is down loses nothing; the `seen` ledger
 * (event key + channel) means the retry sends only what failed.
 */
export async function runCycle({ rpc = publicRpc, conditions, channels, state, head = null, lookback = 1000, maxBlocks = 3000, confirmations = 2, labels = {}, priceStep = 100 }) {
  if (!Array.isArray(channels) || channels.length === 0) throw new UserError('at least one channel is required');
  state.seen ??= {};
  state.side ??= {};
  const tip = (head ?? num(await rpc('eth_blockNumber', []))) - confirmations;
  const hasCall = conditions.some((c) => c.type === 'call');
  const cap = hasCall ? Math.min(maxBlocks, MAX_CALL_BLOCKS) : Math.min(maxBlocks, MAX_SCAN_BLOCKS);
  const from = state.cursor == null ? Math.max(0, tip - lookback + 1) : state.cursor + 1;
  if (from > tip) return { from, to: tip, head: tip, found: 0, delivered: [], duplicates: 0, failed: [], cursor: state.cursor, alerts: [] };
  const to = Math.min(tip, from + cap - 1);
  const sideBefore = JSON.parse(JSON.stringify(state.side));
  const events = await scanRange({ rpc, conditions, from, to, state, priceStep });
  const delivered = []; const failed = []; let duplicates = 0;
  const alerts = [];
  for (const ev of events) {
    const alert = formatAlert(ev, conditions, { labels });
    alerts.push(alert);
    for (const ch of channels) {
      const mark = `${ev.key}@${ch.id}`;
      if (state.seen[mark] != null) { duplicates++; continue; }
      const r = await ch.send(alert);
      if (r.ok) { state.seen[mark] = ev.block; delivered.push({ key: ev.key, channel: ch.id, status: r.status ?? null, block: ev.block }); }
      else failed.push({ key: ev.key, channel: ch.id, error: r.error });
    }
  }
  if (failed.length === 0) state.cursor = to;
  else state.side = sideBefore; // a price crossing whose alert failed is found again next time
  const marks = Object.entries(state.seen);
  if (marks.length > KEEP_SEEN) state.seen = Object.fromEntries(marks.sort((a, b) => b[1] - a[1]).slice(0, KEEP_SEEN));
  return { from, to, head: tip, found: events.length, delivered, duplicates, failed, cursor: state.cursor, alerts };
}
