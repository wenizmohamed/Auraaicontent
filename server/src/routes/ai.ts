// Generic AI text endpoint — backs the frontend lib/ai.ts helpers (Topic Desk
// brief-expand / topic-suggest / outline, visual-ref keyword sets) which used
// to call Gemini/Claude DIRECTLY from the browser via /gemini & /claude proxy
// paths that don't exist in nginx (→ 404 in prod). Routing through aiRouter
// gives the universal fallback chain + org budget + telemetry + enrichment,
// Gemini-primary like everything else.

import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';

interface AiTextBody {
  prompt?: string;
  system?: string;
  json?: boolean;
  temperature?: number;
  clientId?: string;
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/ai/text — single text/JSON generation through the router.
  app.post('/ai/text', async (request, reply) => {
    const { prompt, system, json, temperature, clientId } = (request.body || {}) as AiTextBody;
    if (!prompt?.trim()) return reply.status(400).send({ error: 'prompt is required' });
    try {
      const result = await aiRouter.text(
        { prompt, system, json: !!json, temperature },
        { orgId: request.orgId, userId: request.user?.userId, clientId },
      );
      const out = result.output;
      return {
        text: typeof out === 'string' ? out : JSON.stringify(out),
        provider: result.provider,
        model: result.model,
      };
    } catch (err) {
      return sendAiError(reply, err, 'AI text generation failed');
    }
  });
}
