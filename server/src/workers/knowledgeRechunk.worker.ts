/**
 * Knowledge RE-CHUNK + RE-EMBED worker (2026-11-05).
 *
 * THE BUG
 * -------
 * Three compounding defects made the client's own knowledge base invisible
 * to the AI:
 *
 * 1. CHUNKS TOO COARSE. The chunker used 800-token (3,200-char) windows.
 *    A short user prompt barely moves the embedding of a window that blends
 *    many topics. Measured on the prod store with short phrase queries, the
 *    TRUE chunk averaged 0.561 while IRRELEVANT chunks averaged 0.611 —
 *    noise outranked truth, so no threshold could separate them.
 *
 * 2. HTML NOT SANITISED. Uploaded `.html` files were stored as raw bytes.
 *    3,714 of 7,111 prod chunks (52%) were markup, CSS and `<script>` bodies
 *    rather than prose. A CSS chunk scored 0.551 against "products and their
 *    features" and was INJECTED, while a real Mayaseen strategy document at
 *    0.542 was rejected.
 *
 * 3. NO EMBEDDING = PERMANENT INVISIBILITY. When Gemini was rate-limited
 *    (429) or out of prepaid credit (402), chunks were saved with no vector
 *    and never retried: 6,117 of 7,111 chunks (86%) had no embedding at all.
 *
 * The production gauge agreed: knowledge `injected: 0`, `failed: 2`,
 * `lastInjectedAt: null`. It had never once grounded a generation.
 *
 * THE FIX
 * -------
 * Re-chunk every item from its SAVED `textContent` (no file re-reads, no
 * re-extraction, no AI cost), sanitise any markup, embed with the batch
 * endpoint, and replace the chunk set atomically per item.
 *
 * Guardrails:
 *   - The 3072-dim store lock is enforced. A vector of any other length is
 *     rejected, never written.
 *   - An item is only swapped in if EVERY chunk embedded. A partial result
 *     leaves the existing chunks alone rather than half-replacing them.
 *   - The sanitiser runs over the saved text, so the HTML/CSS chunks are
 *     rewritten as prose.
 */
import { db } from '../db/prisma.js';
import { embedBatch } from '../services/gemini.service.js';
import { sanitizeForEmbedding } from '../lib/html-text.js';
import { chunkText } from './embeddings.worker.js';
import { type Job, updateJob } from './queue.js';

const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 250;
const STORED_EMBED_DIMS = 3072;

export async function knowledgeRechunkWorker(job: Job): Promise<{
  orgId: string;
  itemsProcessed: number;
  itemsSkipped: number;
  chunksCreated: number;
  chunksEmbedded: number;
  failures: { itemId: string; title: string | null; error: string }[];
}> {
  const { orgId, clientId, limit } = job.data as { orgId: string; clientId?: string; limit?: number };
  if (!orgId) throw new Error('knowledgeRechunk missing orgId');

  updateJob(job.id, { progress: 2 });

  const items = await db.knowledgeItem.findMany({
    where: {
      orgId,
      ...(clientId ? { clientId } : {}),
      textContent: { not: null },
    },
    select: {
      id: true,
      title: true,
      clientId: true,
      textContent: true,
      metadata: true,
    },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  if (!items.length) {
    updateJob(job.id, { progress: 100 });
    return { orgId, itemsProcessed: 0, itemsSkipped: 0, chunksCreated: 0, chunksEmbedded: 0, failures: [] };
  }

  console.log(`[knowledge-rechunk] ${items.length} items to re-chunk (org=${orgId})`);

  let itemsProcessed = 0;
  let itemsSkipped = 0;
  let chunksCreated = 0;
  let chunksEmbedded = 0;
  const failures: { itemId: string; title: string | null; error: string }[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    updateJob(job.id, { progress: 3 + Math.round(((idx + 1) / items.length) * 94) });

    try {
      // 1. Sanitise the saved text (turns HTML/CSS into prose).
      const clean = sanitizeForEmbedding(item.textContent || '');
      if (!clean.trim()) { itemsSkipped++; continue; }

      // 2. Re-chunk at the new granularity.
      const texts = chunkText(clean);
      if (!texts.length) { itemsSkipped++; continue; }

      // 3. Embed every chunk. All-or-nothing per item: a partial embed set
      //    would replace a working item with a broken one.
      const vectors: number[][] = [];
      for (let b = 0; b < texts.length; b += BATCH_SIZE) {
        const slice = texts.slice(b, b + BATCH_SIZE);
        const vecs = await embedBatch(slice, { orgId, clientId: item.clientId });
        vectors.push(...vecs);
        if (b + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
      }

      if (vectors.length !== texts.length) {
        failures.push({ itemId: item.id, title: item.title, error: `embedded ${vectors.length} of ${texts.length} chunks` });
        continue;
      }
      const badDims = vectors.filter(v => !Array.isArray(v) || v.length !== STORED_EMBED_DIMS).length;
      if (badDims > 0) {
        failures.push({ itemId: item.id, title: item.title, error: `${badDims} vectors are not ${STORED_EMBED_DIMS}-dim` });
        continue;
      }

      // 4. Swap the chunk set in. deleteMany + createMany inside a
      //    transaction so a crash can never leave the item with no chunks.
      await db.$transaction(async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { orgId, knowledgeItemId: item.id } });
        await tx.knowledgeChunk.createMany({
          data: texts.map((t, i) => ({
            orgId,
            knowledgeItemId: item.id,
            chunkText: t,
            metadata: {
              embedding: vectors[i],
              chunkIndex: i,
              totalChunks: texts.length,
              chunkedAt: new Date().toISOString(),
            } as any,
          })),
        });
      });

      // 5. Restamp the item honestly.
      const prev = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? (item.metadata as Record<string, unknown>)
        : {};
      await db.knowledgeItem.update({
        where: { id: item.id, orgId },
        data: {
          metadata: {
            ...prev,
            embedded: true,
            chunks: texts.length,
            embeddings: texts.length,
            readError: null,
            readAt: new Date().toISOString(),
            rechunkedAt: new Date().toISOString(),
          } as any,
        },
      });

      itemsProcessed++;
      chunksCreated += texts.length;
      chunksEmbedded += vectors.length;
    } catch (err: any) {
      failures.push({ itemId: item.id, title: item.title, error: err?.message || String(err) });
    }
  }

  updateJob(job.id, { progress: 100 });
  console.log(
    `[knowledge-rechunk] done: ${itemsProcessed} items re-chunked, ${chunksEmbedded} chunks embedded, ` +
    `${itemsSkipped} skipped, ${failures.length} failures`,
  );

  return { orgId, itemsProcessed, itemsSkipped, chunksCreated, chunksEmbedded, failures: failures.slice(0, 50) };
}
