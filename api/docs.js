// GET /api/docs?q=how do I deploy a contract?
import { docsClient, handle, need, one } from '../lib/server.js';
import { buildResult } from '../lib/docs.js';

export default handle(async (q) => {
  const question = (one(q.q) || '').trim();
  need(question.length >= 3, 'ask a question (at least 3 characters)');
  need(question.length <= 300, 'keep the question under 300 characters');

  const client = docsClient();
  const [askText, searchText] = await Promise.all([
    client.callTool('askQuestion', { question, goal: 'Build on Pharos as a developer' }),
    client.callTool('searchDocumentation', { query: question }),
  ]);
  return buildResult({ question, askText, searchText, maxSources: 5 });
});
