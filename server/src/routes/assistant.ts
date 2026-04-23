import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { briefService } from '../services/brief.service.js';
import { createJob, processJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { searchPinterest } from '../services/pinterest.service.js';
import { auditService } from '../services/audit.service.js';

// ─── Claude Client ───────────────────────────────────────────────
const CLAUDE_MODEL = process.env.CLAUDE_ASSISTANT_MODEL || 'claude-sonnet-4-20250514';
let _claude: Anthropic | null = null;
function getClaude(): Anthropic {
  if (!_claude) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set — assistant requires Claude');
    _claude = new Anthropic({ apiKey: key });
  }
  return _claude;
}

async function callClaude(system: string, messages: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const client = getClaude();
  const start = Date.now();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system,
    messages,
  });
  const latency = Date.now() - start;
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
  console.log(`[assistant] Claude ${CLAUDE_MODEL} ${latency}ms, ${text.length} chars`);
  return text;
}

// ─── Types ───────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatBody {
  messages?: ChatMessage[];
  clientId?: string;
}

interface AgentAction {
  type: string;
  params: Record<string, any>;
  result: any;
}

// ─── System Prompt ───────────────────────────────────────────────

const RADIX_PERSONA = `You are **Radix** — the AI assistant inside Radix AI Content Planner, a premium content planning tool for agencies and brands.

PERSONALITY:
- Sharp, direct, and efficient — like a senior content strategist at a top Dubai agency
- Professional but approachable. Occasionally witty, never sycophantic
- You give straight answers. No filler like "Great question!" or "I'd be happy to help!"
- You know social media strategy, content planning, UAE market dynamics, and agency workflows
- When you don't know something, say so. Don't make things up

YOU CAN TAKE ACTIONS. When the user asks you to DO something (not just discuss it), respond with a JSON action object. Available actions:

ACTIONS:
1. list_clients — List all clients in the system
   → { "type": "action", "action": "list_clients", "params": {} }

2. get_brief — Get a client's content brief
   → { "type": "action", "action": "get_brief", "params": {} }

3. generate_content — Generate a month of content for the current client
   → { "type": "action", "action": "generate_content", "params": { "month": "May 2026", "count": 18 } }

4. search_visual_refs — Search Pinterest for visual inspiration
   → { "type": "action", "action": "search_visual_refs", "params": { "query": "luxury banking Dubai", "limit": 6 } }

5. get_calendar — Fetch calendar data for a specific month
   → { "type": "action", "action": "get_calendar", "params": { "month": "April 2026" } }

6. improve_prompt — Improve a creative prompt for image/video generation
   → { "type": "action", "action": "improve_prompt", "params": { "prompt": "a Dubai skyline at sunset" } }

7. delete_calendar — Delete a month's calendar to regenerate it
   → { "type": "action", "action": "delete_calendar", "params": { "month": "April 2026" } }

8. get_stats — Get dashboard statistics (clients, posts, approvals)
   → { "type": "action", "action": "get_stats", "params": {} }

9. research — Research a topic for content ideas
   → { "type": "action", "action": "research", "params": { "query": "Ramadan marketing trends UAE 2026" } }

10. update_post — Update a specific post's caption or status
    → { "type": "action", "action": "update_post", "params": { "postId": "...", "caption": "new caption", "status": "approved" } }

WHEN TO USE ACTIONS vs JUST RESPOND:
- User says "generate content for May" → ACTION (generate_content)
- User says "what platforms should I use?" → RESPOND (just text, no action)
- User says "search for luxury villa photos" → ACTION (search_visual_refs)
- User says "show me the brief" → ACTION (get_brief)
- User says "how many clients do I have?" → ACTION (list_clients)

RESPONSE FORMAT:
- If taking an action: respond with ONLY the JSON action object, nothing else
- If just chatting: respond with plain text (no JSON wrapper)

CRITICAL: When responding as plain text, do NOT wrap it in JSON. Just write naturally.`;

// ─── Action Executor ─────────────────────────────────────────────

async function executeAction(action: string, params: any, clientId: string | null): Promise<any> {
  switch (action) {
    case 'list_clients':
      return db.client.findMany({
        select: { id: true, name: true, industry: true, status: true },
        orderBy: { name: 'asc' },
      });

    case 'get_brief': {
      if (!clientId) return { error: 'No client selected' };
      const brief = await briefService.getByClientId(clientId);
      if (!brief) return { error: 'No brief found for this client' };
      return {
        objective: brief.objective,
        audience: brief.audience,
        tone: brief.tone,
        channels: brief.channels,
        pillars: brief.pillars,
        products: brief.products,
      };
    }

    case 'generate_content': {
      if (!clientId) return { error: 'No client selected' };
      const month = params?.month || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const count = params?.count || 18;
      // Check for duplicate
      const existing = await db.calendarMonth.findFirst({ where: { clientId, month } });
      if (existing) return { error: `Calendar for "${month}" already exists. Delete it first.`, existingId: existing.id };
      const job = createJob('generate-month', { clientId, month, pieceCount: count });
      processJob(job.id, generateMonthWorker);
      return { jobId: job.id, month, pieceCount: count, status: 'started' };
    }

    case 'search_visual_refs': {
      const query = params?.query || '';
      if (!query) return { error: 'search query is required' };
      const { results } = await searchPinterest(query, params?.limit || 6);
      return {
        count: results.length,
        images: results.map(r => ({
          title: r.title,
          thumbUrl: r.thumbUrl,
          pinUrl: r.pinUrl,
          width: r.width,
          height: r.height,
        })),
      };
    }

    case 'get_calendar': {
      if (!clientId) return { error: 'No client selected' };
      const month = params?.month;
      if (!month) {
        // Return list of all months
        const months = await db.calendarMonth.findMany({
          where: { clientId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, month: true, status: true, _count: { select: { posts: true } } },
        });
        return months.map(m => ({ month: m.month, status: m.status, postCount: m._count.posts }));
      }
      const cal = await db.calendarMonth.findFirst({
        where: { clientId, month },
        include: { posts: { select: { id: true, title: true, platform: true, status: true, caption: true } } },
      });
      if (!cal) return { error: `No calendar found for "${month}"` };
      return {
        month: cal.month,
        status: cal.status,
        posts: cal.posts.map(p => ({
          title: p.title,
          platform: p.platform,
          status: p.status,
          captionPreview: (p.caption || '').slice(0, 80),
        })),
      };
    }

    case 'improve_prompt': {
      const prompt = params?.prompt || '';
      if (!prompt) return { error: 'prompt text is required' };
      const improved = await callClaude(
        'You are a creative director. Improve the given image/video generation prompt to be more vivid, specific, and visually compelling. Return ONLY the improved prompt, nothing else.',
        [{ role: 'user', content: prompt }],
      );
      return { original: prompt, improved: improved.trim() };
    }

    case 'delete_calendar': {
      if (!clientId) return { error: 'No client selected' };
      const month = params?.month;
      if (!month) return { error: 'month is required' };
      const cal = await db.calendarMonth.findFirst({ where: { clientId, month } });
      if (!cal) return { error: `No calendar found for "${month}"` };
      await db.calendarPost.deleteMany({ where: { calendarMonthId: cal.id } });
      await db.calendarMonth.delete({ where: { id: cal.id } });
      return { deleted: true, month };
    }

    case 'get_stats': {
      const clients = await db.client.count();
      const posts = await db.calendarPost.count();
      const approved = await db.calendarPost.count({ where: { status: 'approved' } });
      const months = await db.calendarMonth.count();
      return { clients, posts, approved, months, approvalRate: posts > 0 ? Math.round((approved / posts) * 100) : 0 };
    }

    case 'research': {
      const query = params?.query || '';
      if (!query) return { error: 'query is required' };
      const researchResult = await callClaude(
        'You are a senior content strategist at a Dubai agency. Research the topic and provide 5-7 actionable content ideas with platform recommendations. Be specific to the UAE/GCC market when relevant. Return as structured text, not JSON.',
        [{ role: 'user', content: query }],
      );
      return { query, insights: researchResult.trim() };
    }

    case 'update_post': {
      const postId = params?.postId;
      if (!postId) return { error: 'postId is required' };
      const updateData: any = {};
      if (params?.caption) updateData.caption = params.caption;
      if (params?.status) updateData.status = params.status;
      if (params?.title) updateData.title = params.title;
      if (Object.keys(updateData).length === 0) return { error: 'Nothing to update — provide caption, status, or title' };
      const post = await db.calendarPost.update({ where: { id: postId }, data: updateData });
      return { updated: true, postId: post.id, title: post.title, status: post.status };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ─── Route ───────────────────────────────────────────────────────

export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  app.post('/assistant/chat', async (request, reply) => {
    const { messages, clientId } = (request.body as ChatBody) || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    // Build client context for the system prompt
    let clientContext = '';
    if (clientId) {
      try {
        const client = await db.client.findUnique({ where: { id: clientId }, include: { brief: true } });
        if (client) {
          clientContext = `\n\nCURRENT CLIENT: ${client.name}`;
          if (client.industry) clientContext += ` (${client.industry})`;
          if (client.brief?.objective) clientContext += `\nObjective: ${client.brief.objective}`;
          if (client.brief?.audience) clientContext += `\nAudience: ${client.brief.audience}`;
          if (client.brief?.tone) clientContext += `\nTone: ${client.brief.tone}`;
          if (client.brief?.channels) {
            const ch = typeof client.brief.channels === 'string' ? JSON.parse(client.brief.channels) : client.brief.channels;
            if (Array.isArray(ch)) clientContext += `\nChannels: ${ch.join(', ')}`;
          }
          if (client.brief?.pillars) clientContext += `\nContent Pillars: ${client.brief.pillars}`;
          if (client.brief?.products) clientContext += `\nProducts/Services: ${client.brief.products}`;
          // Add calendar stats
          const calStats = await db.calendarMonth.findMany({
            where: { clientId },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { month: true, status: true, _count: { select: { posts: true } } },
          });
          if (calStats.length > 0) {
            clientContext += `\nRecent calendars: ${calStats.map(c => `${c.month} (${c._count.posts} posts, ${c.status})`).join(', ')}`;
          }
        }
      } catch { /* best-effort */ }
    }

    const systemPrompt = RADIX_PERSONA + clientContext;

    // Format conversation for Claude's messages API
    const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      const start = Date.now();

      // Pass 1: Get Claude's response (might be an action or plain text)
      const pass1Text = await callClaude(systemPrompt, claudeMessages);

      let responseText = pass1Text.trim();
      let actionTaken: AgentAction | undefined;
      let totalLatency = Date.now() - start;

      // Check if the response is an action JSON
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && parsed.type === 'action' && parsed.action) {
          const actionName = parsed.action;
          const actionParams = parsed.params || {};

          // Execute the action
          const actionResult = await executeAction(actionName, actionParams, clientId || null);

          actionTaken = { type: actionName, params: actionParams, result: actionResult };

          // Audit log the action
          const userId = (request as any).user?.id;
          auditService.log({
            userId,
            clientId: clientId || undefined,
            action: `assistant:${actionName}`,
            entityType: 'Assistant',
            payload: { params: actionParams, resultSummary: JSON.stringify(actionResult).slice(0, 200) },
          });

          // Pass 2: Ask Claude to write a human-friendly summary of the action result
          const pass2Text = await callClaude(systemPrompt, [
            ...claudeMessages,
            { role: 'assistant', content: `[Executed "${actionName}" action]` },
            { role: 'user', content: `Action result:\n${JSON.stringify(actionResult, null, 2)}\n\nWrite a concise, friendly summary of what happened. Be specific about numbers and details. Don't repeat raw JSON — translate into natural language.` },
          ]);

          responseText = pass2Text.trim();
          totalLatency = Date.now() - start;
        }
      } catch {
        // Not JSON — it's a plain text response, which is fine
      }

      return {
        message: { role: 'assistant' as const, content: responseText },
        action: actionTaken,
        provider: 'claude',
        latencyMs: totalLatency,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Assistant call failed');
    }
  });
}
