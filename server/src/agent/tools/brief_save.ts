import { defineTool } from '../tool-types.js';
import { briefService, normalizeMonth } from '../../services/brief.service.js';

// Creates or updates a client brief (optionally for one month). Before this
// tool existed the agent could only READ briefs, so "create a campaign brief"
// had no honest path: it wrote the brief into the chat, or generated a month of
// posts instead, and reported success (sessions 2026-08-27).

interface Campaign {
  name: string;
  targetAudience?: string;
  objective?: string;
  keyMessage?: string;
  productFocus?: string;
}

interface Moment {
  name: string;
  date?: string;
}

interface Args {
  clientId?: string;
  month?: string;
  objective?: string;
  audience?: string;
  tone?: string;
  brandDo?: string;
  brandDont?: string;
  products?: string[];
  pillars?: string[];
  channels?: string[];
  campaigns?: Campaign[];
  campaignMoments?: Moment[];
  visualLookFeel?: string;
  mandatoryInclusions?: string;
  complianceNotes?: string;
  cadence?: string;
  seasonalNotes?: string;
  competitors?: string;
  successDefinition?: string;
}

interface Result {
  briefId: string;
  clientId: string;
  clientName: string;
  month: string;
  created: boolean;
  fieldsSaved: string[];
  note: string;
}

const TEXT_FIELDS = [
  'objective', 'audience', 'tone', 'brandDo', 'brandDont', 'visualLookFeel',
  'mandatoryInclusions', 'complianceNotes', 'cadence', 'seasonalNotes',
  'competitors', 'successDefinition',
] as const;
const LIST_FIELDS = ['products', 'pillars', 'channels'] as const;
// Columns that are NOT NULL on ClientBrief and so need a value on create.
const REQUIRED_TEXT = ['objective', 'audience', 'tone', 'brandDo', 'brandDont'] as const;

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => s.length > 0);
}

export const tool = defineTool<Args, Result>({
  name: 'brief_save',
  description:
    'Create or update a client brief and save it to the database (visible on /brief). ' +
    'Pass month as YYYY-MM for a month or campaign brief; omit month for the client default brief. ' +
    'Only the fields you pass are written, so an update never wipes the rest of an existing brief. ' +
    'Use this whenever the user asks to create, write, draft, fill in or change a brief or campaign brief.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'Client id; falls back to the active client' },
      month: { type: 'string', description: 'YYYY-MM for a month brief. Omit for the default brief' },
      objective: { type: 'string', description: 'What the content must achieve' },
      audience: { type: 'string', description: 'Who it is for' },
      tone: { type: 'string', description: 'Voice and tone' },
      brandDo: { type: 'string', description: 'Brand do rules' },
      brandDont: { type: 'string', description: 'Brand do-not rules' },
      products: { type: 'array', items: { type: 'string' }, description: 'Products or services in focus' },
      pillars: { type: 'array', items: { type: 'string' }, description: 'Content pillars' },
      channels: { type: 'array', items: { type: 'string' }, description: 'Channels, e.g. Instagram, TikTok, LinkedIn' },
      campaigns: {
        type: 'array',
        description: 'One entry per campaign',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            targetAudience: { type: 'string' },
            objective: { type: 'string' },
            keyMessage: { type: 'string' },
            productFocus: { type: 'string' },
          },
          required: ['name'],
        },
      },
      campaignMoments: {
        type: 'array',
        description: 'Special occasions and key dates',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, date: { type: 'string' } },
          required: ['name'],
        },
      },
      visualLookFeel: { type: 'string', description: 'Visual direction in words' },
      mandatoryInclusions: { type: 'string' },
      complianceNotes: { type: 'string' },
      cadence: { type: 'string', description: 'Posting cadence' },
      seasonalNotes: { type: 'string' },
      competitors: { type: 'string' },
      successDefinition: { type: 'string' },
    },
    additionalProperties: false,
  },

  async handler(args, ctx) {
    if (ctx.signal.aborted) throw new Error('brief_save aborted');

    const clientId = args.clientId || ctx.clientId;
    if (!clientId) {
      throw new Error('brief_save needs a client. Ask the user which client, or call client_switch first.');
    }
    const client = await ctx.prisma.client.findUnique({ where: { id: clientId, orgId: ctx.orgId } });
    if (!client) throw new Error(`Client ${clientId} not found`);

    const month = normalizeMonth(args.month);
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`month "${args.month}" is not a month. Use YYYY-MM, e.g. 2026-10.`);
    }

    const data: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) {
      const v = args[f];
      if (typeof v === 'string' && v.trim()) data[f] = v.trim();
    }
    for (const f of LIST_FIELDS) {
      const list = cleanList(args[f]);
      if (list.length) data[f] = list;
    }
    if (Array.isArray(args.campaigns)) {
      const campaigns = args.campaigns
        .filter((c) => c && typeof c.name === 'string' && c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          targetAudience: c.targetAudience?.trim() || '',
          objective: c.objective?.trim() || '',
          keyMessage: c.keyMessage?.trim() || '',
          productFocus: c.productFocus?.trim() || '',
        }));
      if (campaigns.length) data.campaigns = campaigns;
    }
    if (Array.isArray(args.campaignMoments)) {
      const moments = args.campaignMoments
        .filter((m) => m && typeof m.name === 'string' && m.name.trim())
        .map((m) => ({ name: m.name.trim(), date: m.date?.trim() || '' }));
      if (moments.length) data.campaignMoments = moments;
    }

    const fieldsSaved = Object.keys(data);
    if (fieldsSaved.length === 0) {
      throw new Error('brief_save was called with no brief content. Pass at least objective, audience and tone.');
    }

    const existing = await ctx.prisma.clientBrief.findFirst({
      where: { clientId, orgId: ctx.orgId, month },
      select: { id: true },
    });

    if (!existing) {
      const missing = REQUIRED_TEXT.filter((f) => f !== 'brandDo' && f !== 'brandDont' && !data[f]);
      if (missing.length) {
        throw new Error(
          `A new brief needs ${missing.join(', ')}. Fill ${missing.length === 1 ? 'it' : 'them'} from the user's request and the client's knowledge, or ask the user.`,
        );
      }
      // NOT NULL columns the caller did not supply.
      for (const f of REQUIRED_TEXT) if (data[f] === undefined) data[f] = '';
      for (const f of ['products', 'pillars', 'channels', 'campaignMoments', 'approvers']) {
        if (data[f] === undefined) data[f] = [];
      }
    }

    await ctx.emit('agent:thought', {
      text: `${existing ? 'Updating' : 'Saving'} the ${month || 'default'} brief for ${client.name}…`,
      at: new Date().toISOString(),
    });

    // Update in place when the brief exists: an upsert validates its create
    // payload even on the update path, so a partial edit (tone only) would be
    // rejected for missing the other required columns.
    const row = existing
      ? await ctx.prisma.clientBrief.update({ where: { id: existing.id, orgId: ctx.orgId }, data })
      : await briefService.upsert(ctx.orgId, clientId, data, month);

    return {
      briefId: row.id,
      clientId,
      clientName: client.name,
      month,
      created: !existing,
      fieldsSaved,
      note: `Brief ${existing ? 'updated' : 'created'} for ${client.name}${month ? ` (${month})` : ''}. Visible on /brief.`,
    };
  },
});
