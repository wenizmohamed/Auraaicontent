// web_research -- research a topic so the agent can ground a plan in
// something current, not just a named competitor's feed.
//
// Reuses the exact capability behind POST /api/research (routes/research.ts):
// aiRouter.text() with the same structured-summary + anti-fabrication prompt
// contract, then verifySources() (source-verify.service.ts, Habiba 2026-07-14)
// so the agent never cites a dead or hallucinated URL. Model-emitted URLs are
// additionally filtered through assertPublicHttpUrl (upscale.service.ts)
// BEFORE the verifier fetches them: verifySources fetches server-side, so a
// prompt-injected loopback/LAN URL would otherwise double as an SSRF probe.
//
// Contract with the loop: never throws. Empty query, provider failure and
// zero results all come back as plain objects the model can read and act on.

import { defineTool } from '../tool-types.js';
import { aiRouter } from '../../services/providers/ai-router.js';
import { verifySources, type RawSource } from '../../services/source-verify.service.js';
import { assertPublicHttpUrl } from '../../services/upscale.service.js';

type Depth = 'quick' | 'deep';

interface Args {
  query: string;
  depth?: Depth;
  maxSources?: number;
}

interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
  verified: boolean;
}

interface Result {
  query: string;
  summary: string;
  findings: string[];
  sources: ResearchSource[];
  note?: string;
  error?: string;
}

function empty(query: string, error?: string, note?: string): Result {
  return { query, summary: '', findings: [], sources: [], ...(error ? { error } : {}), ...(note ? { note } : {}) };
}

// Same prompt contract as routes/research.ts so both surfaces behave
// identically. Kept inline (not exported from the route) because routes
// register Fastify hooks on import.
function buildPrompt(query: string, isDeep: boolean, maxSources: number): string {
  return [
    `You are a senior research analyst. Research this topic and return a structured summary.`,
    ``,
    `Topic: "${query}"`,
    ``,
    `Return a JSON object with this exact shape:`,
    `{`,
    `  "summary": "2-3 sentence summary of the topic",`,
    `  "keyPoints": ["bullet 1", "bullet 2", ...],  // ${isDeep ? '8-12' : '5-8'} items`,
    `  "sources": [`,
    `    { "title": "Source title", "url": "https://...", "snippet": "1-sentence excerpt" },`,
    `    ...  // up to ${maxSources} items`,
    `  ]`,
    `}`,
    ``,
    `CRITICAL: Only cite URLs you are highly confident actually exist. NEVER invent, guess, or approximate a URL. Prefer well-known primary sources (official sites, major publications, reports). If you cannot ground a claim in a real source, omit the source rather than fabricate one; an empty sources array is acceptable.`,
    `Return ONLY the JSON, no commentary.`,
  ].join('\n');
}

export const tool = defineTool<Args, Result>({
  name: 'web_research',
  description:
    'Research a topic and return a compact summary, key findings, and verified source URLs. ' +
    'Use to ground plans, briefs, and content in current information (trends, market context, events). ' +
    'Every returned source URL has been checked to actually resolve; sources may be empty when nothing could be verified.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Topic or question to research.' },
      depth: {
        type: 'string',
        enum: ['quick', 'deep'],
        description: 'quick (default) returns 5-8 findings; deep returns 8-12 findings with more sources.',
      },
      maxSources: { type: 'number', description: 'Cap on cited sources, 1-10 (default 5 quick / 8 deep).' },
    },
    required: ['query'],
    additionalProperties: false,
  },

  async handler(args, ctx) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    try {
      if (ctx.signal.aborted) return empty(query, 'web_research cancelled');
      if (!query) return empty('', 'query is required and must be a non-empty string');

      const isDeep = args.depth === 'deep';
      const maxSources = Math.max(1, Math.min(Math.floor(args.maxSources ?? (isDeep ? 8 : 5)), 10));

      await ctx.emit('agent:thought', {
        text: `Researching "${query.slice(0, 120)}" (${isDeep ? 'deep' : 'quick'})`,
        at: new Date().toISOString(),
      });

      let output: unknown;
      try {
        const res = await aiRouter.text(
          { prompt: buildPrompt(query, isDeep, maxSources), json: true },
          {
            orgId: ctx.orgId,
            userId: ctx.userId ?? undefined,
            clientId: ctx.clientId ?? undefined,
            jobId: ctx.sessionId,
          },
        );
        output = res.output;
      } catch (err) {
        return empty(
          query,
          `Research provider failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Retry with a narrower query, or proceed without web grounding and say so.`,
        );
      }
      if (ctx.signal.aborted) return empty(query, 'web_research cancelled');

      // Tolerate non-conforming model output (same salvage as routes/research.ts).
      const out = output as { summary?: unknown; keyPoints?: unknown; sources?: unknown } | string | null;
      const summary =
        typeof (out as { summary?: unknown })?.summary === 'string'
          ? ((out as { summary: string }).summary)
          : typeof out === 'string'
            ? out
            : '';
      const findings = (Array.isArray((out as { keyPoints?: unknown })?.keyPoints)
        ? ((out as { keyPoints: unknown[] }).keyPoints)
        : [])
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .slice(0, isDeep ? 12 : 8)
        .map((p) => p.slice(0, 300));

      const rawSources: RawSource[] = (Array.isArray((out as { sources?: unknown })?.sources)
        ? ((out as { sources: unknown[] }).sources)
        : [])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          title: typeof s.title === 'string' ? s.title.slice(0, 150) : 'Untitled',
          url: typeof s.url === 'string' ? s.url : '',
          snippet: typeof s.snippet === 'string' ? s.snippet.slice(0, 200) : undefined,
        }))
        .filter((s) => s.url.length > 0)
        // SSRF guard: these URLs are model-emitted (untrusted) and verifySources
        // fetches them from THIS server. Public http(s) hosts only.
        .filter((s) => {
          try {
            assertPublicHttpUrl(s.url);
            return true;
          } catch {
            return false;
          }
        })
        .slice(0, maxSources);

      let sources: ResearchSource[] = rawSources.map((s) => ({ ...s, verified: false }));
      try {
        sources = await verifySources(rawSources, { timeoutMs: 4000, concurrency: 5, dropDead: true });
      } catch {
        // Verifier itself failed: keep the raw list, marked unverified.
      }

      let note: string | undefined;
      if (findings.length === 0 && !summary) {
        note = 'No grounded findings for this query. Try a narrower or differently phrased query.';
      } else if (sources.length === 0) {
        note = 'No source URLs survived verification. Treat the findings as unverified model knowledge.';
      }

      await ctx.emit('agent:thought', {
        text: `Research done: ${findings.length} findings, ${sources.length} verified sources.`,
        at: new Date().toISOString(),
      });

      return { query, summary: summary.slice(0, 600), findings, sources, ...(note ? { note } : {}) };
    } catch (err) {
      return empty(query, `Research failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
