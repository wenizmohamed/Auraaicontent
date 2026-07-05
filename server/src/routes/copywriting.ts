import { errStatus, errMessage } from '../services/providers/errors.js';
import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { generateCopy, type CopyType, type CopyLanguage } from '../services/copywriting.service.js';
import { sendAiError } from '../services/providers/errors.js';
import { historyService } from '../services/history.service.js';
import { assertClientInOrg } from '../lib/tenant.js';

const VALID_TYPES: CopyType[] = ['headline', 'description', 'article', 'cta'];
const VALID_LANGS: CopyLanguage[] = ['en', 'ar', 'fr'];

export async function copywritingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/copywriting/generate
  // Brand-grounded website copy. Body:
  //   { brief, copyType?, language?, tone?, clientId?, count? }
  app.post('/copywriting/generate', async (request, reply) => {
    const body = (request.body as {
      clientId?: string;
      copyType?: string;
      language?: string;
      tone?: string;
      brief?: string;
      count?: number;
      length?: string;
      avoid?: string[];
    }) || {};

    const orgId = request.orgId!;
    const copyType = (body.copyType || 'headline') as CopyType;
    const language = (body.language || 'en') as CopyLanguage;

    if (!body.brief || typeof body.brief !== 'string' || !body.brief.trim()) {
      return reply.status(400).send({ error: 'brief is required' });
    }
    if (!VALID_TYPES.includes(copyType)) {
      return reply.status(400).send({ error: `copyType must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!VALID_LANGS.includes(language)) {
      return reply.status(400).send({ error: `language must be one of: ${VALID_LANGS.join(', ')}` });
    }
    if (body.clientId) {
      try {
        await assertClientInOrg(body.clientId, orgId);
      } catch (err) {
        return reply.status(errStatus(err)).send({ error: errMessage(err) });
      }
    }

    try {
      const result = await generateCopy({
        orgId,
        clientId: body.clientId,
        copyType,
        language,
        tone: body.tone,
        brief: body.brief,
        count: body.count,
        length: body.length,
        avoid: Array.isArray(body.avoid) ? body.avoid : undefined,
      });

      historyService.record({
        orgId,
        userId: request.user?.userId,
        clientId: body.clientId || undefined,
        type: 'text',
        surface: 'copywriting',
        prompt: `[copywriting:${copyType}:${language}] ${body.brief}`,
        outputText: result.variants.join('\n---\n'),
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: {
          copyType,
          language,
          tone: body.tone || null,
          count: result.variants.length,
          groundingChunks: result.groundingChunks,
        },
      }).catch(() => {});

      return result;
    } catch (err) {
      return sendAiError(reply, err, 'Copywriting generation failed');
    }
  });
}
