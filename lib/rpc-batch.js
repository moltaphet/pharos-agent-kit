// JSON-RPC batches against a public RPC: many requests in one HTTP call (the Pharos RPCs answer 100 at a time). Each answer is { ok, result } or { ok: false, error },
// in the order of the requests, so one bad request never hides the others. A dropped connection or a rate-limit answer retries the whole chunk.

import { PHAROS_RPC } from './rpc.js';
import { limiter } from './limit.js';

const slot = limiter(4); // one batch at a time: the public RPC counts every request in a batch against its rate limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const BATCH_SIZE = 40;
const RATE = /cu limit|too fast|rate limit|too many requests|429/i;

async function postChunk(url, chunk, timeoutMs, tries = 7) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json' }, body: JSON.stringify(chunk.map((r, i) => ({ jsonrpc: '2.0', id: i, method: r.method, params: r.params ?? [] }))) });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { wait: Math.min(Number(res.headers.get('retry-after')) || 2 * (attempt + 1), 12) * 1000 });
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error(body?.error?.message ?? 'the RPC did not answer a batch with an array');
      const byId = new Map(body.map((x) => [x.id, x]));
      const answers = chunk.map((_, i) => byId.get(i));
      // a whole-chunk rate limit comes back as errors on every item
      if (answers.every((a) => a?.error && RATE.test(a.error.message ?? ''))) throw new Error(answers[0].error.message);
      return answers.map((a) => (a && a.error == null && 'result' in a ? { ok: true, result: a.result } : { ok: false, error: a?.error?.message ?? 'no answer for this request' }));
    } catch (err) { last = err; await sleep(err.wait ?? 600 * (attempt + 1)); }
  }
  throw new Error(`batch failed after ${tries} ${tries === 1 ? 'try' : 'tries'}: ${last?.message}`);
}

/** requests: [{ method, params }] → [{ ok, result } | { ok: false, error }] */
export async function batchRpc(requests, { url = PHAROS_RPC, size = BATCH_SIZE, timeoutMs = 30_000, concurrency = 1, tries = 7 } = {}) {
  const chunks = [];
  for (let i = 0; i < requests.length; i += size) chunks.push(requests.slice(i, i + size));
  const out = new Array(chunks.length);
  let next = 0;
  // `concurrency` batches at a time (one by default: every request in a batch counts against the node's rate limit)
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, async () => { for (let i = next++; i < chunks.length; i = next++) out[i] = await slot(() => postChunk(url, chunks[i], timeoutMs, tries)); }));
  return out.flat();
}

/** Like batchRpc, but throws on the first failed item (for reads that must all succeed). */
export async function batchRpcStrict(requests, opts) {
  const rows = await batchRpc(requests, opts);
  const bad = rows.findIndex((r) => !r.ok);
  if (bad >= 0) throw new Error(`${requests[bad].method} failed: ${rows[bad].error}`);
  return rows.map((r) => r.result);
}
