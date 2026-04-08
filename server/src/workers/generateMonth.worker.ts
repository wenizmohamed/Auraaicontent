import { db } from '../db/prisma.js';
import { generateJson, MODELS } from '../services/gemini.service.js';
import { briefService } from '../services/brief.service.js';
import { type Job, updateJob } from './queue.js';

// Inline prompt builder — avoids cross-workspace import issue with tsc
// Source: packages/prompts/src/briefToCalendar.ts
function buildPlanningPrompt(p: { client: any; brief: any; assets: any[]; month: string; pieceCount: number }): string {
  const s: string[] = [];
  s.push(`You are an expert social media content strategist for ${p.client.name}, a ${p.client.industry || 'general'} company.`);
  s.push('\n=== CLIENT ===');
  s.push(`Name: ${p.client.name}`);
  if (p.client.industry) s.push(`Industry: ${p.client.industry}`);
  if (p.client.website) s.push(`Website: ${p.client.website}`);
  if (p.brief) {
    s.push('\n=== BRIEF ===');
    if (p.brief.objective) s.push(`Objective: ${p.brief.objective}`);
    if (p.brief.audience) s.push(`Audience: ${p.brief.audience}`);
    if (p.brief.tone) s.push(`Tone: ${p.brief.tone}`);
    if (p.brief.brandDo) s.push(`Brand Do: ${p.brief.brandDo}`);
    if (p.brief.brandDont) s.push(`Brand Don't: ${p.brief.brandDont}`);
    if (p.brief.complianceNotes) s.push(`Compliance: ${p.brief.complianceNotes}`);
    const fmtArr = (l: string, v: any) => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(a) && a.length) s.push(`${l}: ${a.join(', ')}`); } catch {} };
    fmtArr('Products', p.brief.products);
    fmtArr('Pillars', p.brief.pillars);
    fmtArr('Channels', p.brief.channels);
    fmtArr('Campaign Moments', p.brief.campaignMoments);
  }
  s.push('\n=== PLATFORM LIMITS ===');
  s.push('Instagram: max 2200 chars, 5 hashtags. TikTok: max 4000, 5 hashtags. LinkedIn: max 3000, 5 hashtags. X: max 280, 2 hashtags. Facebook: max 63206, 3 hashtags.');
  s.push(`\n=== TASK ===\nGenerate exactly ${p.pieceCount} content pieces for ${p.month} as JSON.`);
  s.push(`Return: {"strategySummary":{"overview":"...","themes":[...],"channelFocus":{...}},"posts":[{"date":"...","title":"...","pillar":"...","platform":"...","format":"...","hook":"...","keyMessage":"...","caption":"...","cta":"...","hashtags":[...],"visualDirection":"...","referenceSearchQuery":"...","ideaRationale":"...","timing":"..."}]}`);
  s.push('\nRULES: Captions within platform limits. Mix platforms/formats. Distribute evenly. Return ONLY valid JSON.');
  return s.join('\n');
}

export async function generateMonthWorker(job: Job): Promise<{ calendarMonthId: string }> {
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

  // 4. Call Gemini
  updateJob(job.id, { progress: 40 });
  const result = await generateJson<{ strategySummary: any; posts: any[] }>(prompt, MODELS.planner);

  if (!result.posts || !Array.isArray(result.posts)) {
    throw new Error('Gemini did not return a valid posts array');
  }

  // 5. Save CalendarMonth
  updateJob(job.id, { progress: 70 });
  const calendarMonth = await db.calendarMonth.create({
    data: {
      clientId,
      month,
      status: 'draft',
      strategy: result.strategySummary || null,
    },
  });

  // 6. Save CalendarPosts
  updateJob(job.id, { progress: 80 });
  for (const post of result.posts) {
    await db.calendarPost.create({
      data: {
        calendarMonthId: calendarMonth.id,
        date: post.date || '',
        title: post.title || '',
        pillar: post.pillar || '',
        platform: post.platform || 'Instagram',
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
    });
  }

  updateJob(job.id, { progress: 95 });
  return { calendarMonthId: calendarMonth.id };
}
