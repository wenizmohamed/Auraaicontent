import { db } from '../db/prisma.js';
import { embedText } from './gemini.service.js';

// ─── Retrieval Strategy ──────────────────────────────────────────
//
// TEMPORARY FALLBACK: cosine similarity computed in-memory (no pgvector yet)
//
// How it works:
// 1. embedText(query) → get query vector from Gemini
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

export async function retrieveContext(
  orgId: string,
  clientId: string,
  query: string,
  topK: number = 8,
): Promise<{ text: string; score: number; knowledgeItemId: string }[]> {

  // 1. Embed query
  const queryVector = await embedText(query);

  // 2. Get all chunks for this client that have cached embeddings
  const items = await db.knowledgeItem.findMany({
    where: { orgId, clientId },
    select: { id: true, chunks: { select: { id: true, chunkText: true, metadata: true } } },
  });

  const scored: { text: string; score: number; knowledgeItemId: string }[] = [];

  for (const item of items) {
    for (const chunk of item.chunks) {
      const meta = chunk.metadata as any;
      if (!meta?.embedding || !Array.isArray(meta.embedding)) continue;
      const score = cosineSimilarity(queryVector, meta.embedding);
      scored.push({ text: chunk.chunkText, score, knowledgeItemId: item.id });
    }
  }

  // 3. Sort by similarity, return top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
