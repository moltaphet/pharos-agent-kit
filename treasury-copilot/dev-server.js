#!/usr/bin/env node
// Local stand-in for Vercel: serves public/ and runs api/*.js. `npm start`
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const MAX_BODY_BYTES = 1024 * 1024;
// The same headers vercel.json sets on the Treasury page, so a local run shows what production enforces.
const TREASURY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export function createDevServer() {
  return createServer(async (req, res) => {
    const fail = (status, message) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: message }));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/treasury/') {
        res.statusCode = 302;
        res.setHeader('Location', '/treasury' + url.search);
        return res.end();
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
      const page = /^\/(treasury\/?)?$/.test(pathname) ? '/treasury.html' : pathname;
      const filePath = resolve(publicRoot, '.' + page);
      if (!filePath.startsWith(publicRoot + sep)) return fail(403, 'Forbidden');
      const file = await readFile(filePath);
      if (page === '/treasury.html') for (const [name, value] of Object.entries(TREASURY_HEADERS)) res.setHeader(name, value);
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
