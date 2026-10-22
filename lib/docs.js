// Turns raw Developer Docs MCP output into { found, answer, sources, related }.
// Pure functions only, so the "no good answer" logic is unit-testable.

export const DOCS_BASE = 'https://docs.pharos.xyz';

// askQuestion always lists *some* sources, even for nonsense questions, so the
// presence of sources is not evidence of an answer. We look at what the answer
// itself says, and at whether a keyword search finds anything at all.
// The model words its refusals differently from run to run ("cannot find…", "can't
// answer that from the available docs"), so match the family, not one sentence.
const NO_ANSWER = /\b(cannot|can't|can not|could not|couldn't|unable to|not able to) (find|answer|locate)\b|\bno (relevant |specific |matching )?information\b|\bnot (covered|documented|mentioned) in\b|\b(doesn't|does not|don't|do not) (cover|contain) (any )?(information|details)\b/i;
const refuses = (text) => NO_ANSWER.test(text.slice(0, 250).replace(/[‘’]/g, "'")); // curly → straight apostrophes

const stripFragment = (url) => url.split('#')[0].replace(/\/$/, '');

export function cleanMarkdown(md) {
  return md
    .replace(/\[([^\]]*)\]\(broken:\/\/[^)]*\)/g, '$1') // dead GitBook mentions
    .replace(/\]\((\/[^)]*)\)/g, `](${DOCS_BASE}$1)`) // relative → absolute doc links
    .trim();
}

export function extractLinks(md) {
  return [...md.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map(([, title, url]) => ({ title, url }));
}

// askQuestion returns "<answer>\n\n# Sources\n\n- [title](url)…".
export function splitAnswer(text) {
  const i = text.search(/^# Sources\s*$/m);
  if (i < 0) return { answer: text.trim(), listed: [] };
  return { answer: text.slice(0, i).trim(), listed: extractLinks(text.slice(i)) };
}

// searchDocumentation returns repeated "Title: …\nLink: …\nContent: …" blocks.
export function parseSearch(text) {
  return text
    .split(/^Title: /m)
    .slice(1)
    .map((block) => ({
      title: block.split('\n')[0].trim(),
      url: block.match(/^Link: (.+)$/m)?.[1].trim(),
    }))
    .filter((r) => r.url);
}

function unique(items) {
  const seen = new Set();
  return items.filter((s) => !seen.has(stripFragment(s.url)) && seen.add(stripFragment(s.url)));
}

export function buildResult({ question, askText, searchText, maxSources = 5 }) {
  const { answer: rawAnswer, listed } = splitAnswer(cleanMarkdown(askText ?? ''));
  const hits = parseSearch(searchText ?? '');
  const inline = extractLinks(rawAnswer).filter((l) => l.url.startsWith(DOCS_BASE));

  // The evidence behind the decision, so a UI can show why we trusted (or refused) the answer.
  const checks = { hasAnswer: Boolean(rawAnswer), refusalPhrase: Boolean(rawAnswer) && refuses(rawAnswer), searchHits: hits.length, linkedPages: inline.length };
  const found = checks.hasAnswer && !checks.refusalPhrase && (checks.searchHits > 0 || checks.linkedPages > 0);
  const reason = !checks.hasAnswer
    ? 'The docs server returned no answer text.'
    : checks.refusalPhrase
      ? 'The answer itself says it cannot answer, so it is not shown as an answer.'
      : !found
        ? 'The answer cites no docs page and the keyword search matched nothing, so it is not trusted.'
        : `The answer does not refuse, the keyword search matched ${checks.searchHits} page(s) and the answer links ${checks.linkedPages} docs page(s).`;
  if (!found) return { question, found: false, answer: null, sources: [], related: unique(hits).slice(0, 3), checks, reason };

  // Pages the answer links to come first (it was built from them), then keyword-search
  // hits, then askQuestion's own source list, which tends to include loosely related pages.
  const sources = unique([...inline, ...hits, ...listed]).slice(0, maxSources);
  return { question, found: true, answer: rawAnswer, sources, related: [], checks, reason };
}
