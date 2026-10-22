// Builds public/registry.json from the public Agent Arena task pages.
// Usage: node scripts/scrape-tasks.mjs
import { writeFile } from 'node:fs/promises';

const BASE = 'https://pharos-agent-arena.vercel.app';
const text = (html) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map((l) => l.trim()).filter(Boolean);

const home = await (await fetch(BASE)).text();
const slugs = [...new Set([...home.matchAll(/href="\/tasks\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
console.log(`found ${slugs.length} tasks`);

const tasks = [];
for (const slug of slugs) {
  const lines = text(await (await fetch(`${BASE}/tasks/${slug}`)).text());
  const at = (s) => lines.indexOf(s);
  const start = at('← All tasks');
  const [tier, category, title, summary] = lines.slice(start + 1, start + 5);
  const points = Number(lines[at('Points') + 1]);
  const what = lines[at("What you'll build") + 1];
  const reqs = [];
  for (let i = at('Requirements') + 1; i < lines.length && !/^Reviewers score/.test(lines[i]); i += 2) reqs.push(lines[i + 1]);
  tasks.push({ slug, title, category, tier, points, summary, build: what, requirements: reqs.filter(Boolean), url: `${BASE}/tasks/${slug}` });
  console.log(slug, tier, points, reqs.length, 'reqs');
}
await writeFile(new URL('../public/registry.json', import.meta.url), JSON.stringify({ source: BASE, scrapedAt: new Date().toISOString().slice(0, 10), tasks }, null, 2) + '\n');
