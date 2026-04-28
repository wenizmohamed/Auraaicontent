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
        const client = await db.client.findUnique({ where: { id: clientId }, include: { brief: true } });
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
      const out = result.output as Record<string, unknown> | null;
      const typo = (out?.typography ?? {}) as Record<string, unknown>;
      const copy = (out?.copy ?? {}) as Record<string, unknown>;
      const pickStr = (obj: Record<string, unknown>, key: string, fallback: string) =>
        typeof obj[key] === 'string' ? (obj[key] as string) : fallback;

      // Best-effort normalization
      const safe = {
        visualDirection: typeof out?.visualDirection === 'string' ? out.visualDirection : '',
        colorPalette: Array.isArray(out?.colorPalette)
          ? (out.colorPalette as unknown[])
              .filter((c: unknown): c is { hex: string; name?: unknown } => !!c && typeof c === 'object' && typeof (c as { hex?: unknown }).hex === 'string')
              .map((c) => ({ name: typeof c.name === 'string' ? c.name : 'Color', hex: c.hex }))
          : [],
        typography: {
          heading: pickStr(typo, 'heading', 'Inter'),
          body: pickStr(typo, 'body', 'Inter'),
          accent: pickStr(typo, 'accent', 'Inter'),
        },
        layoutDescription: typeof out?.layoutDescription === 'string' ? out.layoutDescription : '',
        copy: {
          headline: pickStr(copy, 'headline', ''),
          subheadline: pickStr(copy, 'subheadline', ''),
          body: pickStr(copy, 'body', ''),
          cta: pickStr(copy, 'cta', ''),
        },
        imagePrompts: Array.isArray(out?.imagePrompts)
          ? (out.imagePrompts as unknown[]).filter((p: unknown) => typeof p === 'string')
          : [],
        dimensions: Array.isArray(out?.dimensions)
          ? (out.dimensions as unknown[])
              .filter((d: unknown): d is Record<string, unknown> => !!d && typeof d === 'object')
              .map((d) => ({
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
    } catch (err: unknown) {
      return sendAiError(reply, err, 'Design brief failed');
    }
  });
}
