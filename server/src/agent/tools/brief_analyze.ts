import { defineTool } from '../tool-types.js';

interface Args {
  clientId: string;
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
      overrideBrief: { type: 'string', description: 'Optional objective override' },
    },
    required: ['clientId'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    assertNotAborted(ctx.signal);

    const client = await ctx.prisma.client.findUnique({
      where: { id: args.clientId, orgId: ctx.orgId },
      include: { briefs: { orderBy: { month: 'asc' }, take: 1 }, knowledgeItems: { include: { chunks: true } } },
    });

    if (!client) {
      throw new Error(`Client ${args.clientId} not found`);
    }
    await ctx.emit('agent:thought', {
      text: `Reading brief for ${client.name}\u2026`,
      at: now(),
    });

    assertNotAborted(ctx.signal);

    const briefRow = (client as any).briefs?.[0] ?? null;
    if (!briefRow) {
      throw new Error(`Client ${client.name} has no ClientBrief row`);
    }

    const knowledgeItemCount = client.knowledgeItems.length;
    await ctx.emit('agent:thought', {
      text: `Found ${knowledgeItemCount} knowledge item${knowledgeItemCount === 1 ? '' : 's'}.`,
      at: now(),
    });

    const knowledgeSnippets = client.knowledgeItems
      .flatMap((item: any) => {
        if (item.textContent && item.textContent.length > 0) {
          return [item.textContent.slice(0, 400)];
        }
        return item.chunks.slice(0, 2).map((c: any) => c.chunkText.slice(0, 400));
      })
      .filter((s: any) => s.length > 0)
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
