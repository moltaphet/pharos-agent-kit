// GET|POST /api/run?slug=<task>[&...inputs]
// One route for every task that needs the server. Keeping them behind one function
// keeps the deployment small; each task lives in lib/tasks/<slug>.js.
import { chainClient, docsClient, handle, need, one } from '../lib/server.js';
import { TASKS } from '../lib/tasks/index.js';

export default function route(req, res) {
  return handle(async (q) => {
    const slug = one(q.slug);
    need(slug && Object.hasOwn(TASKS, slug), `unknown task "${slug ?? ''}"`);
    return TASKS[slug]({ q, body: req.body ?? null, chain: chainClient(), docs: docsClient() });
  })(req, res);
}
