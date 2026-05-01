import { defineTool } from '../tool-types.js';

interface Args {
  clientSlug?: string;
  clientId?: string;
}

interface ClientBriefSummary {
  objective: string;
  audience: string;
  tone: string;
  brandDo: string;
  brandDont: string;
  channels: unknown;
  cadence: string | null;
}

interface ClientListItem {
  id: string;
  name: string;
  slug: string;
}

interface RecentMonth {
  id: string;
  month: string;
  status: string;
}

interface SwitchResult {
  mode: 'switched' | 'list';
  clientId?: string;
  name?: string;
  slug?: string;
  brief?: ClientBriefSummary | null;
  recentMonths?: RecentMonth[];
  clients?: ClientListItem[];
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('AbortError: client_switch cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

export const tool = defineTool<Args, SwitchResult>({
  name: 'client_switch',
  description:
    'Resolve and switch the active client context for the agent session. ' +
    'Pass either clientSlug OR clientId to select a client (returns brief summary + last 3 calendar months). ' +
    'Pass no args to list all available clients. Downstream tools read ctx.clientId — ' +
    'the caller should thread the returned clientId into subsequent tool args.',
  input_schema: {
    type: 'object',
    properties: {
      clientSlug: { type: 'string', description: 'Client slug (e.g. "al-fardan-exchange")' },
      clientId: { type: 'string', description: 'Client cuid — use if slug is unknown' },
    },
    additionalProperties: false,
  },

  async handler(args, ctx) {
    checkAbort(ctx.signal);

    const hasSlug = typeof args.clientSlug === 'string' && args.clientSlug.trim().length > 0;
    const hasId = typeof args.clientId === 'string' && args.clientId.trim().length > 0;

    if (!hasSlug && !hasId) {
      const clients = await ctx.prisma.client.findMany({
        where: { orgId: ctx.orgId },
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      });
      await ctx.emit('agent:thought', {
        text: `Listed ${clients.length} clients (no selection made).`,
        at: new Date().toISOString(),
      });
      return { mode: 'list', clients };
    }

    checkAbort(ctx.signal);

    const client = hasId
      ? await ctx.prisma.client.findUnique({
          where: { id: args.clientId as string, orgId: ctx.orgId },
          include: {
            brief: true,
            calendarMonths: {
              orderBy: { updatedAt: 'desc' },
              take: 3,
              select: { id: true, month: true, status: true },
            },
          },
        })
      : await ctx.prisma.client.findUnique({
          where: { orgId_slug: { orgId: ctx.orgId, slug: args.clientSlug as string } },
          include: {
            brief: true,
            calendarMonths: {
              orderBy: { updatedAt: 'desc' },
              take: 3,
              select: { id: true, month: true, status: true },
            },
          },
        });

    if (!client) {
      const which = hasSlug ? args.clientSlug : args.clientId;
      throw new Error(`Client not found: ${which}`);
    }

    const brief: ClientBriefSummary | null = client.brief
      ? {
          objective: client.brief.objective,
          audience: client.brief.audience,
          tone: client.brief.tone,
          brandDo: client.brief.brandDo,
          brandDont: client.brief.brandDont,
          channels: client.brief.channels,
          cadence: client.brief.cadence,
        }
      : null;

    // Persist the active-client pointer onto the AgentSession so downstream
    // turns resolve ctx.clientId even if the caller forgets to thread it.
    try {
      await ctx.prisma.agentSession.update({
        where: { id: ctx.sessionId, orgId: ctx.orgId },
        data: { clientId: client.id },
      });
    } catch {
      // Session row missing in dev — continue; caller still gets clientId back.
    }

    await ctx.emit('agent:thought', {
      text: `Switched to ${client.name} (${client.slug})`,
      at: new Date().toISOString(),
    });

    return {
      mode: 'switched',
      clientId: client.id,
      name: client.name,
      slug: client.slug,
      brief,
      recentMonths: client.calendarMonths.map((m: any) => ({
        id: m.id,
        month: m.month,
        status: m.status,
      })),
    };
  },
});
