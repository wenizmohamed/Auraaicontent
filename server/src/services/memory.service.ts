// Memory service — experiential memory / learnings layer.
//
// Sibling to retrieval.service.ts (which does DOCUMENT RAG over KnowledgeChunk).
// This handles what the system LEARNED from interaction: corrections, stated
// preferences, recurring patterns, and failures to avoid. Same storage strategy
// as KnowledgeChunk — embedding cached as JSON (number[]) + in-memory cosine,
// NO pgvector dependency — so a later unified migration can move both at once.
//
// Contract: every function is best-effort and tenant-scoped. recordMemory never
// throws (a failed capture must never break the user action that triggered it);
// retrieveMemories returns [] on any failure (so the memory-enricher silently
// no-ops). Tenant isolation: every query is filtered by orgId; clientId null =
// an org-wide learning that applies to every client.

import { db } from '../db/prisma.js';
import { embedText } from './gemini.service.js';

export type MemoryKind = 'correction' | 'preference' | 'pattern' | 'failure' | 'success';
export type MemorySource = 'edit' | 'rejection' | 'regeneration' | 'failed_call' | 'explicit' | 'consolidation';

export interface RecordMemoryInput {
  orgId: string;
  clientId?: string | null; // null/undefined = org-wide learning
  userId?: string | null;
  kind: MemoryKind;
  source: MemorySource;
  content: string;          // the distilled lesson
  context?: string | null;  // optional originating situation/prompt
  weight?: number;          // default 1
  expiresAt?: Date | null;  // optional soft TTL for decay
  metadata?: Record<string, unknown> | null;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  kind: string;
  score: number;   // cosine * weight (decay-aware)
  weight: number;
}

// ─── cosine (identical to retrieval.service) ─────────────────────
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

// ─── record ──────────────────────────────────────────────────────
// Persist a learning. Best-effort: embeds the content for later retrieval, but
// stores the row even if embedding fails (embedding=null → backfillable later,
// never silently dropped). Returns the new id, or null on hard failure.
export async function recordMemory(input: RecordMemoryInput): Promise<string | null> {
  if (!input.orgId || !input.content?.trim()) return null;

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(input.content.slice(0, 8000), { orgId: input.orgId, userId: input.userId, clientId: input.clientId });
  } catch (err: any) {
    // Embedding unavailable (rate-limit / no key) — keep the lesson anyway.
    console.warn('[memory] embed failed, storing without embedding:', err?.message || err);
  }

  try {
    const row = await db.memory.create({
      data: {
        orgId: input.orgId,
        clientId: input.clientId ?? null,
        userId: input.userId ?? null,
        kind: input.kind,
        source: input.source,
        content: input.content.trim(),
        context: input.context ?? null,
        embedding: embedding ?? undefined,
        weight: input.weight ?? 1,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? undefined) as any,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err: any) {
    console.warn('[memory] create failed:', err?.message || err);
    return null;
  }
}

// ─── retrieve ────────────────────────────────────────────────────
// Top-K active learnings relevant to `query`, scoped to org + (this client OR
// org-wide). Score = cosine * weight so consolidation/decay can demote stale
// lessons. Best-effort: returns [] on any failure or when no embeddings exist.
export async function retrieveMemories(
  orgId: string,
  clientId: string | null | undefined,
  query: string,
  topK = 6,
  minScore = 0.55,
): Promise<RetrievedMemory[]> {
  if (!orgId || !query?.trim()) return [];

  let queryVector: number[];
  try {
    queryVector = await embedText(query.slice(0, 8000), { orgId });
  } catch {
    return [];
  }

  let rows: { id: string; content: string; kind: string; weight: number; embedding: unknown }[];
  try {
    rows = await db.memory.findMany({
      where: {
        orgId,
        status: 'active',
        // client-specific OR org-wide; if no clientId given, org-wide only
        OR: clientId ? [{ clientId }, { clientId: null }] : [{ clientId: null }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { id: true, content: true, kind: true, weight: true, embedding: true },
      take: 500, // safety cap on in-memory scoring set
    });
  } catch (err: any) {
    console.warn('[memory] findMany failed:', err?.message || err);
    return [];
  }

  const scored: RetrievedMemory[] = [];
  for (const r of rows) {
    if (!Array.isArray(r.embedding)) continue;
    const cos = cosineSimilarity(queryVector, r.embedding as number[]);
    const score = cos * (r.weight ?? 1);
    if (score >= minScore) {
      scored.push({ id: r.id, content: r.content, kind: r.kind, score, weight: r.weight ?? 1 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  // Usage telemetry (best-effort, fire-and-forget): bump useCount/lastUsedAt so
  // consolidation can favour lessons that actually get retrieved.
  if (top.length) {
    db.memory
      .updateMany({
        where: { id: { in: top.map(t => t.id) } },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => { /* non-critical */ });
  }

  return top;
}
