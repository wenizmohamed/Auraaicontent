import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { sendAiError } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { briefService } from '../services/brief.service.js';
import { clientService } from '../services/client.service.js';
import { createJob, processJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { visualSearchService } from '../services/visual-search.service.js';
import { auditService } from '../services/audit.service.js';
import { chatText, type ProviderName } from '../services/llm/chat.js';
import { enrichWithKnowledge } from '../lib/knowledge-enricher.js';
import { enrichWithMemory } from '../lib/memory-enricher.js';
import { enrichWithBrandKit } from '../lib/brand-kit-enricher.js';

// ─── Assistant LLM ───────────────────────────────────────────────
// 2026-04-23: Weni's directive — Gemini 3.1 Pro is PRIMARY (Radix
// company-card key), Grok is fallback, Kimi K2 tertiary. The chain is
// implemented in services/llm/chat.ts → chatText().
async function callAssistantLLM(
  system: string,
  // content is string for plain turns, or an OpenAI multimodal parts array
  // ({type:'text'} + {type:'image_url'}) when the user attached image(s).
  messages: { role: 'user' | 'assistant'; content: any }[],
  meta?: { orgId?: string; userId?: string; clientId?: string },
): Promise<{ text: string; provider: ProviderName; model: string; latencyMs: number; fallbackUsed: boolean }> {
  // 4096 budget: Gemini 3 / Kimi K2 are thinking models that may burn
  // 500-2K tokens on reasoning_content BEFORE emitting visible content.
  // 2048 was getting truncated to empty on complex prompts; 4096 gives
  // ~2K output headroom after reasoning overhead.
  const r = await chatText({
    max_tokens: 4096,
    messages: [{ role: 'system', content: system }, ...messages],
  }, { chainEnv: process.env.ASSISTANT_PROVIDER_CHAIN, meta });
  console.log(`[assistant] ${r.provider}/${r.model} ${r.latencyMs}ms${r.fallbackUsed ? ' (fallback)' : ''}, ${r.text.length} chars`);
  return r;
}

// ─── Types ───────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatAttachment {
  dataUrl: string;       // data:<mime>;base64,<...>
  mimeType: string;
  name?: string;
  kind?: 'image' | 'video' | 'doc';
}

interface ChatBody {
  messages?: ChatMessage[];
  clientId?: string;
  // Files attached to the LATEST user turn (multimodal). Phase 1: images go
  // straight to the vision model; docs arrive as extracted text appended to the
  // message; video is not yet supported on the chat path.
  attachments?: ChatAttachment[];
  // Client-generated id for this turn. When present the finished reply is also
  // kept server-side so a reload mid-answer does not lose it.
  turnId?: string;
}

interface AgentAction {
  type: string;
  params: Record<string, any>;
  result: any;
}

// ─── System Prompt ───────────────────────────────────────────────

const RADIX_PERSONA = `You are **AURAAI**. The AI assistant inside AURAAI Content Planner, a premium content planning tool for agencies and brands.

PERSONALITY:
- Sharp, direct, and efficient. Like a senior content strategist at a top Dubai agency
- Professional but approachable. Occasionally witty, never sycophantic
- You give straight answers. No filler like "Great question!" or "I'd be happy to help!"
- You know social media strategy, content planning, UAE market dynamics, and agency workflows
- When you don't know something, say so. Don't make things up

YOU CAN TAKE ACTIONS. When the user asks you to DO something (not just discuss it), respond with a JSON action object. Available actions:

ACTIONS:
1. list_clients. List all clients in the system
   → { "type": "action", "action": "list_clients", "params": {} }

1b. create_client. Create a NEW client profile. Always use this when the user asks to "add", "create", or "set up" a client. Don't tell them to use the UI. You CAN do it here.
   → { "type": "action", "action": "create_client", "params": { "name": "Al Fardan Exchange", "industry": "Financial Services", "website": "https://alfardanexchange.com", "instagramHandle": "alfardan" } }
   (only "name" is required. Others are optional)

2. get_brief. Get a client's content brief
   → { "type": "action", "action": "get_brief", "params": {} }

3. generate_content. Generate a month of content for the current client
   → { "type": "action", "action": "generate_content", "params": { "month": "May 2026", "count": 18 } }

4. search_visual_refs. Search Pinterest for visual inspiration
   → { "type": "action", "action": "search_visual_refs", "params": { "query": "luxury banking Dubai", "limit": 6 } }

5. get_calendar. Fetch calendar data for a specific month
   → { "type": "action", "action": "get_calendar", "params": { "month": "April 2026" } }

6. improve_prompt. Improve a creative prompt for image/video generation
   → { "type": "action", "action": "improve_prompt", "params": { "prompt": "a Dubai skyline at sunset" } }

7. delete_calendar. Delete a month's calendar to regenerate it
   → { "type": "action", "action": "delete_calendar", "params": { "month": "April 2026" } }

8. get_stats. Get dashboard statistics (clients, posts, approvals)
   → { "type": "action", "action": "get_stats", "params": {} }

9. research. Research a topic for content ideas
   → { "type": "action", "action": "research", "params": { "query": "Ramadan marketing trends UAE 2026" } }

10. update_post. Update a specific post's caption or status
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

async function executeAction(orgId: string, action: string, params: any, clientId: string | null, userId?: string): Promise<any> {
  switch (action) {
    case 'list_clients':
      return db.client.findMany({
        where: { orgId },
        select: { id: true, name: true, industry: true, status: true },
        orderBy: { name: 'asc' },
      });

    case 'create_client': {
      const name = (params?.name || '').trim();
      if (!name) return { error: 'client name is required' };
      const industry = params?.industry?.trim();
      const website = params?.website?.trim();
      const instagramHandle = params?.instagramHandle?.trim();
      const existing = await db.client.findFirst({ where: { orgId, name: { equals: name, mode: 'insensitive' } }, select: { id: true, name: true, slug: true } });
      if (existing) {
        return { alreadyExists: true, id: existing.id, name: existing.name, slug: existing.slug, message: `"${existing.name}" already exists. Selecting it instead.` };
      }
      const client = await clientService.create(orgId, {
        name,
        ...(industry ? { industry } : {}),
        ...(website ? { website } : {}),
        ...(instagramHandle ? { instagramHandle } : {}),
      });
      return {
        created: true,
        id: client.id,
        name: client.name,
        slug: client.slug,
        industry: client.industry ?? null,
        message: `Created "${client.name}". Switch to it with the client selector, then upload a brief or ask me to draft content.`,
      };
    }

    case 'get_brief': {
      if (!clientId) return { error: 'No client selected' };
      const brief = await briefService.getByClientId(orgId, clientId);
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
      const existing = await db.calendarMonth.findFirst({ where: { orgId, clientId, month } });
      if (existing) return { error: `Calendar for "${month}" already exists. Delete it first.`, existingId: existing.id };
      const job = createJob('generate-month', { orgId, clientId, month, pieceCount: count });
      processJob(job.id, generateMonthWorker);
      return { jobId: job.id, month, pieceCount: count, status: 'started' };
    }

    case 'search_visual_refs': {
      const query = params?.query || '';
      if (!query) return { error: 'search query is required' };
      const { results, provider } = await visualSearchService.search(query, params?.limit || 8, { orgId, userId, clientId: clientId || undefined });
      return {
        count: results.length,
        provider,
        images: results.map(r => ({
          title: r.title,
          description: r.description,
          thumbUrl: r.thumbnailUrl,
          sourceUrl: r.sourceUrl,
          sourceDomain: r.sourceDomain,
        })),
      };
    }

    case 'get_calendar': {
      if (!clientId) return { error: 'No client selected' };
      const month = params?.month;
      if (!month) {
        // Return list of all months
        const months = await db.calendarMonth.findMany({
          where: { orgId, clientId, isArchived: false },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, month: true, status: true, _count: { select: { posts: true } } },
        });
        return months.map((m: any) => ({ month: m.month, status: m.status, postCount: m._count.posts }));
      }
      const cal = await db.calendarMonth.findFirst({
        where: { orgId, clientId, month },
        include: { posts: { select: { id: true, title: true, platform: true, status: true, caption: true } } },
      });
      if (!cal) return { error: `No calendar found for "${month}"` };
      return {
        month: cal.month,
        status: cal.status,
        posts: cal.posts.map((p: any) => ({
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
      const improved = await callAssistantLLM(
        'You are a creative director. Improve the given image/video generation prompt to be more vivid, specific, and visually compelling. Return ONLY the improved prompt, nothing else.',
        [{ role: 'user', content: prompt }],
        { orgId, userId, clientId: clientId || undefined },
      );
      return { original: prompt, improved: improved.text.trim() };
    }

    case 'delete_calendar': {
      if (!clientId) return { error: 'No client selected' };
      const month = params?.month;
      if (!month) return { error: 'month is required' };
      const cal = await db.calendarMonth.findFirst({ where: { orgId, clientId, month } });
      if (!cal) return { error: `No calendar found for "${month}"` };
      await db.calendarPost.deleteMany({ where: { orgId, calendarMonthId: cal.id } });
      await db.calendarMonth.delete({ where: { id: cal.id, orgId } });
      return { deleted: true, month };
    }

    case 'get_stats': {
      const liveFilter = { orgId, calendarMonth: { isArchived: false } };
      const clients = await db.client.count({ where: { orgId } });
      const posts = await db.calendarPost.count({ where: liveFilter });
      const approved = await db.calendarPost.count({ where: { status: 'approved', ...liveFilter } });
      const months = await db.calendarMonth.count({ where: { orgId, isArchived: false } });
      return { clients, posts, approved, months, approvalRate: posts > 0 ? Math.round((approved / posts) * 100) : 0 };
    }

    case 'research': {
      const query = params?.query || '';
      if (!query) return { error: 'query is required' };
      const researchResult = await callAssistantLLM(
        'You are a senior content strategist at a Dubai agency. Research the topic and provide 5-7 actionable content ideas with platform recommendations. Be specific to the UAE/GCC market when relevant. Return as structured text, not JSON.',
        [{ role: 'user', content: query }],
        { orgId, userId, clientId: clientId || undefined },
      );
      return { query, insights: researchResult.text.trim() };
    }

    case 'update_post': {
      const postId = params?.postId;
      if (!postId) return { error: 'postId is required' };
      const existing = await db.calendarPost.findUnique({ where: { id: postId, orgId }, select: { orgId: true } });
      if (!existing) return { error: 'post not found' };
      const updateData: any = {};
      if (params?.caption) updateData.caption = params.caption;
      if (params?.status) updateData.status = params.status;
      if (params?.title) updateData.title = params.title;
      if (Object.keys(updateData).length === 0) return { error: 'Nothing to update. Provide caption, status, or title' };
      const post = await db.calendarPost.update({ where: { id: postId, orgId }, data: updateData });
      return { updated: true, postId: post.id, title: post.title, status: post.status };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ─── Route ───────────────────────────────────────────────────────

// ─── Conversation store ──────────────────────────────────────────
// One row per (org, user): the widget's transcript, so it follows the user
// across devices, plus the latest chat reply keyed by the client's turn id.

const CONVERSATION_MAX_BYTES = 800_000;
const TURN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Keep the finished chat reply so the widget can collect it after a reload
 * that happened while the reply was still being generated. Best-effort. */
async function saveTurn(orgId: string, userId: string | undefined, turnId: unknown, payload: Record<string, unknown>): Promise<void> {
  if (!userId || typeof turnId !== 'string' || !TURN_ID_RE.test(turnId)) return;
  const lastTurn = { turnId, at: new Date().toISOString(), ...payload } as any;
  try {
    await db.assistantConversation.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId, data: {}, rev: 0, lastTurn },
      update: { lastTurn },
    });
  } catch (err: any) {
    console.warn('[assistant] turn persist failed:', err?.message || err);
  }
}

export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authGuard);

  // Load the saved conversation for the signed-in user in the active org.
  app.get('/assistant/conversation', async (request, reply) => {
    const orgId = request.orgId!;
    const userId = request.user?.userId;
    if (!userId) return reply.status(401).send({ error: 'Not signed in' });
    const row = await db.assistantConversation.findUnique({ where: { orgId_userId: { orgId, userId } } });
    return { data: row?.data ?? null, rev: row?.rev ?? 0 };
  });

  // Save it. `rev` is the client's timestamp of its last change: an older
  // write never overwrites a newer one (two tabs, or a second device).
  app.put('/assistant/conversation', async (request, reply) => {
    const orgId = request.orgId!;
    const userId = request.user?.userId;
    if (!userId) return reply.status(401).send({ error: 'Not signed in' });
    const body = (request.body ?? {}) as { data?: unknown; rev?: unknown };
    const data = body.data as { messages?: unknown } | undefined;
    const rev = typeof body.rev === 'number' && Number.isFinite(body.rev) ? body.rev : 0;
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
      return reply.status(400).send({ error: 'data.messages array is required' });
    }
    if (Buffer.byteLength(JSON.stringify(data)) > CONVERSATION_MAX_BYTES) {
      return reply.status(413).send({ error: 'Conversation is too large to save' });
    }
    const existing = await db.assistantConversation.findUnique({ where: { orgId_userId: { orgId, userId } }, select: { rev: true, data: true } });
    if (existing && existing.rev > rev) {
      return { saved: false, stale: true, data: existing.data, rev: existing.rev };
    }
    await db.assistantConversation.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId, data: data as any, rev },
      update: { data: data as any, rev },
    });
    return { saved: true, rev };
  });

  // Collect a chat reply by its turn id (see saveTurn).
  app.get('/assistant/turns/:turnId', async (request, reply) => {
    const orgId = request.orgId!;
    const userId = request.user?.userId;
    const { turnId } = request.params as { turnId: string };
    if (!userId) return reply.status(401).send({ error: 'Not signed in' });
    const row = await db.assistantConversation.findUnique({ where: { orgId_userId: { orgId, userId } }, select: { lastTurn: true } });
    const last = row?.lastTurn as { turnId?: string } | null | undefined;
    if (!last || last.turnId !== turnId) return { ready: false };
    return { ready: true, turn: last };
  });

  app.post('/assistant/chat', async (request, reply) => {
    const { messages, clientId, attachments, turnId } = (request.body as ChatBody) || {};
    const orgId = request.orgId!;
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    // Build client context for the system prompt
    let clientContext = '';
    if (clientId) {
      try {
        const client = await db.client.findUnique({ where: { id: clientId, orgId }, include: { briefs: { orderBy: { month: 'asc' }, take: 1 } } });
        if (client) {
          const cb: any = (client as any).briefs?.[0] ?? null;
          clientContext = `\n\nCURRENT CLIENT: ${client.name}`;
          if (client.industry) clientContext += ` (${client.industry})`;
          if (cb?.objective) clientContext += `\nObjective: ${cb.objective}`;
          if (cb?.audience) clientContext += `\nAudience: ${cb.audience}`;
          if (cb?.tone) clientContext += `\nTone: ${cb.tone}`;
          if (cb?.channels) {
            const ch = typeof cb.channels === 'string' ? JSON.parse(cb.channels) : cb.channels;
            if (Array.isArray(ch)) clientContext += `\nChannels: ${ch.join(', ')}`;
          }
          if (cb?.pillars) clientContext += `\nContent Pillars: ${cb.pillars}`;
          if (cb?.products) clientContext += `\nProducts/Services: ${cb.products}`;
          // Add calendar stats
          const calStats = await db.calendarMonth.findMany({
            where: { orgId, clientId },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { month: true, status: true, _count: { select: { posts: true } } },
          });
          if (calStats.length > 0) {
            clientContext += `\nRecent calendars: ${calStats.map((c: any) => `${c.month} (${c._count.posts} posts, ${c.status})`).join(', ')}`;
          }
        }
      } catch { /* best-effort */ }
    }

    let systemPrompt = RADIX_PERSONA + clientContext;

    // RAG grounding — the assistant runs on chat.ts (not aiRouter), so it must
    // run the SAME enrichers itself or it stays blind to the client's Knowledge
    // Base + Learnings + Brand Kit (the "it asks you to paste what's already
    // uploaded" bug). Retrieval query = the latest user turn. Each enricher is
    // gated (no client / no docs / no learnings → no-op) and best-effort.
    const lastUserText = [...messages].reverse().find(m => m.role === 'user')?.content?.trim() || '';
    if (orgId && lastUserText) {
      try {
        systemPrompt = await enrichWithKnowledge(systemPrompt, orgId, clientId, lastUserText, {});
        systemPrompt = await enrichWithMemory(systemPrompt, orgId, clientId, lastUserText, {});
        systemPrompt = await enrichWithBrandKit(systemPrompt, clientId, { orgId });
      } catch { /* best-effort, never block the chat on enrichment */ }
    }

    // Format conversation for the chat API
    const grokMessages: { role: 'user' | 'assistant'; content: any }[] = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Multimodal: fold attached IMAGES into the latest user turn as OpenAI
    // image_url parts so the vision model (Gemini primary) actually sees them.
    // (Docs/video handled separately later — for now non-image attachments are
    // noted in text so the model knows they exist.)
    const imageAtts = (attachments || []).filter(a => a?.dataUrl && (a.kind === 'image' || a.mimeType?.startsWith('image/')));
    const otherAtts = (attachments || []).filter(a => !imageAtts.includes(a));
    if ((imageAtts.length || otherAtts.length) && grokMessages.length) {
      const lastIdx = grokMessages.length - 1;
      const last = grokMessages[lastIdx];
      if (last.role === 'user') {
        let textPart = (typeof last.content === 'string' ? last.content : '') || 'Use the attached file(s).';
        if (otherAtts.length) {
          textPart += `\n\n[Attached (not yet readable inline): ${otherAtts.map(a => a.name || a.mimeType).join(', ')}]`;
        }
        grokMessages[lastIdx] = {
          role: 'user',
          content: [
            { type: 'text', text: textPart },
            ...imageAtts.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } })),
          ],
        };
      }
    }

    try {
      const start = Date.now();

      // Pass 1: Get the assistant's response (might be an action JSON or plain text).
      const userId = request.user?.userId;
      const meta = { orgId, userId, clientId: clientId || undefined };
      const pass1 = await callAssistantLLM(systemPrompt, grokMessages, meta);
      let responseText = pass1.text.trim();
      let actionTaken: AgentAction | undefined;
      let totalLatency = Date.now() - start;
      let providerUsed = pass1.provider as string;

      // Check if the response is an action JSON.  Gemini frequently wraps
      // JSON in ```json ... ``` markdown fences; strip those defensively
      // before parsing so the action branch actually fires.  Without this
      // strip the user gets a raw fenced-JSON message and no action runs
      // (seen on "create new client" + "generate N pieces" on 2026-04-23).
      const stripped = responseText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      try {
        const parsed = JSON.parse(stripped);
        if (parsed && parsed.type === 'action' && parsed.action) {
          const actionName = parsed.action;
          const actionParams = parsed.params || {};

          // Execute the action
          const actionResult = await executeAction(orgId, actionName, actionParams, clientId || null, userId);

          actionTaken = { type: actionName, params: actionParams, result: actionResult };

          // Audit log the action
          auditService.log({
            orgId,
            userId,
            clientId: clientId || undefined,
            action: `assistant:${actionName}`,
            entityType: 'Assistant',
            payload: { params: actionParams, resultSummary: JSON.stringify(actionResult).slice(0, 200) },
          });

          // Pass 2: Ask the assistant to write a human-friendly summary of the action result.
          const pass2 = await callAssistantLLM(systemPrompt, [
            ...grokMessages,
            { role: 'assistant', content: `[Executed "${actionName}" action]` },
            { role: 'user', content: `Action result:\n${JSON.stringify(actionResult, null, 2)}\n\nWrite a concise, friendly summary of what happened. Be specific about numbers and details. Don't repeat raw JSON. Translate into natural language.` },
          ], meta);

          responseText = pass2.text.trim();
          totalLatency = Date.now() - start;
          providerUsed = pass2.provider as string;
        }
      } catch {
        // Not JSON — it's a plain text response, which is fine
      }

      const payload = {
        message: { role: 'assistant' as const, content: responseText },
        action: actionTaken,
        provider: providerUsed,
        latencyMs: totalLatency,
      };
      await saveTurn(orgId, request.user?.userId, turnId, payload);
      return payload;
    } catch (err) {
      await saveTurn(orgId, request.user?.userId, turnId, { error: err instanceof Error ? err.message.slice(0, 300) : 'Assistant call failed' });
      return sendAiError(reply, err, 'Assistant call failed');
    }
  });
}
