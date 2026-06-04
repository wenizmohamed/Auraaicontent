// Memory enricher — retrieves the most relevant LEARNINGS (corrections,
// preferences, patterns, failures to avoid) for a request and prepends them to
// the prompt, so every AI generation applies what the system learned from past
// interactions with this org/client.
//
// Sibling to knowledge-enricher.ts: same best-effort, string-in/string-out
// contract, never blocks or breaks an AI call. Difference in source — this pulls
// from the Memory table (experiential) rather than KnowledgeChunk (documents).
//
// Cost/latency guard: skips the query-embedding round-trip entirely for orgs
// with zero active memories (the common case until signals accumulate), so only
// orgs that have actually learned something pay for retrieval.

import { db } from '../db/prisma.js';
import { retrieveMemories } from '../services/memory.service.js';
import { recordGated, recordRan, recordFailed } from './enrichment-stats.js';

const MEM_CAP = 4;          // max learnings injected (token-budget guard)
const MEM_CHAR_CAP = 400;   // trim each learning to bound context-window pressure
const MIN_SCORE = 0.55;     // cosine*weight floor; mirrors knowledge-enricher

export interface MemoryEnrichOpts {
  skip?: boolean;
}

export async function enrichWithMemory(
  prompt: string,
  orgId: string | undefined | null,
  clientId: string | undefined | null,
  retrievalQuery: string,
  opts: MemoryEnrichOpts = {},
): Promise<string> {
  if (opts.skip || !orgId || !prompt || !retrievalQuery) { recordGated('memory'); return prompt; }

  // Cheap gate: don't pay for a query-embedding if the org has no learnings yet.
  try {
    const count = await db.memory.count({ where: { orgId, status: 'active' } });
    if (count === 0) { recordGated('memory'); return prompt; }
  } catch (err: any) {
    console.warn('[memory-enricher] count failed:', err?.message || err);
    recordFailed('memory');
    return prompt;
  }

  let hits: { content: string; kind: string; score: number }[];
  try {
    hits = await retrieveMemories(orgId, clientId, retrievalQuery, MEM_CAP, MIN_SCORE);
  } catch (err: any) {
    console.warn('[memory-enricher] retrieval failed:', err?.message || err);
    recordFailed('memory');
    return prompt;
  }

  const relevant = hits.filter(h => h.content?.trim()).slice(0, MEM_CAP);
  recordRan('memory', relevant.length);
  if (!relevant.length) return prompt;

  const lines: string[] = ['[LEARNED FROM PAST FEEDBACK — apply these corrections/preferences]'];
  relevant.forEach((h, i) => {
    lines.push(`(${i + 1}) [${h.kind}] ${h.content.trim().slice(0, MEM_CHAR_CAP)}`);
  });
  lines.push('[/LEARNED FROM PAST FEEDBACK]');

  return `${lines.join('\n')}\n${prompt}`;
}
