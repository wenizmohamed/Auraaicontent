import { defineTool } from '../tool-types.js';
import { briefService } from '../../services/brief.service.js';

interface Args {
  clientId: string;
  month?: string;
  overrideBrief?: string;
}

interface NormalizedBrief {
  objective: string;
  audience: string;
  tone: string;
  platforms: string[];
  mandatoryInclusions: string;
  complianceNotes: string;
  competitors: string;
  pillars: string[];
}

interface Result {
  brief: NormalizedBrief;
  knowledgeItemCount: number;
  clientName: string;
}

function now(): string {
  return new Date().toISOString();
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('brief_analyze aborted');
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v !== null && 'name' in v ? String((v as { name: unknown }).name) : ''))
      .filter((s) => s.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

export const tool = defineTool<Args, Result>({
  name: 'brief_analyze',
  description: 'Load a client brief and enrich it with knowledge-item context into a normalized planning brief.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'Client UUID' },
      month: { type: 'string', description: 'YYYY-MM. Loads that month\'s brief when one exists, else the client default brief' },
      overrideBrief: { type: 'string', description: 'Optional objective override' },
    },
    required: ['clientId'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    assertNotAborted(ctx.signal);

    // Knowledge is loaded through BOUNDED SQL only. Maxwax carries 1,680 items
    // whose textContent totals 277 MB (max 7.8 MB) and 7,111 chunks of up to
    // 4.4 MB: any Prisma include of chunks or textContent pulls the lot and
    // crashes the engine ("Failed to convert rust String into napi string",
    // 3 of 5 runs on 2026-10-17). Snippets are cut to 400 chars in the DB.
    const client = await ctx.prisma.client.findUnique({
      where: { id: args.clientId, orgId: ctx.orgId },
      include: { briefs: { orderBy: { month: 'asc' }, take: 1 }, _count: { select: { knowledgeItems: true } } },
    });

    if (!client) {
      throw new Error(`Client ${args.clientId} not found`);
    }
    await ctx.emit('agent:thought', {
      text: `Reading brief for ${client.name}\u2026`,
      at: now(),
    });

    assertNotAborted(ctx.signal);

    // Month-aware: the month's own brief when present, else the default brief,
    // else the most recent one (same resolution the rest of the app uses).
    const briefRow: any = await briefService.getByClientId(ctx.orgId, client.id, args.month);
    if (!briefRow) {
      throw new Error(
        `${client.name} has no saved brief yet. If the user asked for a brief, write one from their request and the client's knowledge and save it with brief_save. Otherwise ask the user for the objective, audience and tone. Do not switch to another client.`,
      );
    }

    const knowledgeItemCount = client._count.knowledgeItems;
    await ctx.emit('agent:thought', {
      text: `Found ${knowledgeItemCount} knowledge item${knowledgeItemCount === 1 ? '' : 's'}.`,
      at: now(),
    });

    // Newest 40 items, opening 400 chars each; items without extracted text
    // fall back to the first two chunks (also cut in the DB).
    const items: { id: string; snippet: string | null }[] = await ctx.prisma.$queryRawUnsafe(
      `SELECT id, left("textContent", 400) AS snippet FROM "KnowledgeItem"
        WHERE "clientId" = $1 AND "orgId" = $2 ORDER BY "createdAt" DESC LIMIT 40`,
      client.id, ctx.orgId,
    );
    const noText = items.filter((i) => !i.snippet || !i.snippet.trim()).map((i) => i.id);
    const chunkRows: { knowledgeItemId: string; snippet: string }[] = noText.length
      ? await ctx.prisma.$queryRawUnsafe(
          `SELECT "knowledgeItemId", left("chunkText", 400) AS snippet
             FROM (SELECT "knowledgeItemId", "chunkText",
                          row_number() OVER (PARTITION BY "knowledgeItemId" ORDER BY "id") AS rn
                     FROM "KnowledgeChunk" WHERE "orgId" = $1 AND "knowledgeItemId" = ANY($2::text[])) t
            WHERE rn <= 2 LIMIT 24`,
          ctx.orgId, noText,
        )
      : [];
    const knowledgeSnippets = items
      .flatMap((item) => item.snippet && item.snippet.trim()
        ? [item.snippet.trim()]
        : chunkRows.filter((r) => r.knowledgeItemId === item.id).map((r) => r.snippet))
      .filter((t) => t && t.length > 0)
      .slice(0, 12);

    const objective = args.overrideBrief && args.overrideBrief.trim().length > 0
      ? args.overrideBrief.trim()
      : briefRow.objective;

    const enrichedObjective = knowledgeSnippets.length > 0
      ? `${objective}\n\n[Knowledge context]\n- ${knowledgeSnippets.join('\n- ')}`
      : objective;

    const brief: NormalizedBrief = {
      objective: enrichedObjective,
      audience: briefRow.audience,
      tone: briefRow.tone,
      platforms: toStringArray(briefRow.channels),
      mandatoryInclusions: briefRow.mandatoryInclusions ?? '',
      complianceNotes: briefRow.complianceNotes ?? '',
      competitors: briefRow.competitors ?? '',
      pillars: toStringArray(briefRow.pillars),
    };

    return {
      brief,
      knowledgeItemCount,
      clientName: client.name,
    };
  },
});

export type { NormalizedBrief };
