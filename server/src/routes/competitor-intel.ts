// Competitor Intel MVP (T3#14). Native, in-house.
//
// Honest scope: given a competitor (name + optional website), fetch the page when
// provided and run the AI router to extract content themes, tone/positioning,
// posting-cadence signals, and — cross-referenced with the selected client's
// brief — concrete opportunities/gaps. This is AI analysis of public signals,
// not a real-time paid-ads feed; Weni's external prototype can supply richer
// data sources later behind the same route/UI.
import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { db } from '../db/prisma.js';
import { errStatus, errMessage } from '../services/providers/errors.js';
import { assertPublicHttpUrl } from '../services/upscale.service.js';

async function fetchPageText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    // The server performs this fetch, so an unvalidated host turns the endpoint
    // into an internal-network probe (the page text is summarised back to the
    // caller). Public http(s) hosts only — throws for loopback/private ranges.
    assertPublicHttpUrl(u);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 AURAAIBot' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    // crude tag strip → text; cap length to keep the prompt lean
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  } catch { return null; }
}

export async function competitorIntelRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // POST /api/competitor-intel/analyze { competitor, website?, clientId? }
  app.post('/competitor-intel/analyze', async (request, reply) => {
    try {
      const { competitor, website, clientId } = (request.body as { competitor?: string; website?: string; clientId?: string }) || {};
      if (!competitor?.trim()) return reply.status(400).send({ error: 'competitor is required' });

      // Optional: ground against the selected client's brief for gap analysis.
      let clientContext = '';
      if (clientId) {
        const client = await db.client.findFirst({
          where: { id: clientId, orgId: request.orgId! },
          select: { name: true, industry: true, briefs: { select: { audience: true, objective: true, tone: true }, orderBy: { month: 'asc' }, take: 1 } },
        });
        if (client) {
          const cb = client.briefs?.[0];
          clientContext = `\n\nOUR CLIENT (find gaps THEY can exploit):\n- Brand: ${client.name}${client.industry ? ` (${client.industry})` : ''}` +
            (cb ? `\n- Audience: ${cb.audience ?? '—'}\n- Objective: ${cb.objective ?? '—'}\n- Tone: ${cb.tone ?? '—'}` : '');
        }
      }

      const pageText = website ? await fetchPageText(website) : null;
      const prompt =
        `You are a social-media competitive analyst. Analyze the competitor "${competitor.trim()}"` +
        (website ? ` (${website})` : '') + `.` +
        (pageText ? `\n\nFETCHED PUBLIC CONTENT (may be partial):\n"""${pageText}"""` : '') +
        clientContext +
        `\n\nReturn ONLY minified JSON with this exact shape:\n` +
        `{"summary":"2-sentence positioning read","themes":["content theme",...max 6],` +
        `"tone":"their voice in 3-6 words","cadenceSignals":"what their posting rhythm/format suggests",` +
        `"strengths":["...",max 4],"opportunities":["a concrete gap OUR CLIENT can exploit",...max 5]}`;

      const result = await aiRouter.text({ prompt, json: true }, { orgId: request.orgId, userId: request.user?.userId, clientId });
      const out = result.output as {
        summary?: unknown;
        themes?: unknown;
        tone?: unknown;
        cadenceSignals?: unknown;
        strengths?: unknown;
        opportunities?: unknown;
      } | null | undefined;
      return {
        competitor: competitor.trim(),
        website: website || null,
        grounded: !!pageText,
        provider: result.provider,
        analysis: {
          summary: out?.summary ?? '',
          themes: Array.isArray(out?.themes) ? out.themes.slice(0, 6) : [],
          tone: out?.tone ?? '',
          cadenceSignals: out?.cadenceSignals ?? '',
          strengths: Array.isArray(out?.strengths) ? out.strengths.slice(0, 4) : [],
          opportunities: Array.isArray(out?.opportunities) ? out.opportunities.slice(0, 5) : [],
        },
      };
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err, 'Analysis failed') });
    }
  });
}
