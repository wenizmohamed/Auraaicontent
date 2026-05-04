import { db } from '../db/prisma.js';

export type GenerationType =
  | 'image'
  | 'video'
  | 'text'
  | 'research'
  | 'brand_synthesis'
  | 'analyze'
  | 'design';

export interface RecordGenerationInput {
  orgId: string | undefined;
  userId?: string;
  clientId?: string;
  type: GenerationType;
  surface?: string;       // 'creative_tools' | 'studio' | 'research' | etc.
  prompt: string;
  outputUrl?: string | null;
  outputText?: string | null;
  thumbnailUrl?: string | null;
  provider?: string | null;
  model?: string | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  status?: 'succeeded' | 'failed';
  error?: string | null;
  metadata?: Record<string, any> | null;
}

const TEXT_CAP = 50_000;
const PROMPT_CAP = 8_000;

/**
 * Best-effort write to the Generation history table. Never throws — a
 * history failure must NOT break the underlying AI call.
 *
 * Returns the created row id, or null if skipped (no orgId, or write failed).
 */
export const historyService = {
  async record(input: RecordGenerationInput): Promise<string | null> {
    if (!input.orgId) return null;
    try {
      const row = await db.generation.create({
        data: {
          orgId: input.orgId,
          userId: input.userId || null,
          clientId: input.clientId || null,
          type: input.type,
          surface: input.surface || null,
          prompt: (input.prompt || '').slice(0, PROMPT_CAP),
          outputUrl: input.outputUrl || null,
          outputText: input.outputText ? String(input.outputText).slice(0, TEXT_CAP) : null,
          thumbnailUrl: input.thumbnailUrl || null,
          provider: input.provider || null,
          model: input.model || null,
          costUsd: input.costUsd != null ? input.costUsd : null,
          latencyMs: input.latencyMs != null ? Math.round(input.latencyMs) : null,
          status: input.status || 'succeeded',
          error: input.error || null,
          metadata: input.metadata || undefined,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err: any) {
      console.error('[history.record] failed:', err?.message || err);
      return null;
    }
  },
};
