// The public RPC is load-balanced, and a node that is a little behind the others can answer "no such transaction" or give older state for something that exists. When a recorded fact
// is re-read from the chain, one miss is not a mismatch: it is read again, after a short pause, and only a miss that repeats is reported.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function confirmed(read, ok, { tries = 3, pause = 700 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { last = await read(); if (ok(last)) return { ok: true, value: last }; } catch (err) { last = { error: err.message }; }
    if (i < tries - 1) await sleep(pause * (i + 1));
  }
  return { ok: false, value: last };
}
