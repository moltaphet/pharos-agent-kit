#!/usr/bin/env node
// Local stand-in for Vercel: serves public/ and runs api/*.js. `npm run web`
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const MAX_BODY_BYTES = 1024 * 1024;

export function createDevServer() {
  return createServer(async (req, res) => {
    const fail = (status, message) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: message }));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      // The same two rewrites as vercel.json.
      const x402 = url.pathname.match(/^\/x402(-facilitator)?(\/.*)?$/);
      if (x402) {
        url.searchParams.set('scope', x402[1] ? 'facilitator' : 'resource');
        url.searchParams.set('path', x402[2] ?? '/');
        req.url = `/api/x402?${url.searchParams}`;
        url.pathname = '/api/x402';
      }
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5);
        if (!/^[a-z0-9-]+$/i.test(name)) return fail(404, 'Not found');
        const moduleUrl = pathToFileURL(join(root, 'api', `${name}.js`));
        let handler;
        try { ({ default: handler } = await import(moduleUrl)); }
        catch (err) {
          if (err.code === 'ERR_MODULE_NOT_FOUND' && err.url === moduleUrl.href) return fail(404, 'Not found');
          throw err;
        }
        req.query = Object.fromEntries([...new Set(url.searchParams.keys())].map((key) => {
          const values = url.searchParams.getAll(key);
          return [key, values.length === 1 ? values[0] : values];
        }));
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const declared = Number(req.headers['content-length']);
          if (declared > MAX_BODY_BYTES) { req.resume(); return fail(413, 'Request body is too large'); }
          const chunks = [];
          let size = 0;
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) { req.resume(); return fail(413, 'Request body is too large'); }
            chunks.push(chunk);
          }
          try { req.body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); }
          catch { return fail(400, 'Request body must be valid JSON'); }
        }
        res.status = (code) => ((res.statusCode = code), res);
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        return await handler(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return fail(405, 'Method not allowed');
      }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { return fail(400, 'Invalid URL encoding'); }
      if (pathname.includes('\0')) return fail(400, 'Invalid URL path');
      const filePath = resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filePath.startsWith(publicRoot + sep)) return fail(403, 'Forbidden');
      const file = await readFile(filePath);
      res.setHeader('Content-Type', types[extname(filePath)] ?? 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : file);
    } catch (err) {
      if (res.headersSent) return res.end();
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
      fail(missing ? 404 : 500, missing ? 'Not found' : 'Internal server error');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createDevServer().listen(port, () => console.log(`http://localhost:${port}`));
}
