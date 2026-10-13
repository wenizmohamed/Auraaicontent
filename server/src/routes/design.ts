import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { historyService } from '../services/history.service.js';

interface DesignBriefBody {
  topic?: string;
  audience?: string;
  objective?: string;
  brandColors?: string[];
  mood?: string;
  clientId?: string;
  // D2 concept ideation: feed the copy you already have, the product, and your
  // rough visual thoughts; the model proposes a central concept + ready prompts.
  copy?: string;
  productFocus?: string;
  visualThoughts?: string;
}

export async function designRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/design/brief
  app.post('/design/brief', async (request, reply) => {
    const { topic, audience, objective, brandColors, mood, clientId, copy, productFocus, visualThoughts } =
      (request.body as DesignBriefBody) || {};
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return reply.status(400).send({ error: 'topic is required' });
    }

    let clientContext = '';
    // Only a client PROVEN to belong to the caller's org may flow onward as
    // AI context/attribution — body clientId is untrusted input.
    let scopedClientId: string | undefined;
    if (clientId) {
      try {
        const client = await db.client.findUnique({ where: { id: clientId, orgId: request.orgId }, include: { briefs: { orderBy: { month: 'asc' }, take: 1 } } });
        if (client) {
          scopedClientId = client.id;
          const brief = client.briefs?.[0];
          clientContext += `\nClient: ${client.name}`;
          if (client.industry) clientContext += ` (${client.industry})`;
          if (client.primaryColor) clientContext += `\nBrand color: ${client.primaryColor}`;
          if (brief?.tone) clientContext += `\nBrand tone: ${brief.tone}`;
        }
      } catch {
        // best effort
      }
    }

    const prompt = [
      `You are a creative director. Propose ONE bold, specific central visual concept for a`,
      `social-media post, then give the assets to execute it. Be concrete and original (e.g.`,
      `"dirham coins stacking into an upward financial graph"), not generic.`,
      ``,
      `Topic: ${topic.trim()}`,
      audience ? `Target audience: ${audience}` : '',
      objective ? `Objective: ${objective}` : '',
      mood ? `Mood: ${mood}` : '',
      brandColors && brandColors.length ? `Brand colors: ${brandColors.join(', ')}` : '',
      copy ? `Existing copy to build the visual around: ${copy}` : '',
      productFocus ? `Product / focus: ${productFocus}` : '',
      visualThoughts ? `The user's rough visual ideas — develop and build ON these, do not ignore them: ${visualThoughts}` : '',
      clientContext,
      ``,
      `Return a JSON object with this EXACT shape:`,
      `{`,
      `  "conceptIdea": "the ONE central visual concept in 1-2 vivid sentences",`,
      `  "visualDirection": "2-3 sentence visual direction",`,
      `  "colorPalette": [ { "name": "Primary", "hex": "#000000" }, ... ],  // 3-5 colors`,
      `  "typography": { "heading": "Font name", "body": "Font name", "accent": "Font name" },`,
      `  "layoutDescription": "1-2 sentence layout description",`,
      `  "copy": { "headline": "...", "subheadline": "...", "body": "...", "cta": "..." },`,
      `  "imagePrompts": [ "ready-to-paste image prompt 1", "image prompt 2", "image prompt 3" ],`,
      `  "videoPrompts": [ "ready-to-paste animation/video prompt that brings the concept to life" ],`,
      `  "dimensions": [ { "platform": "Instagram", "size": "1080x1080" }, { "platform": "Story", "size": "1080x1920" } ]`,
      `}`,
      ``,
      `Return ONLY the JSON.`,
    ].filter(Boolean).join('\n');

    try {
      const result = await aiRouter.text({ prompt, json: true }, { orgId: request.orgId, userId: request.user?.userId, clientId: scopedClientId });
      const out = result.output as {
        conceptIdea?: unknown;
        visualDirection?: unknown;
        colorPalette?: unknown;
        typography?: { heading?: unknown; body?: unknown; accent?: unknown } | null;
        layoutDescription?: unknown;
        copy?: { headline?: unknown; subheadline?: unknown; body?: unknown; cta?: unknown } | null;
        imagePrompts?: unknown;
        videoPrompts?: unknown;
        dimensions?: unknown;
      } | null | undefined;

      // Best-effort normalization
      const safe = {
        conceptIdea: typeof out?.conceptIdea === 'string' ? out.conceptIdea : '',
        visualDirection: typeof out?.visualDirection === 'string' ? out.visualDirection : '',
        colorPalette: Array.isArray(out?.colorPalette)
          ? out.colorPalette
              .filter((c: { name?: unknown; hex?: unknown } | null | undefined) => c && typeof c === 'object' && typeof c.hex === 'string')
              .map((c: { name?: unknown; hex: string }) => ({ name: typeof c.name === 'string' ? c.name : 'Color', hex: c.hex }))
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
          ? out.imagePrompts.filter((p: unknown): p is string => typeof p === 'string')
          : [],
        videoPrompts: Array.isArray(out?.videoPrompts)
          ? out.videoPrompts.filter((p: unknown): p is string => typeof p === 'string')
          : [],
        dimensions: Array.isArray(out?.dimensions)
          ? out.dimensions
              .filter((d: unknown) => d && typeof d === 'object')
              .map((d: { platform?: unknown; size?: unknown }) => ({
                platform: typeof d.platform === 'string' ? d.platform : 'Unknown',
                size: typeof d.size === 'string' ? d.size : '',
              }))
          : [],
      };

      await historyService.record({
        orgId: request.orgId,
        userId: request.user?.userId,
        clientId: scopedClientId,
        type: 'design',
        surface: 'design_textures',
        prompt: topic,
        outputText: JSON.stringify(safe),
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        metadata: { audience, objective, mood, brandColors, kind: 'design-brief' },
      });
      return {
        ...safe,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      return sendAiError(reply, err, 'Design brief failed');
    }
  });
}
