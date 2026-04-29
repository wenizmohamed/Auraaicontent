import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';

interface DesignBriefBody {
  topic?: string;
  audience?: string;
  objective?: string;
  brandColors?: string[];
  mood?: string;
  clientId?: string;
}

export async function designRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/design/brief
  app.post('/design/brief', async (request, reply) => {
    const { topic, audience, objective, brandColors, mood, clientId } =
      (request.body as DesignBriefBody) || {};
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return reply.status(400).send({ error: 'topic is required' });
    }

    let clientContext = '';
    if (clientId) {
      try {
        const client = await db.client.findUnique({ where: { id: clientId, orgId: request.orgId }, include: { brief: true } });
        if (client) {
          clientContext += `\nClient: ${client.name}`;
          if (client.industry) clientContext += ` (${client.industry})`;
          if (client.primaryColor) clientContext += `\nBrand color: ${client.primaryColor}`;
          if (client.brief?.tone) clientContext += `\nBrand tone: ${client.brief.tone}`;
        }
      } catch {
        // best effort
      }
    }

    const prompt = [
      `You are a creative director generating a structured design brief for a social-media post.`,
      ``,
      `Topic: ${topic.trim()}`,
      audience ? `Target audience: ${audience}` : '',
      objective ? `Objective: ${objective}` : '',
      mood ? `Mood: ${mood}` : '',
      brandColors && brandColors.length ? `Brand colors: ${brandColors.join(', ')}` : '',
      clientContext,
      ``,
      `Return a JSON object with this EXACT shape:`,
      `{`,
      `  "visualDirection": "2-3 sentence visual direction",`,
      `  "colorPalette": [ { "name": "Primary", "hex": "#000000" }, ... ],  // 3-5 colors`,
      `  "typography": { "heading": "Font name", "body": "Font name", "accent": "Font name" },`,
      `  "layoutDescription": "1-2 sentence layout description",`,
      `  "copy": { "headline": "...", "subheadline": "...", "body": "...", "cta": "..." },`,
      `  "imagePrompts": [ "image prompt 1", "image prompt 2", "image prompt 3" ],`,
      `  "dimensions": [ { "platform": "Instagram", "size": "1080x1080" }, { "platform": "Story", "size": "1080x1920" } ]`,
      `}`,
      ``,
      `Return ONLY the JSON.`,
    ].filter(Boolean).join('\n');

    try {
      const result = await aiRouter.text({ prompt, json: true });
      const out = result.output as any;

      // Best-effort normalization
      const safe = {
        visualDirection: typeof out?.visualDirection === 'string' ? out.visualDirection : '',
        colorPalette: Array.isArray(out?.colorPalette)
          ? out.colorPalette
              .filter((c: any) => c && typeof c === 'object' && typeof c.hex === 'string')
              .map((c: any) => ({ name: typeof c.name === 'string' ? c.name : 'Color', hex: c.hex }))
          : [],
        typography: {
          heading: typeof out?.typography?.heading === 'string' ? out.typography.heading : 'Inter',
          body: typeof out?.typography?.body === 'string' ? out.typography.body : 'Inter',
          accent: typeof out?.typography?.accent === 'string' ? out.typography.accent : 'Inter',
        },
        layoutDescription: typeof out?.layoutDescription === 'string' ? out.layoutDescription : '',
        copy: {
          headline: typeof out?.copy?.headline === 'string' ? out.copy.headline : '',
          subheadline: typeof out?.copy?.subheadline === 'string' ? out.copy.subheadline : '',
          body: typeof out?.copy?.body === 'string' ? out.copy.body : '',
          cta: typeof out?.copy?.cta === 'string' ? out.copy.cta : '',
        },
        imagePrompts: Array.isArray(out?.imagePrompts)
          ? out.imagePrompts.filter((p: any) => typeof p === 'string')
          : [],
        dimensions: Array.isArray(out?.dimensions)
          ? out.dimensions
              .filter((d: any) => d && typeof d === 'object')
              .map((d: any) => ({
                platform: typeof d.platform === 'string' ? d.platform : 'Unknown',
                size: typeof d.size === 'string' ? d.size : '',
              }))
          : [],
      };

      return {
        ...safe,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Design brief failed');
    }
  });
}
