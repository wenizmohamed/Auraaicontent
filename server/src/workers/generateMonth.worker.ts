import { db } from '../db/prisma.js';
import { generateJson, MODELS } from '../services/gemini.service.js';
import { briefService } from '../services/brief.service.js';
import { buildPlanningPrompt } from '../services/prompt.service.js';
import { type Job, updateJob } from './queue.js';

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
