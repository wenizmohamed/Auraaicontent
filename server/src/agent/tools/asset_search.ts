// asset_search -- find existing brand assets for a client (read-only).
//
// Before this tool the agent could only GENERATE new images; it had no view
// of the assets a client already uploaded and approved, so it burned cost and
// drifted off-brand. asset_search returns id, name, fileUrl, thumbUrl, tags
// and createdAt so the agent can reuse real assets (attach to posts, feed as
// image references) instead of always generating.
//
// Read-only: no writes, no LLM calls. Every query is scoped by ctx.orgId.
// Failure modes (missing client, client not in org, DB error) come back as a
// plain { error } object. Only user aborts throw.
//
// Matching runs in JS over a recent window of rows because `tags` is a Json
// column with inconsistent shapes (string[] most of the time, occasionally a
// comma string); Prisma Json filters are too brittle for that.

import { defineTool } from '../tool-types.js';

interface Args {
  clientId?: string;
  query?: string;
  tags?: string[];
  limit?: number;
}

interface AssetSummary {
  id: string;
  name: string;
  fileUrl: string;
  thumbUrl: string | null;
  mimeType: string;
  tags: string[];
  createdAt: string; // ISO
}

interface Result {
  clientId?: string;
  clientName?: string;
  assets: AssetSummary[];
  total: number; // matches found (before the limit was applied)
  note?: string;
  error?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// How many recent rows we pull before matching in JS. Keeps a single bounded
// query regardless of filter shape.
const SCAN_WINDOW = 200;
const MAX_TAGS_RETURNED = 10;

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('AbortError: asset_search cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

// tags is a Json column: usually string[], sometimes a comma/space string.
function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((s) => s.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

export const tool = defineTool<Args, Result>({
  name: 'asset_search',
  description:
    'Search the client\'s existing uploaded assets (read-only) so approved brand imagery can be reused instead of ' +
    'generating new images. Matches the query against asset names and tags; optional tags filter narrows to assets ' +
    'carrying at least one of them. Empty query returns the most recent assets. Returns id, name, fileUrl, thumbUrl, ' +
    'mimeType, tags and createdAt.',
  input_schema: {
    type: 'object',
    properties: {
      clientId: { type: 'string', description: 'Client id. Defaults to the session\'s active client.' },
      query: { type: 'string', description: 'Free-text search over asset names and tags. Omit for most recent assets.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Keep only assets carrying at least one of these tags.' },
      limit: { type: 'number', description: `Max assets to return (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}).` },
    },
    additionalProperties: false,
  },

  async handler(args, ctx) {
    checkAbort(ctx.signal);

    const clientId = (typeof args.clientId === 'string' && args.clientId.trim().length > 0)
      ? args.clientId.trim()
      : ctx.clientId ?? null;
    if (!clientId) {
      return {
        assets: [],
        total: 0,
        error: 'No clientId given and no active client in this session. Pass clientId or run client_switch first.',
      };
    }

    const limit = clampLimit(args.limit);
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const wantedTags = Array.isArray(args.tags)
      ? args.tags.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : '')).filter((t) => t.length > 0)
      : [];

    try {
      const client = await ctx.prisma.client.findUnique({
        where: { id: clientId, orgId: ctx.orgId },
        select: { id: true, name: true },
      });
      if (!client) {
        return { assets: [], total: 0, error: `Client ${clientId} not found in this organization.` };
      }

      checkAbort(ctx.signal);

      const rows = await ctx.prisma.asset.findMany({
        where: { orgId: ctx.orgId, clientId: client.id },
        select: {
          id: true,
          name: true,
          fileUrl: true,
          thumbUrl: true,
          mimeType: true,
          tags: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: SCAN_WINDOW,
      });

      const candidates = rows.map((r) => ({ row: r, tagList: toTagArray(r.tags) }));

      const matched = candidates.filter(({ row, tagList }) => {
        if (query.length > 0) {
          const inName = row.name.toLowerCase().includes(query);
          const inTags = tagList.some((t) => t.toLowerCase().includes(query));
          if (!inName && !inTags) return false;
        }
        if (wantedTags.length > 0) {
          const lower = tagList.map((t) => t.toLowerCase());
          if (!wantedTags.some((w) => lower.some((t) => t.includes(w)))) return false;
        }
        return true;
      });

      const assets: AssetSummary[] = matched.slice(0, limit).map(({ row, tagList }) => ({
        id: row.id,
        name: row.name,
        fileUrl: row.fileUrl,
        thumbUrl: row.thumbUrl,
        mimeType: row.mimeType,
        tags: tagList.slice(0, MAX_TAGS_RETURNED),
        createdAt: row.createdAt.toISOString(),
      }));

      let note: string | undefined;
      if (rows.length === 0) {
        note = `${client.name} has no uploaded assets yet. Use image_generate to create one.`;
      } else if (assets.length === 0) {
        note = `No assets matched${query ? ` query "${query}"` : ''}${wantedTags.length > 0 ? ` tags [${wantedTags.join(', ')}]` : ''}. ${rows.length} recent asset${rows.length === 1 ? '' : 's'} exist for this client; retry with a broader query.`;
      } else if (query.length === 0 && wantedTags.length === 0) {
        note = 'No query given; returned the most recent assets.';
      }

      await ctx.emit('agent:thought', {
        text: `Asset search for ${client.name}: ${assets.length} of ${matched.length} match${matched.length === 1 ? '' : 'es'} returned.`,
        at: new Date().toISOString(),
      });

      return {
        clientId: client.id,
        clientName: client.name,
        assets,
        total: matched.length,
        note,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      return {
        assets: [],
        total: 0,
        error: `Asset search failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
