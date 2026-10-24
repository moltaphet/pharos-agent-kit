#!/usr/bin/env node
// Local stand-in for Vercel: serves public/ and runs api/*.js. `npm run web`
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // the same two rewrites as vercel.json: /x402/* is the paywalled API, /x402-facilitator/* its facilitator
    const x402 = url.pathname.match(/^\/x402(-facilitator)?(\/.*)?$/);
    if (x402) { url.searchParams.set('scope', x402[1] ? 'facilitator' : 'resource'); url.searchParams.set('path', x402[2] ?? '/'); req.url = `/api/x402?${url.searchParams}`; url.pathname = '/api/x402'; }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const { default: handler } = await import(pathToFileURL(join(root, 'api', `${name}.js`)));
      req.query = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try {
          req.body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); // Vercel does this for us
        } catch {
          req.body = null;
        }
      }
      res.status = (code) => ((res.statusCode = code), res);
      res.json = (body) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(body)));
      return await handler(req, res);
    }
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = await readFile(join(root, 'public', rel));
    res.setHeader('Content-Type', types[extname(rel)] ?? 'application/octet-stream');
    res.end(file);
  } catch (err) {
    res.statusCode = err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
    res.end(err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 'Not found' : String(err));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
