// Plain HTTP probes for the tasks that check public pages and endpoints. Each one is
// recorded in the active trace so the run log shows what was fetched and what came back.

import { preview, record } from './trace.js';

export async function probeUrl(url, { why, method = 'GET', timeoutMs = 8000, readBody = false } = {}) {
  const start = performance.now();
  let status = 0;
  let body = '';
  let failure = null;
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'pharos-agent-kit' } });
    status = res.status;
    if (readBody) body = await res.text();
    else await res.body?.cancel();
    return { status, ok: res.ok, body };
  } catch (err) {
    failure = err.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : err.message;
    return { status: 0, ok: false, body: '', error: failure };
  } finally {
    record({
      kind: 'web',
      server: new URL(url).hostname,
      tool: method,
      why,
      args: { url },
      ms: Math.round(performance.now() - start),
      ok: !failure && status > 0 && status < 400,
      ...(failure ? { error: failure } : { result: preview({ status, bytes: body.length || undefined }) }),
      start,
    });
  }
}
