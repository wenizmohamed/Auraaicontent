import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { callKimiLong } from '../services/providers/kimi.provider.js';
import { db } from '../db/prisma.js';

interface ResearchBody {
  query?: string;
  depth?: 'quick' | 'deep';
}

interface BrandSynthesisBody {
  clientId?: string;
  focus?: string;  // optional angle: "tone", "gaps", "trajectory", "audience"
}

export async function researchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/research
  app.post('/research', async (request, reply) => {
    const { query, depth = 'quick' } = (request.body as ResearchBody) || {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return reply.status(400).send({ error: 'query is required' });
    }

    const isDeep = depth === 'deep';
    const prompt = [
      `You are a senior research analyst. Research this topic and return a structured summary.`,
      ``,
      `Topic: "${query.trim()}"`,
      ``,
      `Return a JSON object with this exact shape:`,
      `{`,
      `  "summary": "2-3 sentence summary of the topic",`,
      `  "keyPoints": ["bullet 1", "bullet 2", ...],  // ${isDeep ? '8-12' : '5-8'} items`,
      `  "sources": [`,
      `    { "title": "Source title", "url": "https://...", "snippet": "1-sentence excerpt" },`,
      `    ...  // ${isDeep ? '5-8' : '3-5'} items`,
      `  ]`,
      `}`,
      ``,
      `If you do not have a grounded source, invent a plausible one based on what you know — that is acceptable for this v1.`,
      `Return ONLY the JSON, no commentary.`,
    ].join('\n');

    try {
      const result = await aiRouter.text({ prompt, json: true });
      const out = result.output as any;

      // Tolerate non-conforming outputs
      const summary = typeof out?.summary === 'string' ? out.summary : (typeof out === 'string' ? out : '');
      const keyPoints = Array.isArray(out?.keyPoints) ? out.keyPoints.filter((s: any) => typeof s === 'string') : [];
      const sources = Array.isArray(out?.sources)
        ? out.sources
            .filter((s: any) => s && typeof s === 'object')
            .map((s: any) => ({
              title: typeof s.title === 'string' ? s.title : 'Untitled',
              url: typeof s.url === 'string' ? s.url : '',
              snippet: typeof s.snippet === 'string' ? s.snippet : undefined,
            }))
            .filter((s: any) => s.url)
        : [];

      return {
        summary,
        keyPoints,
        sources,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Research failed');
    }
  });

  // POST /api/research/brand-synthesis — Kimi 128K long-context route.
  // Stuffs a client's full brief + every calendar post caption + knowledge
  // items + competitor notes into one prompt so Kimi can spot patterns,
  // gaps, and trajectory that would need multi-round chunking on Grok
  // (Grok's context is 131K but its latency for 100K+ prompts is brutal).
  // Use when the user asks "what's the vibe?", "where are we drifting?",
  // "what haven't we covered?" for a specific client.
  app.post('/research/brand-synthesis', async (request, reply) => {
    const { clientId, focus } = (request.body as BrandSynthesisBody) || {};
    if (!clientId) return reply.status(400).send({ error: 'clientId is required' });

    const client = await db.client.findUnique({
      where: { id: clientId, orgId: request.orgId },
      include: {
        brief: true,
        knowledgeItems: { select: { title: true, type: true, textContent: true }, take: 40 },
        calendarMonths: {
          orderBy: { createdAt: 'desc' },
          take: 24,  // up to 24 months of history
          include: { posts: { select: { title: true, caption: true, platform: true, status: true } } },
        },
      },
    });
    if (!client) return reply.status(404).send({ error: 'client not found' });

    const briefBlock = client.brief
      ? `BRIEF\n  objective: ${client.brief.objective}\n  audience: ${client.brief.audience}\n  tone: ${client.brief.tone}\n  pillars: ${JSON.stringify(client.brief.pillars)}\n  products: ${JSON.stringify(client.brief.products)}\n  do: ${client.brief.brandDo}\n  don't: ${client.brief.brandDont}\n  compliance: ${client.brief.complianceNotes || '(none)'}\n`
      : '(no brief)';

    const knowledgeBlock = client.knowledgeItems.length
      ? client.knowledgeItems.map((k: any, i: any) => `[kb-${i + 1}] ${k.title} (${k.type})\n${(k.textContent || '').slice(0, 4000)}`).join('\n\n')
      : '(no knowledge items)';

    const calendarBlock = client.calendarMonths.length
      ? client.calendarMonths.map((m: any) => {
          const posts = m.posts.map((p: any) => `  - [${p.platform}/${p.status}] ${p.title}: ${(p.caption || '').slice(0, 200)}`).join('\n');
          return `MONTH ${m.month} (${m.status}, ${m.posts.length} posts)\n${posts}`;
        }).join('\n\n')
      : '(no calendars yet)';

    const prompt = [
      `CLIENT: ${client.name} (${client.industry || 'industry unspecified'})`,
      '',
      briefBlock,
      '',
      'KNOWLEDGE BASE:',
      knowledgeBlock,
      '',
      'CALENDAR HISTORY (most recent first):',
      calendarBlock,
      '',
      '---',
      `TASK: Read the entire brand history above and return a synthesis in this EXACT JSON shape:`,
      `{`,
      `  "voiceSummary": "2-3 sentences on the actual tone-of-voice emerging from captions",`,
      `  "pillarCoverage": [ { "pillar": "name", "postCount": N, "lastSeen": "YYYY-MM" } ],`,
      `  "gaps": [ "what's missing that the brief promised", ... ],`,
      `  "drift": [ "where posts diverged from the brief's stated DO/DONT", ... ],`,
      `  "recommendations": [ "next-month action item", ... ]`,
      `}`,
      focus ? `\nFOCUS ANGLE: ${focus}` : '',
      `Return ONLY the JSON, no prose wrapper, no markdown fences.`,
    ].join('\n');

    try {
      const { text, model, latencyMs, inputChars } = await callKimiLong(
        'You are a senior brand strategist. You spot drift, gaps, and patterns that slip past content writers. Be specific, cite post titles.',
        prompt,
        8192,
      );
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed: any = null;
      try { parsed = JSON.parse(stripped); } catch {
        return { raw: text, provider: 'moonshot', model, latencyMs, inputChars, parseError: 'could not parse JSON' };
      }
      return { ...parsed, provider: 'moonshot', model, latencyMs, inputChars };
    } catch (err: any) {
      return sendAiError(reply, err, 'Brand synthesis failed');
    }
  });
}
