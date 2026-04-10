import { db } from '../db/prisma.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { briefService } from '../services/brief.service.js';
import { buildPlanningPrompt, parseBriefChannels } from '../services/prompt.service.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { type Job, updateJob } from './queue.js';

export async function generateMonthWorker(job: Job): Promise<{ calendarMonthId: string; provider: string; model: string; latencyMs: number; fallbackUsed: boolean }> {
  const { clientId, month, pieceCount } = job.data;

  // 1. Fetch client + brief
  updateJob(job.id, { progress: 10 });
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { brief: true, assets: { take: 10 } },
  });
  if (!client) throw new Error('Client not found');
  if (!client.brief) throw new Error('Client brief is missing — cannot generate');

  // 2. Check brief completeness
  const { score } = briefService.completeness(client.brief);
  if (score < 50) throw new Error(`Brief completeness too low (${score}%). Need at least 50%.`);

  // 3. Build prompt
  updateJob(job.id, { progress: 20 });
  const prompt = buildPlanningPrompt({
    client: { name: client.name, industry: client.industry || undefined, website: client.website || undefined, instagramHandle: client.instagramHandle || undefined },
    brief: client.brief,
    assets: client.assets || [],
    month,
    pieceCount: pieceCount || 18,
  });

  // 4. Call AI via router (Grok primary, Gemini fallback)
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

  // 6b. Auto-populate visual references for every post that has a referenceQuery.
  // Best-effort — failures don't fail the whole job; the user can still backfill later.
  updateJob(job.id, { progress: 88 });
  let refsAdded = 0;
  for (const p of createdPostIds) {
    if (!p.referenceQuery || !p.referenceQuery.trim()) continue;
    try {
      const { results } = await visualSearchService.search(p.referenceQuery, 6);
      let position = 0;
      for (const r of results) {
        await db.postVisualReference.create({
          data: {
            postId: p.id,
            thumbnailUrl: r.thumbnailUrl,
            sourceUrl: r.sourceUrl,
            sourceDomain: r.sourceDomain,
            sourceType: r.sourceType,
            title: r.title || null,
            description: r.description || null,
            pinId: r.pinId || null,
            position: position++,
          },
        });
        refsAdded++;
      }
    } catch (err: any) {
      console.warn(`[generateMonth] visual ref population failed for post ${p.id}:`, err?.message || err);
    }
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
