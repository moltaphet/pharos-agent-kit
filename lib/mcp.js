// Minimal MCP client for Streamable HTTP servers (no dependencies).
// Handles plain JSON and text/event-stream responses, the optional
// `mcp-session-id` header, load-balancer cookies, request timeouts, 429/503
// back-off, and re-initialising when the server forgets our session (the hosted
// Pharos server keeps sessions in memory behind a load balancer).
// Every tool call is also recorded in the active trace (see trace.js), if any.

import { preview, record, traceStore } from './trace.js';

const PROTOCOL_VERSION = '2025-03-26';

export class McpError extends Error {
  constructor(message, { code, status, tool } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = status;
    this.tool = Boolean(tool); // true when the tool itself reported the failure (e.g. a revert)
  }
}

// An SSE body is a list of `event:`/`data:` lines; collect the JSON payloads.
function parseBody(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    return text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5).trim()));
  }
  return text.trim() ? [JSON.parse(text)] : [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = (start) => Math.round(performance.now() - start);
const lostSession = (status, text) => /unknown mcp session|session not found|invalid session/i.test(text) || (status === 404 && /session/i.test(text));

export class McpClient {
  constructor(url, { name = 'pharos-agent-kit', version = '0.1.0', retries = 4, timeoutMs = 30_000, retryTimeouts = true, label } = {}) {
    this.url = url;
    this.label = label ?? new URL(url).hostname;
    this.clientInfo = { name, version };
    this.retries = retries;
    this.timeoutMs = timeoutMs;
    this.retryTimeouts = retryTimeouts; // a slow answer is not fixed by asking again, and a long timeout x2 can outlast the function budget
    this.sessionId = null;
    this.cookies = new Map();
    this.nextId = 1;
    this.ready = null;
    this.onRetry = (msg) => console.error(`note: ${msg}`);
  }

  // Servers keep sessions in memory, so be a good citizen and end ours.
  async close() {
    const sid = this.sessionId;
    this.sessionId = null;
    this.ready = null;
    if (!sid) return;
    try {
      await fetch(this.url, { method: 'DELETE', signal: AbortSignal.timeout(5000), headers: { 'mcp-session-id': sid } });
    } catch {
      // best effort
    }
  }

  async #post(body) {
    for (let attempt = 0; ; attempt++) {
      const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      let res;
      try {
        res = await fetch(this.url, {
          method: 'POST',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(this.sessionId && { 'mcp-session-id': this.sessionId }),
            ...(cookie && { Cookie: cookie }),
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (attempt < this.retries && (this.retryTimeouts || err.name !== 'TimeoutError')) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new McpError(`${err.name === 'TimeoutError' ? 'Timed out' : 'Network error'} talking to ${this.url}: ${err.message}`);
      }

      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
      // 429 = rate limited, 503 = "server at session capacity". Both ship Retry-After.
      if ((res.status === 429 || res.status === 503) && attempt < this.retries) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 60);
        const msg = `${new URL(this.url).host} is busy (HTTP ${res.status}); retrying in ${wait}s (${attempt + 1}/${this.retries})`;
        record({ kind: 'retry', server: this.label, title: msg, status: res.status, waitSeconds: wait });
        this.onRetry?.(msg);
        await sleep(wait * 1000);
        continue;
      }
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      const text = await res.text();
      if (!res.ok) {
        throw Object.assign(new McpError(`HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status }), {
          lostSession: lostSession(res.status, text),
        });
      }
      return parseBody(text, res.headers.get('content-type') || '');
    }
  }

  async #connect() {
    this.sessionId = null;
    const [init] = await this.#post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: this.clientInfo },
    });
    if (init?.error) throw new McpError(init.error.message, { code: init.error.code });
    this.serverInfo = init.result.serverInfo;
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  // Session bookkeeping for the trace: say once per request whether we opened a
  // new session or reused a warm one.
  #noteSession(action, start) {
    const store = traceStore.getStore();
    if (!store) return;
    if (action === 'reuse') {
      if (store.sessions.has(this.label)) return;
      store.sessions.add(this.label);
    }
    record({
      kind: 'session',
      server: this.label,
      action,
      ms: since(start),
      detail: this.serverInfo ? `${this.serverInfo.name} ${this.serverInfo.version ?? ''}`.trim() : undefined,
      start,
    });
  }

  async request(method, params) {
    for (let reconnects = 0; ; reconnects++) {
      const fresh = !this.ready;
      const started = performance.now();
      this.ready ??= this.#connect();
      try {
        await this.ready;
        this.#noteSession(fresh ? (reconnects ? 'reconnect' : 'initialize') : 'reuse', started);
        const id = this.nextId++;
        const msgs = await this.#post({ jsonrpc: '2.0', id, method, params });
        const reply = msgs.find((m) => m.id === id);
        if (!reply) throw new McpError(`No response to ${method}`);
        if (reply.error) {
          if (lostSession(0, reply.error.message)) throw Object.assign(new McpError(reply.error.message), { lostSession: true });
          throw new McpError(reply.error.message, { code: reply.error.code });
        }
        return reply.result;
      } catch (err) {
        // Session evaporated (e.g. request hit another server instance): start a fresh one.
        if (err.lostSession && reconnects < 3) {
          this.ready = null;
          continue;
        }
        if (err.message?.startsWith('HTTP') || err.message?.includes('initialize')) this.ready = null;
        throw err;
      }
    }
  }

  listTools() {
    return this.request('tools/list', {}).then((r) => r.tools);
  }

  // Returns the tool's text content, JSON-parsed when possible. `meta.why` is a
  // human sentence that shows up next to the call in the trace.
  async callTool(name, args = {}, meta = {}) {
    const start = performance.now();
    let text = '';
    let failure = null;
    try {
      const result = await this.request('tools/call', { name, arguments: args });
      text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (result.isError) {
        failure = `${name}: ${text}`;
        throw new McpError(failure, { tool: true });
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      failure ??= err.message;
      throw err;
    } finally {
      record({
        kind: 'mcp',
        server: this.label,
        tool: name,
        why: meta.why,
        args,
        ms: since(start),
        ok: !failure,
        ...(failure ? { error: failure } : { result: preview(text) }),
        start,
      });
    }
  }
}

export const PHAROS_CHAIN_MCP = 'https://mcp.pharos.xyz/mcp';
export const PHAROS_DOCS_MCP = 'https://docs.pharos.xyz/~gitbook/mcp';
