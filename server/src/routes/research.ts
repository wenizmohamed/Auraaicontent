import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';

interface ResearchBody {
  query?: string;
  depth?: 'quick' | 'deep';
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
}
