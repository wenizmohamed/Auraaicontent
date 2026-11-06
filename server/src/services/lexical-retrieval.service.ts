/**
 * Lexical (BM25) retrieval over the knowledge corpus (2026-11-05).
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole RAG path had a single point of failure: the QUERY had to be
 * embedded by Gemini before anything could be ranked. When Gemini's
 * prepayment credits ran out (402 "Your prepayment credits are depleted",
 * verified live 2026-11-05), every query embedding failed and the entire
 * knowledge base + memory store became unreachable — even though 3,450
 * chunk vectors were sitting in the database, fully usable.
 *
 * That is exactly the failure the customer reported as "custom memories
 * don't work". The memories were fine. The retriever could not ask the
 * question.
 *
 * The fix is a lexical lane that needs NO API call at all. It scores the
 * stored chunk text directly against the query terms. It cannot match
 * synonyms or paraphrase the way an embedding can, but it is exact,
 * instantaneous, free, and it never goes dark.
 *
 * IT IS ALSO A HYBRID RETRIEVER, NOT JUST A FALLBACK
 * --------------------------------------------------
 * BM25 and cosine fail differently. A query like "half day shoot price"
 * matches a document that literally says "half-day shoot" even when the
 * embedding is diluted by a 3,200-char chunk of unrelated content — which
 * is precisely the failure mode measured on the prod store (the TRUE chunk
 * averaged 0.561 while IRRELEVANT chunks averaged 0.611). Running both and
 * merging with Reciprocal Rank Fusion keeps the best of each.
 */
import { db } from '../db/prisma.js';
import { looksLikeHtml } from '../lib/html-text.js';

/** Words too common to carry signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'to', 'of', 'in', 'on',
  'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
  'i', 'we', 'you', 'they', 'he', 'she', 'it', 'this', 'that', 'these', 'those', 'my',
  'our', 'your', 'their', 'me', 'us', 'them', 'about', 'into', 'over', 'after', 'before',
  'up', 'down', 'out', 'off', 'so', 'not', 'no', 'yes', 'just', 'now', 'new', 'get',
  'make', 'made', 'use', 'used', 'write', 'create', 'generate', 'please', 'need', 'want',
]);

/** Very common marketing/brand words that would otherwise match everything. */
const WEAK_TERMS = new Set([
  'brand', 'client', 'company', 'content', 'social', 'media', 'campaign', 'project',
  'service', 'services', 'work', 'team', 'digital', 'marketing', 'video', 'image',
]);

/** Split a string into scoring terms. Handles Arabic and Latin scripts. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    // Keep Arabic letters, Latin letters and digits.
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length >= 2)
    .filter(t => !STOPWORDS.has(t));
}

/**
 * Terms that carry the query's intent. Weak terms are down-weighted rather
 * than dropped, so a query made only of weak terms still matches something.
 */
function termWeights(queryTerms: string[]): Map<string, number> {
  const w = new Map<string, number>();
  for (const t of queryTerms) {
    const weight = WEAK_TERMS.has(t) ? 0.25 : 1;
    w.set(t, Math.max(w.get(t) ?? 0, weight));
  }
  return w;
}

/** Stem-ish normalisation so "shooting" matches "shoot". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

interface Doc {
  id: string;
  text: string;
  knowledgeItemId: string;
  terms: Map<string, number>;   // stemmed term -> frequency
  length: number;
}

export interface LexicalHit {
  text: string;
  score: number;
  knowledgeItemId: string;
}

/**
 * Score every candidate chunk against the query with BM25 and return the
 * best matches. BM25's saturation term stops a repeated word from
 * dominating, which matters because knowledge chunks repeat brand names.
 */
export function bm25Score(
  queryTerms: string[],
  docs: Doc[],
  k1 = 1.5,
  b = 0.75,
): LexicalHit[] {
  if (!queryTerms.length || !docs.length) return [];

  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N;

  // Document frequency per stemmed term.
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of d.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const weights = termWeights(queryTerms);
  const stems = new Map<string, number>();
  for (const [t, w] of weights) {
    const s = stem(t);
    stems.set(s, Math.max(stems.get(s) ?? 0, w));
  }

  const hits: LexicalHit[] = [];
  for (const d of docs) {
    let score = 0;
    let matched = 0;
    for (const [term, qw] of stems) {
      const tf = d.terms.get(term);
      if (!tf) continue;
      matched++;
      const n = df.get(term) ?? 0;
      // BM25 idf with the +1 smoothing, floored at a small positive value so
      // a term present in every document contributes almost nothing.
      const idf = Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
      const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (d.length / (avgLen || 1))));
      score += qw * idf * norm;
    }
    // Reward coverage: a chunk that matches MORE of the query's distinct
    // terms is more likely to be the right answer than one that repeats a
    // single term a lot.
    if (matched > 0) score *= (1 + Math.log(matched)) * (matched / stems.size);
    if (score > 0) hits.push({ text: d.text, score, knowledgeItemId: d.knowledgeItemId });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/**
 * Build the BM25 document set from a client's chunks.
 *
 * MARKUP IS SKIPPED. Half the prod corpus was raw HTML/CSS/`<script>` bodies
 * (3,714 of 7,111 chunks). A JavaScript bundle matched "products features
 * price list" with a score of 24.28 and outranked real prose. Markup is not
 * content, so it never enters the document set.
 */
export function buildDocs(
  chunks: { id: string; chunkText: string; knowledgeItemId: string }[],
): Doc[] {
  const docs: Doc[] = [];
  for (const c of chunks) {
    const text = c.chunkText || '';
    if (!text.trim()) continue;
    if (looksLikeHtml(text)) continue;
    const terms = new Map<string, number>();
    let count = 0;
    for (const raw of tokenize(text)) {
      const s = stem(raw);
      terms.set(s, (terms.get(s) ?? 0) + 1);
      count++;
    }
    if (!count) continue;
    docs.push({ id: c.id, text, knowledgeItemId: c.knowledgeItemId, terms, length: count });
  }
  return docs;
}

/**
 * Retrieve by keyword only. No API call, no embeddings, no key required.
 * Returns the top `topK` chunks whose text actually shares terms with the
 * query.
 */
export async function lexicalRetrieveContext(
  orgId: string,
  clientId: string,
  query: string,
  topK: number = 8,
): Promise<LexicalHit[]> {
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];

  const items = await db.knowledgeItem.findMany({
    where: { orgId, clientId },
    select: { id: true, chunks: { select: { id: true, chunkText: true } } },
  });

  const flat: { id: string; chunkText: string; knowledgeItemId: string }[] = [];
  for (const it of items) {
    for (const c of it.chunks) flat.push({ id: c.id, chunkText: c.chunkText, knowledgeItemId: it.id });
  }
  if (!flat.length) return [];

  const docs = buildDocs(flat);
  return bm25Score(queryTerms, docs).slice(0, topK);
}

/**
 * Merge a semantic ranking and a lexical ranking with Reciprocal Rank
 * Fusion. RRF is used because the two lists have incomparable score scales
 * (cosine vs BM25), and RRF only looks at RANKS, so no normalisation is
 * needed.
 *
 * The two lists are keyed by CHUNK TEXT, not by list position. Keying by
 * position would silently merge semantic[0] with lexical[0] as if they were
 * the same document, which turns a fusion into a coin flip.
 *
 * Each hit KEEPS ITS OWN SCORE (cosine for the semantic lane, BM25 for the
 * lexical one) because the caller applies a per-lane floor. The fused value
 * is exposed separately as `rrf`, and the merged list is ORDERED by it.
 */
export function rrfMerge<T extends { score: number; text?: string }>(
  semantic: T[],
  lexical: T[],
  k: number = 60,
): (T & { rrf: number })[] {
  const byKey = new Map<string, { item: T; rrf: number; sem?: number; lex?: number }>();
  const keyOf = (x: T, i: number) => (x.text ? `t:${x.text}` : `i:${i}`);

  semantic.forEach((x, i) => {
    const kk = keyOf(x, i);
    const e = byKey.get(kk) ?? { item: x, rrf: 0 };
    e.rrf += 1 / (k + i + 1);
    e.sem = x.score;
    byKey.set(kk, e);
  });
  lexical.forEach((x, i) => {
    const kk = keyOf(x, i);
    const e = byKey.get(kk) ?? { item: x, rrf: 0 };
    e.rrf += 1 / (k + i + 1);
    e.lex = x.score;
    // The lexical hit is the fallback for a chunk the semantic lane could not
    // reach (no vector stored). Keep its own score so the lane floor applies.
    if (!e.sem) e.item = x;
    byKey.set(kk, e);
  });

  return [...byKey.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .map(e => ({ ...e.item, score: e.item.score, rrf: e.rrf }));
}
