import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';

interface AnalyzeVideoBody {
  videoUrl?: string;
  prompt?: string;
  clientId?: string;
}

// ─── Content Moderation ─────────────────────────────────────────
const BLOCKED_DOMAINS = [
  'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn',
  'tube8', 'spankbang', 'brazzers', 'bangbros', 'realitykings',
  'onlyfans', 'chaturbate', 'stripchat', 'livejasmin', 'cam4',
  'motherless', 'efukt', 'heavy-r', 'bestgore', 'liveleak',
  'theync', 'crazyshit', 'kaotic', 'goregrish',
];

function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_DOMAINS.some(d => lower.includes(d));
}

export async function analyzeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  app.post('/analyze/video', async (request, reply) => {
    const { videoUrl, prompt, clientId } = (request.body as AnalyzeVideoBody) || {};
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
      return reply.status(400).send({ error: 'videoUrl is required' });
    }

    // Block adult/violent content — this is a client-facing agency tool
    if (isBlockedUrl(videoUrl)) {
      return reply.status(422).send({
        error: 'This URL has been blocked by Radix content policy. The video analysis tool is designed for brand-safe social media content only.',
        code: 'CONTENT_BLOCKED',
      });
    }

    const userPrompt = (prompt || 'Analyze the social-media potential of this video.').trim();
    const filename = (() => {
      try { return new URL(videoUrl, 'http://x.local').pathname.split('/').pop() || videoUrl; }
      catch { return videoUrl; }
    })();

    const llmPrompt = [
      `You are a social-media strategist analyzing a video for a professional agency. You only have the URL/filename and the user's instructions.`,
      `CONTENT POLICY: If the URL or filename suggests adult, pornographic, violent, or illegal content, respond with: { "error": "Content blocked by Radix policy. This tool only analyzes brand-safe content." } and nothing else.`,
      `Reason about the likely contents based on the filename, file type, and any clues in the URL.`,
      ``,
      `Video URL: ${videoUrl}`,
      `Filename: ${filename}`,
      `User instruction: ${userPrompt}`,
      ``,
      `Return a JSON object with this EXACT shape:`,
      `{`,
      `  "summary": "2-3 sentence summary of what the video likely contains",`,
      `  "themes": ["theme 1", "theme 2", ...],  // 3-6 items`,
      `  "targetAudience": "1 sentence describing the likely target audience",`,
      `  "socialHooks": ["hook 1", "hook 2", ...],  // 3-5 punchy social-media hooks`,
      `  "timestamps": [ { "time": "0:00-0:15", "description": "..." }, ... ],  // 3-5 segments`,
      `  "suggestions": ["suggestion 1", ...]  // 3-5 actionable suggestions`,
      `}`,
      ``,
      `Return ONLY the JSON.`,
    ].join('\n');

    try {
      const result = await aiRouter.text({ prompt: llmPrompt, json: true });
      const out = result.output as Record<string, unknown> | null;

      // If the LLM flagged it as blocked content
      if (out?.error && typeof out.error === 'string') {
        return reply.status(422).send({ error: out.error, code: 'CONTENT_BLOCKED' });
      }

      const safe = {
        summary: typeof out?.summary === 'string' ? out.summary : '',
        themes: Array.isArray(out?.themes) ? out.themes.filter((t: unknown) => typeof t === 'string') : [],
        targetAudience: typeof out?.targetAudience === 'string' ? out.targetAudience : '',
        socialHooks: Array.isArray(out?.socialHooks) ? out.socialHooks.filter((h: unknown) => typeof h === 'string') : [],
        timestamps: Array.isArray(out?.timestamps)
          ? out.timestamps
              .filter((t: unknown): t is Record<string, unknown> => !!t && typeof t === 'object')
              .map((t) => ({
                time: typeof t.time === 'string' ? t.time : '',
                description: typeof t.description === 'string' ? t.description : '',
              }))
          : [],
        suggestions: Array.isArray(out?.suggestions) ? out.suggestions.filter((s: unknown) => typeof s === 'string') : [],
      };

      return {
        ...safe,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: unknown) {
      return sendAiError(reply, err, 'Video analysis failed');
    }
  });
}
