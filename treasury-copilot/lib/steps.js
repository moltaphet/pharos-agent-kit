// Who called what, in order. Every server an agent talks to is wrapped so each call becomes a numbered step with its input, output and time;
// the agent's own conclusions are steps too, and say which earlier steps they used. Shared by the agents that show their working.

export const brief = (v, max = 260) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s.length > max ? s.slice(0, max) + '…' : s;
};

export function tracer() {
  const steps = [];
  let seq = 0;
  const wrap = (client, actor) => ({
    callTool: async (tool, args, opts = {}) => {
      const n = ++seq;
      const t0 = performance.now();
      try {
        const out = await client.callTool(tool, args, opts);
        const shown = tool === 'get_block' && out && typeof out === 'object' ? { number: out.number, hash: out.hash, timestamp: out.timestamp, '…': 'rest of the header omitted' } : out;
        steps.push({ n, actor, name: tool, why: opts.why ?? null, input: brief(args), output: brief(shown), ms: Math.round(performance.now() - t0) });
        return out;
      } catch (err) {
        steps.push({ n, actor, name: tool, why: opts.why ?? null, input: brief(args), error: String(err.message ?? err).slice(0, 200), ms: Math.round(performance.now() - t0) });
        throw err;
      }
    },
  });
  const agent = (name, summary, { uses = [], output = null } = {}) => {
    const n = ++seq;
    steps.push({ n, actor: 'agent', name, summary, uses: [...new Set(uses)].sort((a, b) => a - b), output });
    return n;
  };
  return { steps, wrap, agent, last: () => seq };
}

