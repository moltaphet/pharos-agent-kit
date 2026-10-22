// Runs at most `max` async jobs at once; the rest wait their turn. Used to keep bursts of calls
// below the upstream rate limits (the hosted Chain MCP allows 120 requests a minute per IP and
// answers 429 with a 27 second Retry-After when a burst goes over).
//
// Each job runs in the async context of whoever queued it. That matters here: the web API keeps
// one shared client per server instance and records a trace per request with AsyncLocalStorage,
// so a job started from another request's callback would write into the wrong request's trace.

import { AsyncResource } from 'node:async_hooks';

export function limiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length) {
      const { job, resolve, reject } = queue.shift();
      active++;
      job().then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ job: AsyncResource.bind(fn), resolve, reject });
      pump();
    });
}
