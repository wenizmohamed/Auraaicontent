import { db } from '../db/prisma.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { briefService } from '../services/brief.service.js';
import { buildPlanningPrompt, parseBriefChannels } from '../services/prompt.service.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { retrieveContext } from '../services/retrieval.service.js';
import { type Job, updateJob } from './queue.js';

export async function generateMonthWorker(job: Job): Promise<{ calendarMonthId: string; provider: string; model: string; latencyMs: number; fallbackUsed: boolean }> {
  const { orgId, clientId, month, pieceCount } = job.data;
  if (!orgId) throw new Error('generateMonth job missing orgId — re-issue from a multi-tenancy-aware caller');

  // 1. Fetch client + brief — verify org match before proceeding.
  updateJob(job.id, { progress: 10 });
  const client = await db.client.findUnique({
    where: { id: clientId, orgId },
    include: { brief: true, assets: { take: 10 } },
  });
  if (!client) throw new Error('Client not found or does not belong to this organization');
  if (!client.brief) throw new Error('Client brief is missing — cannot generate');

  // 2. Check brief completeness
  const { score } = briefService.completeness(client.brief);
  if (score < 50) throw new Error(`Brief completeness too low (${score}%). Need at least 50%.`);

  // 2b. Retrieve brand knowledge context (best-effort — generation continues without it)
  let knowledgeContext: { text: string; score: number }[] = [];
  if (client.brief.objective) {
    try {
      const chunks = await retrieveContext(orgId, clientId, client.brief.objective, 5);
      knowledgeContext = chunks.map(c => ({ text: c.text, score: c.score }));
      if (knowledgeContext.length > 0) {
        console.log(`[generateMonth] Retrieved ${knowledgeContext.length} knowledge chunks for ${client.name} (top score: ${knowledgeContext[0].score.toFixed(3)})`);
      }
    } catch (err: any) {
      console.warn(`[generateMonth] Knowledge retrieval failed, continuing without it:`, err?.message || err);
    }
  }

  // 2c. Fetch prior posts so the prompt knows what NOT to repeat. Without this
  // the AI happily redrafts the same MRI/Ultrasound angles every month from a
  // thin brief, and the user perceives it as "same content across all months".
  // Includes archived months too — the user has seen those drafts and treats
  // them as prior published material.
  let priorPosts: Array<{ title: string; pillar: string; keyMessage: string; month: string }> = [];
  try {
    const rows = await db.calendarPost.findMany({
      where: { orgId, calendarMonth: { clientId } },
      select: {
        title: true, pillar: true, keyMessage: true,
        calendarMonth: { select: { month: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    priorPosts = rows
      .filter((r: any) => r.title && r.calendarMonth?.month && r.calendarMonth.month !== month)
      .map((r: any) => ({
        title: r.title,
        pillar: r.pillar || '',
        keyMessage: r.keyMessage || '',
        month: r.calendarMonth.month,
      }));
    if (priorPosts.length > 0) {
      console.log(`[generateMonth] Loaded ${priorPosts.length} prior posts for theme-diversity guard`);
    }
  } catch (err: any) {
    console.warn(`[generateMonth] Prior-post lookup failed, continuing without diversity guard:`, err?.message || err);
  }

  // 3. Build prompt
  updateJob(job.id, { progress: 20 });
  const prompt = buildPlanningPrompt({
    client: { name: client.name, industry: client.industry || undefined, website: client.website || undefined, instagramHandle: client.instagramHandle || undefined },
    brief: client.brief,
    assets: client.assets || [],
    month,
    pieceCount: pieceCount || 18,
    knowledgeContext,
    priorPosts,
  });

  // 4. Call AI via router. Provider order is env-driven:
  //   AI_TEXT_PRIMARY (default 'gemini') picks the first model; falls back
  //   to xAI (Grok) when AI_ENABLE_FALLBACK=true.  Today's live config:
  //   text=gemini, image=gemini, video=xai, analysis=gemini.
  updateJob(job.id, { progress: 40 });
  console.log(`[generateMonth] Prompt: ${prompt.length} chars, first 200: ${prompt.slice(0, 200).replace(/\n/g, ' ')}`);
  const result = await aiRouter.text(
    { prompt, json: true, temperature: 0.7 },
    { jobId: job.id, clientId },
  );

  const parsed = result.output as { strategySummary?: any; posts?: any[] };
  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error(`AI (${result.provider}/${result.model}) did not return a valid posts array`);
  }

  // 4b. Defense in depth: enforce that every generated post uses an ALLOWED platform
  // from the saved brief. If the AI ignores the prompt restriction (happens rarely),
  // we coerce stray platforms back into the allowed set rather than accept the drift.
  const allowedChannels = parseBriefChannels(client.brief.channels);
  const fallbackPlatform = allowedChannels[0] || 'Instagram';
  const allowedSet = new Set(allowedChannels.length > 0 ? allowedChannels : ['Instagram']);

  const canonicalize = (p: any): string => {
    if (typeof p !== 'string') return fallbackPlatform;
    const lower = p.trim().toLowerCase();
    if (lower === 'instagram' && allowedSet.has('Instagram')) return 'Instagram';
    if (lower === 'tiktok' && allowedSet.has('TikTok')) return 'TikTok';
    if (lower === 'linkedin' && allowedSet.has('LinkedIn')) return 'LinkedIn';
    if ((lower === 'x' || lower === 'twitter' || lower === 'x (twitter)') && allowedSet.has('X')) return 'X';
    if (lower === 'facebook' && allowedSet.has('Facebook')) return 'Facebook';
    return fallbackPlatform; // coerce unknown/disallowed platforms
  };

  let coerced = 0;
  for (const post of parsed.posts) {
    const original = post.platform;
    const normalized = canonicalize(original);
    if (normalized !== original) coerced++;
    post.platform = normalized;
  }
  if (coerced > 0) {
    console.warn(`[generateMonth] Coerced ${coerced}/${parsed.posts.length} posts to allowed platforms [${allowedChannels.join(', ')}] — AI ignored prompt restriction`);
  }

  // 5. Save CalendarMonth
  updateJob(job.id, { progress: 70 });
  const calendarMonth = await db.calendarMonth.create({
    data: {
      orgId,
      clientId,
      month,
      status: 'draft',
      strategy: parsed.strategySummary || null,
    },
  });

  // 6. Save CalendarPosts
  updateJob(job.id, { progress: 80 });
  const createdPostIds: { id: string; referenceQuery: string | null }[] = [];
  for (const post of parsed.posts) {
    const created = await db.calendarPost.create({
      data: {
        orgId,
        calendarMonthId: calendarMonth.id,
        date: post.date || '',
        title: post.title || '',
        pillar: post.pillar || '',
        platform: post.platform, // Already validated/coerced above
        format: post.format || 'Static',
        hook: post.hook || null,
        keyMessage: post.keyMessage || null,
        caption: post.caption || '',
        cta: post.cta || null,
        hashtags: post.hashtags || [],
        visualDirection: post.visualDirection || null,
        referenceQuery: post.referenceSearchQuery || null,
        rationale: post.ideaRationale || null,
        timing: post.timing || null,
      },
      select: { id: true, referenceQuery: true },
    });
    createdPostIds.push(created);
  }

  // 6b. Auto-populate visual references in PARALLEL — each post's search is
  // independent. Sequential was causing 50-150s stalls at 88% (5 posts × 10-30s
  // per search). Best-effort: per-post failures don't fail the whole job.
  updateJob(job.id, { progress: 88 });
  const refResults = await Promise.allSettled(
    createdPostIds
      .filter(p => p.referenceQuery && p.referenceQuery.trim())
      .map(async (p) => {
        const { results } = await visualSearchService.search(p.referenceQuery!, 6);
        // Bulk-insert all references for this post in a single createMany call
        if (results.length === 0) return 0;
        await db.postVisualReference.createMany({
          data: results.map((r, position) => ({
            orgId,
            postId: p.id,
            thumbnailUrl: r.thumbnailUrl,
            sourceUrl: r.sourceUrl,
            sourceDomain: r.sourceDomain,
            sourceType: r.sourceType,
            title: r.title || null,
            description: r.description || null,
            pinId: r.pinId || null,
            position,
          })),
        });
        return results.length;
      }),
  );
  const refsAdded = refResults.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
  const refFailures = refResults.filter(r => r.status === 'rejected').length;
  if (refFailures > 0) {
    console.warn(`[generateMonth] ${refFailures} visual ref searches failed (continuing anyway)`);
  }
  console.log(`[generateMonth] auto-populated ${refsAdded} visual refs across ${createdPostIds.length} posts`);

  updateJob(job.id, { progress: 95 });
  console.log(`[generateMonth] ${month} for ${client.name}: ${parsed.posts.length} posts via ${result.provider}/${result.model} (${result.latencyMs}ms${result.fallbackUsed ? ', FALLBACK' : ''})`);
  return {
    calendarMonthId: calendarMonth.id,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    fallbackUsed: result.fallbackUsed,
  };
}
