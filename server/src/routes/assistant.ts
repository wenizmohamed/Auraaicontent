import { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/auth.js';
import { aiRouter } from '../services/providers/ai-router.js';
import { sendAiError } from '../services/providers/errors.js';
import { db } from '../db/prisma.js';
import { briefService } from '../services/brief.service.js';
import { createJob, processJob } from '../workers/queue.js';
import { generateMonthWorker } from '../workers/generateMonth.worker.js';
import { searchPinterest } from '../services/pinterest.service.js';
import { auditService } from '../services/audit.service.js';

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
      const result = await aiRouter.text({
        prompt: `You are a creative director. Improve this image/video generation prompt to be more vivid, specific, and visually compelling. Return ONLY the improved prompt, nothing else.\n\nOriginal: ${prompt}`,
      });
      return { original: prompt, improved: typeof result.output === 'string' ? result.output : JSON.stringify(result.output) };
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
        }
      } catch { /* best-effort */ }
    }

    const systemPrompt = RADIX_PERSONA + clientContext;

    // Format conversation
    const conversation = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    try {
      // Pass 1: Get AI response (might be an action or plain text)
      const pass1 = await aiRouter.text({
        prompt: `${conversation}\n\nAssistant:`,
        system: systemPrompt,
      });

      let responseText = typeof pass1.output === 'string' ? pass1.output.trim() : JSON.stringify(pass1.output);
      let actionTaken: AgentAction | undefined;
      let totalLatency = pass1.latencyMs;

      // Check if the response is an action JSON
      try {
        const parsed = typeof pass1.output === 'object' ? pass1.output : JSON.parse(responseText);
        if (parsed && (parsed as any).type === 'action' && (parsed as any).action) {
          const actionName = (parsed as any).action;
          const actionParams = (parsed as any).params || {};

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

          // Pass 2: Ask AI to write a human-friendly summary of the action result
          const pass2 = await aiRouter.text({
            prompt: `${conversation}\n\nAssistant: [I executed the "${actionName}" action]\n\nAction result:\n${JSON.stringify(actionResult, null, 2)}\n\nNow write a concise, friendly summary of what happened for the user. Be specific about numbers and details. Don't repeat the raw JSON — translate it into natural language.\n\nAssistant:`,
            system: systemPrompt,
          });

          responseText = typeof pass2.output === 'string' ? pass2.output.trim() : JSON.stringify(pass2.output);
          totalLatency += pass2.latencyMs;
        }
      } catch {
        // Not JSON — it's a plain text response, which is fine
      }

      return {
        message: { role: 'assistant' as const, content: responseText },
        action: actionTaken,
        provider: pass1.provider,
        latencyMs: totalLatency,
      };
    } catch (err: any) {
      return sendAiError(reply, err, 'Assistant call failed');
    }
  });
}
