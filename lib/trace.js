// Per-request trace of everything that talks to the outside world (MCP calls,
// RPC calls, retries). The web API turns on a trace for each request using
// AsyncLocalStorage, so concurrent requests never mix their entries; the CLIs
// never start one, so recording is a no-op there.

import { AsyncLocalStorage } from 'node:async_hooks';

export const traceStore = new AsyncLocalStorage();

export const startTrace = () => ({ t0: performance.now(), entries: [], sessions: new Set() });

// `start` is performance.now() when the operation began; it becomes `at`, the
// offset in ms from the start of the request.
export function record({ start, ...entry }) {
  const store = traceStore.getStore();
  if (!store) return;
  store.entries.push({ ...entry, at: Math.round((start ?? performance.now()) - store.t0) });
}

// Pretty-print JSON when we can, and cap the size so a trace stays small.
export function preview(value, max = 3000) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(JSON.parse(value), null, 1);
    } catch {
      // not JSON: keep the text as it is
    }
  }
  const size = text.length;
  return size > max
    ? { text: `${text.slice(0, max)}\n… ${size - max} more characters not shown`, size, truncated: true }
    : { text, size, truncated: false };
}

export const packTrace = (store) => ({ ms: Math.round(performance.now() - store.t0), calls: store.entries });
