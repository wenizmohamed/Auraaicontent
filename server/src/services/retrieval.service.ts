import { db } from '../db/prisma.js';
import { embedText } from './gemini.service.js';
import { lexicalRetrieveContext, rrfMerge } from './lexical-retrieval.service.js';

// ─── Retrieval Strategy ──────────────────────────────────────────
//
// TEMPORARY FALLBACK: cosine similarity computed in-memory (no pgvector yet)
//
// How it works:
// 1. embedText(query, { orgId, clientId }) → get query vector from Gemini
// 2. Fetch all chunks for client (with cached embeddings in metadata.embedding)
// 3. Compute cosine similarity in JS
// 4. Return top-K
//
// FUTURE (Commit 8+): Enable pgvector extension, restore KnowledgeChunk.embedding
// column, use SQL `<=>` operator for nearest-neighbor search in Postgres.
// That removes the in-memory bottleneck and scales to millions of chunks.
//
// Migration path:
// 1. ALTER EXTENSION pgvector
// 2. Uncomment embedding column in schema.prisma
// 3. prisma migrate
// 4. Replace retrieveContext() with SQL vector query
// ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export interface RetrievedContext {
  text: string;
  score: number;
  knowledgeItemId: string;
  /** Which lane produced this hit. The score scales differ (cosine vs BM25),
   *  so the caller applies a different floor to each. */
  mode: 'semantic' | 'lexical';
}

export async function retrieveContext(
  orgId: string,
  clientId: string,
  query: string,
  topK: number = 8,
): Promise<RetrievedContext[]> {

  // 1. Embed query.
  //
  // THE QUERY EMBEDDING IS A SINGLE POINT OF FAILURE (fixed 2026-11-05).
  // When Gemini's prepayment credits ran out (402 "Your prepayment credits
  // are depleted", verified live), every query embedding failed and the
  // ENTIRE knowledge base became unreachable — even though thousands of
  // chunk vectors sat in the database, fully usable. The customer-facing
  // symptom was "custom memories don't work"; the memories were fine, the
  // retriever could not ask the question.
  //
  // Now a failed query embedding falls through to the LEXICAL lane (BM25 over
  // the stored chunk text), which needs no API call, no key and no credit.
  let queryVector: number[] | null = null;
  try {
    queryVector = await embedText(query, { orgId, clientId });
  } catch (err: any) {
    console.warn(`[retrieval] query embedding failed (${err?.message || err}) — falling back to the lexical lane`);
  }

  // 2. Get all chunks for this client that have cached embeddings
  const items = await db.knowledgeItem.findMany({
    where: { orgId, clientId },
    select: { id: true, chunks: { select: { id: true, chunkText: true, metadata: true } } },
  });

  const scored: RetrievedContext[] = [];

  // Guard (2026-11-05): a query vector from a DIFFERENT embedding space than
  // the stored chunk vectors makes every cosine score 0, so the "top-K" was
  // just the first K chunks in arbitrary order — a query for "ceramic coating"
  // served CSS junk. If the dimensions don't line up, return nothing rather
  // than unranked noise dressed up as matches.
  let mismatched = 0;
  let comparable = 0;

  for (const item of items) {
    for (const chunk of item.chunks) {
      const meta = chunk.metadata as any;
      if (!meta?.embedding || !Array.isArray(meta.embedding)) continue;
      if (!queryVector) { comparable++; continue; } // lexical lane ranks these
      if (meta.embedding.length !== queryVector.length) { mismatched++; continue; }
      comparable++;
      const score = cosineSimilarity(queryVector, meta.embedding);
      scored.push({ text: chunk.chunkText, score, knowledgeItemId: item.id, mode: 'semantic' });
    }
  }

  if (queryVector && comparable === 0 && mismatched > 0) {
    console.warn(
      `[retrieval] ${mismatched} chunks have a different embedding dimension than the query ` +
      `(${queryVector.length}-dim query vs the stored vectors) — refusing to return unranked chunks`,
    );
    return [];
  }

  // 3. Sort by similarity, return top-K
  scored.sort((a, b) => b.score - a.score);

  if (!queryVector) {
    // LEXICAL LANE. No embedding, no key, no credit. BM25 over the stored
    // chunk text — exact and instantaneous where cosine is unavailable.
    const lexical = await lexicalRetrieveContext(orgId, clientId, query, topK);
    return lexical.map(h => ({ text: h.text, score: h.score, knowledgeItemId: h.knowledgeItemId, mode: 'lexical' }));
  }

  // HYBRID LANE. Both lanes are live, so run BOTH and fuse the rankings.
  //
  // Why fuse instead of picking one: the two lanes fail in opposite
  // directions. Cosine finds paraphrase ("half day shoot" vs "half-day
  // shoot") but is diluted by a long chunk; BM25 finds the exact term but
  // cannot match a synonym. Measured on the prod store, the true chunk
  // averaged 0.561 cosine while irrelevant chunks averaged 0.611 — the
  // semantic lane alone ranked noise above truth. The lexical lane alone
  // matched a JavaScript bundle at 24.28 on "products features price list".
  // RRF merges the two RANKINGS (scores are incomparable), so a chunk that
  // both lanes like wins, and a chunk only one lane likes still surfaces.
  const semantic = scored.slice(0, topK);
  let lexical: RetrievedContext[] = [];
  try {
    const lex = await lexicalRetrieveContext(orgId, clientId, query, topK);
    lexical = lex.map(h => ({ text: h.text, score: h.score, knowledgeItemId: h.knowledgeItemId, mode: 'lexical' }));
  } catch (err: any) {
    console.warn(`[retrieval] lexical lane failed (${err?.message || err}) — semantic only`);
  }

  if (!lexical.length) return semantic;
  if (!semantic.length) return lexical;

  return rrfMerge(semantic, lexical).slice(0, topK);
}
