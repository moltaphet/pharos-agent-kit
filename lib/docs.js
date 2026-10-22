// Turns raw Developer Docs MCP output into { found, answer, sources, related }.
// Pure functions only, so the "no good answer" logic is unit-testable.

export const DOCS_BASE = 'https://docs.pharos.xyz';

// What we tell askQuestion the answer is for. Without the second sentence its answers ranged from 165 to 1,700+
// characters (avg ~970); with it ~550 (max ~900), which is what a terminal or a card can show.
export const DOCS_GOAL = 'Build on Pharos as a developer. Answer concisely: at most about 120 words, with the key steps or values and the page to read.';

// askQuestion always lists *some* sources, even for nonsense questions, so the
// presence of sources is not evidence of an answer. We look at what the answer
// itself says, and at whether a keyword search finds anything at all.
// The model words its refusals differently from run to run ("cannot find…", "can't
// answer that from the available docs"), so match the family, not one sentence.
const NO_ANSWER = new RegExp(
  [
    "\\b(cannot|can't|can not|could not|couldn't|unable to|not able to) (find|answer|locate)\\b",
    '\\bno (relevant |specific |matching )?information\\b',
    "\\b(not|isn't|aren't) (covered|documented|mentioned)\\b",
    "\\b(doesn't|does not|don't|do not) (cover|contain) (any )?(information|details)\\b",
  ].join('|'),
  'i',
);
// Wordings this cannot catch ("doesn't specify a swallow's airspeed") are caught by
// questionSupport() below, which does not depend on how the model phrases its refusal.
const refusalMatch = (text) => text.slice(0, 250).replace(/[‘’]/g, "'").match(NO_ANSWER)?.[0] ?? null; // curly → straight apostrophes
export const refuses = (text) => refusalMatch(text) !== null;

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
      content: block.match(/^Content: ([\s\S]*)$/m)?.[1] ?? '',
    }))
    .filter((r) => r.url);
}

const STOPWORDS = new Set('the and for are but not you your can how what why when where which who whom does did has have had was were will would should could may might this that these those with from into onto about over under than then there here its their our any all get got use using used make made need needs want one two new via per too very just also like such some more most other only own same been being them they she him his her let say says see way ways pharos'.split(' '));
const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.length > 4 ? w.replace(/s$/, '') : w);

// Fraction of the question's content words that occur in the keyword-search results
// (titles + snippets). The search always returns pages, so having hits proves nothing,
// but a question about sourdough shares no words with them. Returns null when the
// question has no content words to test.
export function questionSupport(question, hits) {
  const words = [...new Set((question ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
  if (words.length === 0) return null;
  const haystack = hits.map((h) => `${h.title} ${h.content ?? ''}`).join(' ').toLowerCase();
  return words.filter((w) => haystack.includes(stem(w))).length / words.length;
}

const MIN_SUPPORT = 0.5;

function unique(items) {
  const seen = new Set();
  return items.filter((s) => !seen.has(stripFragment(s.url)) && seen.add(stripFragment(s.url)));
}

export function buildResult({ question, askText, searchText, maxSources = 5 }) {
  const { answer: rawAnswer, listed } = splitAnswer(cleanMarkdown(askText ?? ''));
  const hits = parseSearch(searchText ?? '');
  const inline = extractLinks(rawAnswer).filter((l) => l.url.startsWith(DOCS_BASE));

  // The evidence behind the decision, so a UI can show why we trusted (or refused) the answer.
  const support = questionSupport(question, hits);
  const checks = { hasAnswer: Boolean(rawAnswer), refusalPhrase: Boolean(rawAnswer) && refuses(rawAnswer), refusalMatch: rawAnswer ? refusalMatch(rawAnswer) : null, searchHits: hits.length, linkedPages: inline.length, questionSupport: support };
  const supported = support === null || support >= MIN_SUPPORT;
  const found = checks.hasAnswer && !checks.refusalPhrase && supported && (checks.searchHits > 0 || checks.linkedPages > 0);
  const reason = !checks.hasAnswer
    ? 'The docs server returned no answer text.'
    : checks.refusalPhrase
      ? 'The answer itself says it cannot find what was asked, so it is not shown as the answer.'
      : !supported
        ? `Only ${Math.round(support * 100)}% of the question's key words appear in the pages the docs search returned, so the question is not about anything in the docs and the answer is not shown.`
      : !found
        ? 'The answer cites no docs page and the keyword search matched nothing, so it is not trusted.'
        : `The answer does not refuse, the keyword search matched ${checks.searchHits} page(s) and the answer links ${checks.linkedPages} docs page(s).`;
  // "I cannot find X in the docs, but here is what they do say" is an honest partial answer. It is
  // never shown as the answer, but its text is kept so the reader still gets the related facts.
  const partial = checks.refusalPhrase && supported && support !== null && inline.length > 0 ? rawAnswer : null;
  if (!found) return { question, found: false, answer: null, partial, sources: [], related: unique(hits).slice(0, 3), checks, reason };

  // Pages the answer links to come first (it was built from them), then keyword-search
  // hits, then askQuestion's own source list, which tends to include loosely related pages.
  const sources = unique([...inline, ...hits, ...listed]).slice(0, maxSources);
  return { question, found: true, answer: rawAnswer, sources, related: [], checks, reason };
}
