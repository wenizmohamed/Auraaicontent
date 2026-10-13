import { db } from '../db/prisma.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { briefService } from '../services/brief.service.js';
import { buildPlanningPrompt, parseBriefChannels } from '../services/prompt.service.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { retrieveContext } from '../services/retrieval.service.js';
import { type Job, updateJob, isJobCancelRequested } from './queue.js';
import { deAiText } from '../lib/human-voice.js';
import { AiCancelledError } from '../services/providers/errors.js';

// Per model attempt, and for the whole AI step. Defaults keep the job well
// inside the page's 15-minute wait (BriefInput.tsx) with room for saving +
// visual references afterwards.
const AI_ATTEMPT_TIMEOUT_MS = parseInt(process.env.GENERATE_MONTH_ATTEMPT_TIMEOUT_MS || '180000', 10);
const AI_BUDGET_MS = parseInt(process.env.GENERATE_MONTH_AI_BUDGET_MS || '420000', 10);
const STOPPED_BY_USER = 'Generation stopped by user. Nothing was saved.';

export async function generateMonthWorker(job: Job): Promise<{ calendarMonthId: string; provider: string; model: string; latencyMs: number; fallbackUsed: boolean }> {
  const { orgId, clientId, month, pieceCount } = job.data;
  if (!orgId) throw new Error('generateMonth job missing orgId — re-issue from a multi-tenancy-aware caller');

  // 1. Fetch client + brief — verify org match before proceeding.
  updateJob(job.id, { progress: 10 });
  const client = await db.client.findUnique({
    where: { id: clientId, orgId },
    include: { assets: { take: 10 } },
  });
  if (!client) throw new Error('Client not found or does not belong to this organization');
  // Brief-per-month (2026-07-14): use THIS month's dedicated brief, falling back
  // to the client default (month=''). Fixes new months silently inheriting an
  // old month's brief.
  const brief = await briefService.getByClientId(orgId, clientId, month);
  if (!brief) throw new Error('Client brief is missing — cannot generate');
  (client as any).brief = brief;

  // 2. Check brief completeness
  const { score } = briefService.completeness(brief);
  if (score < 50) throw new Error(`Brief completeness too low (${score}%). Need at least 50%.`);

  // 2b. Retrieve brand knowledge context (best-effort — generation continues without it)
  let knowledgeContext: { text: string; score: number }[] = [];
  if (brief.objective) {
    try {
      const chunks = await retrieveContext(orgId, clientId, brief.objective, 5);
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
    brief: brief,
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
  //
  // Time limits (2026-10-13 "it keeps looping" fix): the plan is one long JSON
  // answer. The global GEMINI_TIMEOUT_MS is sized for quick HTTP-route calls,
  // so every model rung timed out mid-plan, the ladder restarted from zero on
  // the next model, and the job sat at 40% for 9-15 min until the page gave
  // up. Now each attempt gets room to finish (AI_ATTEMPT_TIMEOUT_MS) and the
  // whole AI step has ONE hard budget (AI_BUDGET_MS) that also cancels the
  // in-flight request, so the job always ends well inside the page's wait.
  updateJob(job.id, { progress: 40 });
  console.log(`[generateMonth] Prompt: ${prompt.length} chars`);
  const userId = job.data.userId as string | undefined;
  if (await isJobCancelRequested(job.id)) throw new Error(STOPPED_BY_USER);

  const stop = new AbortController();
  const budgetTimer = setTimeout(() => stop.abort('time budget used up'), AI_BUDGET_MS);
  const aiStart = Date.now();
  // Heartbeat: creep 40 → 69 while the model writes so the page can show the
  // run is alive (it read a frozen 40% as "stuck in a loop"). Asymptotic, so it
  // never claims the next real milestone (70 = saving). Also picks up Stop.
  const heartbeat = setInterval(async () => {
    const t = (Date.now() - aiStart) / 1000;
    updateJob(job.id, { progress: 40 + Math.floor(29 * (1 - Math.exp(-t / 90))) });
    if (!stop.signal.aborted && await isJobCancelRequested(job.id)) stop.abort('stopped by user');
  }, 5000);
  let result: Awaited<ReturnType<typeof aiRouter.text>>;
  try {
    result = await aiRouter.text(
      { prompt, json: true, temperature: 0.7, timeoutMs: AI_ATTEMPT_TIMEOUT_MS, signal: stop.signal },
      { orgId, userId, jobId: job.id, clientId },
    );
  } catch (err) {
    if (err instanceof AiCancelledError) {
      if (err.reason === 'stopped by user') throw new Error(STOPPED_BY_USER);
      const mins = Math.max(1, Math.round(AI_BUDGET_MS / 60000));
      throw new Error(`The AI didn't finish writing the plan within ${mins} minute${mins === 1 ? '' : 's'}, so the run was stopped and nothing was saved. Please try again; fewer pieces finish faster.`);
    }
    throw err;
  } finally {
    clearTimeout(budgetTimer);
    clearInterval(heartbeat);
  }

  const parsed = result.output as { strategySummary?: any; posts?: any[] };
  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error(`AI (${result.provider}/${result.model}) did not return a valid posts array`);
  }

  // 4b. Defense in depth: enforce that every generated post uses an ALLOWED platform
  // from the saved brief. If the AI ignores the prompt restriction (happens rarely),
  // we coerce stray platforms back into the allowed set rather than accept the drift.
  const allowedChannels = parseBriefChannels(brief.channels);
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

  // 4c. CRITIC PASS (agentic pipeline): a second AI call grades every post
  // 1-10 on hook strength, brand fit, and platform fit; posts under 7 get ONE
  // rewrite with the critique attached. The writer no longer ships its first
  // draft — the generation pipeline is generate -> critique -> revise.
  try {
    const CRITIC_MIN = parseInt(process.env.GENERATE_MONTH_CRITIC_MIN || '7', 10);
    const scoreRes = await aiRouter.text({
      prompt: `Grade these ${parsed.posts.length} social posts for ${client.name}. Reply ONLY JSON {"scores":[{"i":0,"score":8,"why":"..."}]}. Criteria: hook strength, brand fit, platform fit.

` + JSON.stringify(parsed.posts.map((p: any, i: number) => ({ i, title: p.title, hook: p.hook, caption: (p.caption || '').slice(0, 300) }))),
      json: true, temperature: 0.2, maxTokens: 2048,
    }, { orgId, userId, jobId: job.id, clientId, skipBrandKit: true, skipKnowledge: true, skipMemory: true });
    const scores = ((scoreRes.output as any)?.scores || []) as { i: number; score: number; why?: string }[];
    let rewrites = 0;
    for (const sc of scores) {
      if (typeof sc.i !== 'number' || typeof sc.score !== 'number') continue;
      if (sc.score >= CRITIC_MIN || !parsed.posts[sc.i]) continue;
      if (rewrites >= 3) break; // cap rewrites — bounded cost per month
      const weak = parsed.posts[sc.i];
      try {
        const fix = await aiRouter.text({
          prompt: `Rewrite this weak social post (scored ${sc.score}/10: ${sc.why || 'weak hook'}). Return ONLY JSON {"title":"...","hook":"...","caption":"...","cta":"..."}. Keep platform=${weak.platform} and the brand voice.\n\n` + JSON.stringify({ title: weak.title, hook: weak.hook, caption: weak.caption, cta: weak.cta }),
          json: true, temperature: 0.8, maxTokens: 2048,
        }, { orgId, userId, jobId: job.id, clientId, skipBrandKit: true, skipKnowledge: true, skipMemory: true });
        const f = fix.output as any;
        if (f && (f.caption || f.hook)) {
          Object.assign(weak, { title: f.title || weak.title, hook: f.hook || weak.hook, caption: f.caption || weak.caption, cta: f.cta || weak.cta });
          rewrites++;
        }
      } catch { /* single rewrite failing never fails the month */ }
    }
    console.log(`[generateMonth] critic: ${scores.length} scored, ${rewrites} rewritten (min ${CRITIC_MIN})`);
  } catch (err: any) {
    console.warn('[generateMonth] critic pass skipped:', err?.message || err);
  }

  // 5. Save CalendarMonth — last chance to honour Stop before anything is
  // written (a stopped run must never leave a half-made calendar behind).
  if (await isJobCancelRequested(job.id)) throw new Error(STOPPED_BY_USER);
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
  // De-duplicate post dates. The (calendarMonthId, date) unique index means two
  // posts the AI put on the same day (or both blank) would 500 the ENTIRE month
  // on the second insert. Nudge each collision to the next free day so every
  // post is kept and the job never crashes on an AI quirk.
  const usedDates = new Set<string>();
  const baseDate = (() => { const d = new Date(`${month} 1`); return isNaN(d.getTime()) ? new Date() : d; })();
  const fmtDate = (d: Date) => d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  parsed.posts.forEach((post: any, i: number) => {
    let d = new Date(post.date);
    if (isNaN(d.getTime())) { d = new Date(baseDate); d.setDate(Math.min(28, i + 1)); } // fallback: spread across month
    let dateStr = post.date && !isNaN(new Date(post.date).getTime()) ? post.date : fmtDate(d);
    while (usedDates.has(dateStr)) { d.setDate(d.getDate() + 1); dateStr = fmtDate(d); }
    usedDates.add(dateStr);
    post.date = dateStr;
  });

  const createdPostIds: { id: string; referenceQuery: string | null; format: string | null }[] = [];
  for (const post of parsed.posts) {
    const created = await db.calendarPost.create({
      data: {
        orgId,
        calendarMonthId: calendarMonth.id,
        date: post.date || '',
        // deAiText on every field a human reads: models reach for em dashes
        // constantly and they are the loudest "this was written by AI" tell.
        title: deAiText(post.title || ''),
        pillar: post.pillar || '',
        platform: post.platform, // Already validated/coerced above
        format: post.format || 'Static',
        hook: deAiText(post.hook || '') || null,
        keyMessage: deAiText(post.keyMessage || '') || null,
        caption: deAiText(post.caption || ''),
        cta: deAiText(post.cta || '') || null,
        hashtags: post.hashtags || [],
        visualDirection: post.visualDirection || null,
        referenceQuery: post.referenceSearchQuery || null,
        rationale: post.ideaRationale || null,
        timing: post.timing || null,
      },
      select: { id: true, referenceQuery: true, format: true },
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
        const { results } = await visualSearchService.search(p.referenceQuery!, 6, { orgId, userId, clientId, jobId: job.id, format: p.format || undefined });
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
