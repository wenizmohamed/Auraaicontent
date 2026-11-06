/**
 * Knowledge embedding backfill worker (2026-11-05).
 *
 * THE BUG THIS FIXES
 * ------------------
 * `embedKnowledgeItemInner` embeds each chunk in a loop. If Gemini is
 * rate-limited (429) or out of prepaid credit (402) — which happens on the
 * workspace key every time the daily quota window rolls over — the loop
 * catches the error per chunk and still SAVES the chunk with
 * `metadata.embeddingError` and NO embedding vector.
 *
 * Those chunks are then permanently invisible to RAG: `retrieveContext` skips
 * any chunk whose `metadata.embedding` is absent, so the client's own brand
 * documents silently stop grounding their AI output. And because the item
 * stamp used `chunksCreated > 0` (chunks, not embeddings), the Knowledge
 * page showed every one of those items as "ready".
 *
 * Measured on prod 2026-11-05: 6,117 of 7,111 chunks (86%) across Maxwax,
 * GreyTMonkey, ADNEC, Indian Embassy, NBO, Al Fardan and Daikin had no
 * embedding. Maxwax alone: 6,004 of 7,111 chunks unsearchable.
 *
 * THE FIX
 * -------
 * 1. This worker re-embeds every chunk that is missing its vector, using
 *    Gemini's `batchEmbedContents` endpoint (one HTTP call per batch of 100
 *    instead of one per chunk — 6,157 chunks in minutes, not hours).
 * 2. It only patches the `metadata.embedding` field of chunks that already
 *    exist. It never re-creates or deletes chunks, so the chunk text (the
 *    expensive part — PDF/xlsx extraction) is preserved.
 * 3. It enforces the 3072-dim store lock. A vector of any other length is
 *    rejected rather than written, because a mismatched vector poisons
 *    `retrieveContext` for the whole client.
 * 4. It reports a truthful count and leaves the item stamps honest.
 */
import { db } from '../db/prisma.js';
import { embedBatch } from '../services/gemini.service.js';
import { type Job, updateJob } from './queue.js';

const BATCH_SIZE = 100;          // Gemini batchEmbedContents handles 100 per call
const BATCH_PAUSE_MS = 250;      // be gentle between batches
const STORED_EMBED_DIMS = 3072;  // the dimension lock — must match the store

export async function knowledgeEmbedBackfillWorker(job: Job): Promise<{
  orgId: string;
  chunksScanned: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  itemsTouched: number;
  failures: { chunkId: string; error: string }[];
}> {
  const { orgId, clientId } = job.data as { orgId: string; clientId?: string };
  if (!orgId) throw new Error('knowledgeEmbedBackfill missing orgId');

  updateJob(job.id, { progress: 2 });

  // 1. Find every chunk with no embedding vector. Prisma can't filter on
  //    "JSON key absent" so we select the chunks and filter in JS.
  const items = await db.knowledgeItem.findMany({
    where: { orgId, ...(clientId ? { clientId } : {}) },
    select: {
      id: true,
      title: true,
      chunks: { select: { id: true, chunkText: true, metadata: true } },
    },
  });

  const orphans: { id: string; chunkText: string; itemId: string; itemTitle: string | null }[] = [];
  for (const item of items) {
    for (const chunk of item.chunks) {
      const meta = chunk.metadata as any;
      const vec = meta?.embedding;
      if (Array.isArray(vec) && vec.length === STORED_EMBED_DIMS) continue; // already good
      if (!chunk.chunkText?.trim()) continue;                                // nothing to embed
      orphans.push({
        id: chunk.id,
        chunkText: chunk.chunkText,
        itemId: item.id,
        itemTitle: item.title,
      });
    }
  }

  const chunksScanned = items.reduce((n, i) => n + i.chunks.length, 0);
  if (orphans.length === 0) {
    updateJob(job.id, { progress: 100 });
    return { orgId, chunksScanned, chunksEmbedded: 0, chunksSkipped: 0, itemsTouched: 0, failures: [] };
  }

  console.log(`[knowledge-backfill] ${orphans.length} of ${chunksScanned} chunks need an embedding (org=${orgId})`);

  let chunksEmbedded = 0;
  let chunksSkipped = 0;
  const failures: { chunkId: string; error: string }[] = [];
  const touchedItems = new Set<string>();

  for (let i = 0; i < orphans.length; i += BATCH_SIZE) {
    const batch = orphans.slice(i, i + BATCH_SIZE);
    updateJob(job.id, { progress: 5 + Math.round(((i + batch.length) / orphans.length) * 90) });

    let vectors: number[][];
    try {
      vectors = await embedBatch(batch.map(b => b.chunkText), { orgId });
    } catch (err: any) {
      const msg = err?.message || String(err);
      // A provider outage mid-run must not abort the whole backfill. Record
      // the failure and stop — the next run picks up where this left off.
      for (const b of batch) failures.push({ chunkId: b.id, error: msg });
      console.warn(`[knowledge-backfill] batch at ${i} failed: ${msg}`);
      break;
    }

    for (let j = 0; j < batch.length; j++) {
      const b = batch[j];
      const vec = vectors[j];
      if (!Array.isArray(vec) || vec.length !== STORED_EMBED_DIMS) {
        chunksSkipped++;
        failures.push({
          chunkId: b.id,
          error: `embedding has ${Array.isArray(vec) ? vec.length : 'no'} dims, expected ${STORED_EMBED_DIMS} — refusing to write a vector from a different embedding space`,
        });
        continue;
      }
      try {
        await db.knowledgeChunk.update({
          where: { id: b.id, orgId },
          data: {
            metadata: {
              embedding: vec,
              chunkIndex: j,
              totalChunks: batch.length,
              embeddedAt: new Date().toISOString(),
              backfilled: true,
            } as any,
          },
        });
        chunksEmbedded++;
        touchedItems.add(b.itemId);
      } catch (err: any) {
        failures.push({ chunkId: b.id, error: err?.message || String(err) });
      }
    }

    if (i + BATCH_SIZE < orphans.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  // 2. Fix the item stamps so the Knowledge page stops claiming "ready" for
  //    items that are still (partly) unsearchable.
  for (const itemId of touchedItems) {
    try {
      const item = await db.knowledgeItem.findUnique({
        where: { id: itemId, orgId },
        select: { metadata: true, chunks: { select: { metadata: true } } },
      });
      if (!item) continue;
      const total = item.chunks.length;
      const embedded = item.chunks.filter((c: any) => {
        const v = (c.metadata as any)?.embedding;
        return Array.isArray(v) && v.length === STORED_EMBED_DIMS;
      }).length;
      const prev = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? (item.metadata as Record<string, unknown>)
        : {};
      await db.knowledgeItem.update({
        where: { id: itemId, orgId },
        data: {
          metadata: {
            ...prev,
            embedded: embedded > 0,
            chunks: total,
            embeddings: embedded,
            readError: embedded === 0 ? 'Every chunk failed to embed. Retry the embed.' : null,
            readAt: new Date().toISOString(),
          } as any,
        },
      });
    } catch (err: any) {
      console.warn(`[knowledge-backfill] could not restamp item ${itemId}:`, err?.message || err);
    }
  }

  updateJob(job.id, { progress: 100 });
  console.log(
    `[knowledge-backfill] done: ${chunksEmbedded} embedded, ${chunksSkipped} skipped, ${failures.length} failures, ` +
    `${touchedItems.size} items restamped`,
  );

  return {
    orgId,
    chunksScanned,
    chunksEmbedded,
    chunksSkipped,
    itemsTouched: touchedItems.size,
    failures: failures.slice(0, 50),
  };
}
