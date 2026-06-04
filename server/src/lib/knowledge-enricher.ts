// Knowledge enricher — retrieves the most relevant Knowledge-base chunks for a
// request and prepends them to the prompt, so every AI generation is grounded in
// the client's own documents (brand guidelines, past briefs, product facts).
//
// This wires the already-built RAG (retrieval.service.retrieveContext — Gemini
// query-embedding + in-memory cosine over cached chunk embeddings) into the
// UNIVERSAL ai-router path. Previously retrieveContext was only used by the
// brief_analyze agent tool, so normal text/analysis generations never saw it.
//
// Mirrors brand-kit-enricher's contract: pure string-in/string-out, best-effort,
// never blocks or breaks an AI call. Failure / no-knowledge / no-embeddings all
// no-op (return the prompt unchanged).
//
// Cost/latency guard: skips the Gemini query-embedding round-trip entirely for
// clients that have no KnowledgeItems (the common case), so only clients who
// actually uploaded knowledge pay for retrieval.
//
// NOTE: depends on KnowledgeChunk.metadata.embedding being populated by the
// embeddings worker (workers/embeddings.worker.ts). If embeddings are absent,
// retrieveContext returns [] and this is a silent no-op — verify with a live
// retrieveContext call against a real client before trusting it in prod.

import { db } from '../db/prisma.js';
import { retrieveContext } from '../services/retrieval.service.js';
import { recordGated, recordRan, recordFailed } from './enrichment-stats.js';

const CHUNK_CAP = 4;          // max chunks injected (token-budget guard)
const CHUNK_CHAR_CAP = 600;   // trim each chunk to bound context-window pressure
const MIN_SCORE = 0.55;       // cosine floor; tuned conservatively. Set from real
                              // scores once embeddings are confirmed populated.

export interface KnowledgeEnrichOpts {
  skip?: boolean;
}

export async function enrichWithKnowledge(
  prompt: string,
  orgId: string | undefined | null,
  clientId: string | undefined | null,
  retrievalQuery: string,
  opts: KnowledgeEnrichOpts = {},
): Promise<string> {
  if (opts.skip || !orgId || !clientId || !prompt || !retrievalQuery) { recordGated('knowledge'); return prompt; }

  // Cheap gate: don't pay for a query-embedding if the client has no knowledge.
  try {
    const count = await db.knowledgeItem.count({ where: { orgId, clientId } });
    if (count === 0) { recordGated('knowledge'); return prompt; }
  } catch (err: any) {
    console.warn('[knowledge-enricher] count failed:', err?.message || err);
    recordFailed('knowledge');
    return prompt;
  }

  let hits: { text: string; score: number; knowledgeItemId: string }[];
  try {
    hits = await retrieveContext(orgId, clientId, retrievalQuery, CHUNK_CAP * 2);
  } catch (err: any) {
    console.warn('[knowledge-enricher] retrieval failed:', err?.message || err);
    recordFailed('knowledge');
    return prompt;
  }

  const relevant = hits
    .filter(h => h.score >= MIN_SCORE && h.text?.trim())
    .slice(0, CHUNK_CAP);
  recordRan('knowledge', relevant.length);
  if (!relevant.length) return prompt;

  const lines: string[] = ['[KNOWLEDGE BASE — retrieved for this request]'];
  relevant.forEach((h, i) => {
    lines.push(`(${i + 1}) ${h.text.trim().slice(0, CHUNK_CHAR_CAP)}`);
  });
  lines.push('[/KNOWLEDGE BASE]');

  return `${lines.join('\n')}\n${prompt}`;
}
