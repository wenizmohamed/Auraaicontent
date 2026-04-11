import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';

interface AnalyzeVideoBody {
  videoUrl?: string;
  prompt?: string;
  clientId?: string;
}

export async function analyzeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/analyze/video
  //
  // v1 stub: this route does NOT actually decode the video frames. It calls the
  // text model with the video URL, filename, and any user-provided context as
  // hints, and asks for a structured social-media analysis. Replace with the
  // Gemini multimodal upload pipeline once the file plumbing is wired.
  app.post('/analyze/video', async (request, reply) => {
    const { videoUrl, prompt, clientId } = (request.body as AnalyzeVideoBody) || {};
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
      return reply.status(400).send({ error: 'videoUrl is required' });
    }

    const userPrompt = (prompt || 'Analyze the social-media potential of this video.').trim();
    const filename = (() => {
      try { return new URL(videoUrl, 'http://x.local').pathname.split('/').pop() || videoUrl; }
      catch { return videoUrl; }
    })();

    const llmPrompt = [
      `You are a social-media strategist analyzing a video. You only have the URL/filename and the user's instructions.`,
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
      const out = result.output as any;

      const safe = {
        summary: typeof out?.summary === 'string' ? out.summary : '',
        themes: Array.isArray(out?.themes) ? out.themes.filter((t: any) => typeof t === 'string') : [],
        targetAudience: typeof out?.targetAudience === 'string' ? out.targetAudience : '',
        socialHooks: Array.isArray(out?.socialHooks) ? out.socialHooks.filter((h: any) => typeof h === 'string') : [],
        timestamps: Array.isArray(out?.timestamps)
          ? out.timestamps
              .filter((t: any) => t && typeof t === 'object')
              .map((t: any) => ({
                time: typeof t.time === 'string' ? t.time : '',
                description: typeof t.description === 'string' ? t.description : '',
              }))
          : [],
        suggestions: Array.isArray(out?.suggestions) ? out.suggestions.filter((s: any) => typeof s === 'string') : [],
      };

      return {
        ...safe,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Video analysis failed');
    }
  });
}
