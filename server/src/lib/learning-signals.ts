// Learning-signal capture — the write half of the self-evolution loop.
//
// The read half (lib/memory-enricher.ts) injects past learnings into every AI
// prompt. This module records the signals those learnings come from: what a
// human changed, approved, or rejected on generated content. Every edit becomes
// a weighted Memory row; the next generation for this org/client reads it back.
//
// Design rules:
// - best-effort ONLY: never throws, never blocks the route, never 500s a save
// - small, factual content strings (what changed, not why we think so)
// - corrections weigh more than approvals (a human rewrite is the loudest signal)
import { recordMemory } from '../services/memory.service.js';

interface SignalContext {
  orgId: string;
  userId?: string;
  clientId?: string | null;
}

const trim = (s: unknown, n = 280): string =>
  typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '';

// Fields whose human rewrite is a real correction signal (not metadata churn).
const CONTENT_FIELDS = new Set(['title', 'caption', 'hashtags', 'keyMessage', 'hook', 'cta']);

export async function capturePostLearning(
  before: Record<string, unknown>,
  updates: Record<string, unknown>,
  ctx: SignalContext,
): Promise<void> {
  try {
    const platform = String(updates.platform ?? before.platform ?? '');
    const pillar = String(updates.pillar ?? before.pillar ?? '');
    const where = `platform=${platform || '?'} pillar=${pillar || '?'}`;

    // 1. Status transitions = verdict signals on the whole post.
    const newStatus = typeof updates.status === 'string' ? updates.status : undefined;
    if (newStatus && newStatus !== before.status) {
      if (newStatus === 'approved') {
        await recordMemory({
          orgId: ctx.orgId, userId: ctx.userId, clientId: ctx.clientId,
          kind: 'success', source: 'edit',
          content: `Approved as-is: "${trim(before.title, 120)}" (${where}). This content pattern was accepted without edits.`,
          context: 'calendar-post-review', weight: 1,
          metadata: { postId: before.id, status: newStatus },
        });
      } else if (newStatus === 'rejected' || newStatus === 'changes_requested') {
        await recordMemory({
          orgId: ctx.orgId, userId: ctx.userId, clientId: ctx.clientId,
          kind: 'failure', source: 'rejection',
          content: `Rejected: "${trim(before.title, 120)}" (${where}). Caption was: "${trim(before.caption, 200)}". Avoid this pattern.`,
          context: 'calendar-post-review', weight: 1.5,
          metadata: { postId: before.id, status: newStatus },
        });
      }
    }

    // 2. Content field edits = correction signals (the strongest one).
    for (const field of Object.keys(updates)) {
      if (!CONTENT_FIELDS.has(field)) continue;
      const from = trim(before[field], 200);
      const to = trim(updates[field], 200);
      if (!to || from === to) continue;
      await recordMemory({
        orgId: ctx.orgId, userId: ctx.userId, clientId: ctx.clientId,
        kind: 'correction', source: 'edit',
        content: `Human rewrote ${field} on "${trim(before.title, 100)}" (${where}). AI wrote: "${from}". Human preferred: "${to}". Match the human version next time.`,
        context: 'calendar-post-edit', weight: 2,
        metadata: { postId: before.id, field },
      });
    }
  } catch (err: any) {
    console.warn('[learning-signals] capture failed (non-fatal):', err?.message || err);
  }
}
