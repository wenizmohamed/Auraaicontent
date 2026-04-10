import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { db } from '../db/prisma.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatBody {
  messages?: ChatMessage[];
  clientId?: string;
}

export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/assistant/chat
  app.post('/assistant/chat', async (request, reply) => {
    const { messages, clientId } = (request.body as ChatBody) || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }
    for (const m of messages) {
      if (!m || typeof m.content !== 'string' || !['user', 'assistant', 'system'].includes(m.role)) {
        return reply.status(400).send({ error: 'each message must have role and content' });
      }
    }

    // Build a system prefix with optional client context
    let systemBlock = 'You are Radix Assistant — a helpful, concise content-strategy assistant for social media briefs and calendars.';
    if (clientId) {
      try {
        const client = await db.client.findUnique({ where: { id: clientId }, include: { brief: true } });
        if (client) {
          systemBlock += `\n\nCurrent client: ${client.name}`;
          if (client.industry) systemBlock += ` (${client.industry})`;
          if (client.brief) {
            if (client.brief.objective) systemBlock += `\nObjective: ${client.brief.objective}`;
            if (client.brief.audience) systemBlock += `\nAudience: ${client.brief.audience}`;
            if (client.brief.tone) systemBlock += `\nTone: ${client.brief.tone}`;
          }
        }
      } catch {
        // ignore — context is best-effort
      }
    }

    // Merge any system messages into the system block, then alternate user/assistant
    const explicitSystem = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    if (explicitSystem) systemBlock += `\n\n${explicitSystem}`;

    const conversation = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const prompt = `${conversation}\n\nAssistant:`;

    try {
      const result = await aiRouter.text({ prompt, system: systemBlock });
      const content = typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output);

      return {
        message: { role: 'assistant', content: content.trim() },
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: any) {
      return reply.status(502).send({ error: err?.message || 'Assistant call failed' });
    }
  });
}
