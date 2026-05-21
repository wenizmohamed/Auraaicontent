// Tool-calling loop using OpenAI-compatible Chat Completions across the
// Gemini → Grok → Kimi fallback chain (Weni 2026-04-23: Gemini 3.1 Pro is
// PRIMARY because the API key is billed to the Radix company card).
// Streams assistant text deltas as `agent:message` events, executes
// tool_calls against the registry, feeds tool results back as role:'tool'
// messages.  Max 20 iterations (safety cap).  Aborts on ctx.signal.
//
// Provider switching happens BEFORE the stream starts; once chunks are
// flowing we don't switch mid-stream (would drop partial output).

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { TOOL_BY_NAME, toOpenAITools } from './tools/index.js';
import type { ToolContext } from './tool-types.js';
import { chatStream, DEFAULT_CHAIN, type ProviderName } from '../services/llm/chat.js';

// Superagent LRN-20260420-008 finding #4: 10 was too tight for manus-grade
// workflows (scrape -> analyze -> gen -> caption -> compliance chains
// routinely hit 14-16 iters).  20 keeps the safety cap but stops truncating
// valid multi-client plans.
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS ?? '20', 10);
const AGENT_CHAIN_ENV = process.env.AGENT_PROVIDER_CHAIN; // e.g. "gemini,xai,moonshot"

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

const SYSTEM = `You are Radix's content-ops agent. You orchestrate a social media pipeline for UAE brands.

Available tools let you read client briefs, generate content pieces, plan calendars, write captions, research hashtags, check compliance, switch clients, generate images, and scrape competitors.

PERSISTENCE RULE (non-negotiable — this is the app's core contract):
Every content artifact you produce MUST be persisted to the database so the
user sees it on /calendar, /content-review, and /pieces.  The chat stream is
a progress feed, not a deliverable.
- pieces_generate persists by default (persist=true).  Call it once per month
  you want to populate — it creates CalendarMonth + one CalendarPost per
  piece and returns \`postIds\` you can target with refinement tools.
- caption_write: ALWAYS pass the real CalendarPost id as \`pieceId\`.  It will
  write the new caption back to CalendarPost.caption and bump version.
- hashtag_research: pass \`postId\` whenever you research for a specific post.
  It merges tags into CalendarPost.hashtags.
- compliance_check: pass \`postId\` whenever you audit a persisted post.  It
  writes findings to CalendarPost.metadata.compliance.
- calendar_plan: only invoke when you already have pieces from a previous
  persist=false run OR when moving/retiming pieces.  If pieces_generate
  persisted this turn, DO NOT call calendar_plan — the rows are already there.
- If the user doesn't specify a month, default to the current YYYY-MM in UAE
  (Asia/Dubai) time.
- Never end a turn with unsaved captions, pieces, hashtags, or compliance
  findings.  "The row must be visible on /calendar" is the acceptance test.

Default workflow for a full month plan:
  1. client_switch → resolve target client
  2. brief_analyze → load normalized brief
  3. (optional) competitor_scrape → gather reference patterns
  4. pieces_generate (persist=true) → drafts AND writes 18 posts
  5. compliance_check(postId=…) per post → annotate issues into metadata
  6. caption_write(pieceId=postId) per flagged post → updates caption + PostVersion
  7. hashtag_research(postId=…) per post → merges tags
  8. image_generate → create hero visuals (already persists to Asset)

Be concise in your reasoning.  Emit thoughts, not filler.  When a tool returns,
briefly acknowledge what it gave you then continue.  Stop when the user's
request is satisfied AND every content artifact has a postId in the database.`;

export interface RunAgentArgs {
  input: string;
  ctx: ToolContext;
}

export interface RunAgentResult {
  iterations: number;
  stopReason: 'end_turn' | 'max_iterations' | 'aborted' | 'error';
  messages: ChatCompletionMessageParam[];
  error?: string;
}

interface PartialToolCall {
  id?: string;
  name?: string;
  argsBuf: string;
}

export async function runAgentLoop({ input, ctx }: RunAgentArgs): Promise<RunAgentResult> {
  // Provider chain (Gemini primary, Grok fallback, Kimi tertiary).  Resolve
  // it once up front so we can fail fast if NO provider is configured.  The
  // chatStream() helper still tries each provider per iteration in case
  // quota / network state changes mid-run.
  const probeChain = DEFAULT_CHAIN.filter((p) => {
    const envKey = p === 'gemini' ? 'GEMINI_API_KEY' : p === 'xai' ? 'XAI_API_KEY' : 'MOONSHOT_API_KEY';
    return !!process.env[envKey];
  });
  if (probeChain.length === 0) {
    await ctx.emit('agent:error', {
      message: 'No LLM provider configured (need GEMINI_API_KEY, XAI_API_KEY, or MOONSHOT_API_KEY)',
      at: new Date().toISOString(),
    });
    return { iterations: 0, stopReason: 'error', messages: [], error: 'no provider configured' };
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: input },
  ];
  const tools = toOpenAITools() as ChatCompletionTool[];

  await ctx.emit('agent:start', {
    sessionUid: ctx.sessionUid,
    input,
    at: new Date().toISOString(),
  });

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (ctx.signal.aborted) {
      await ctx.emit('agent:error', { message: 'Aborted by user', at: new Date().toISOString() });
      return { iterations: iter, stopReason: 'aborted', messages };
    }

    let stream: AsyncIterable<import('openai/resources/chat/completions').ChatCompletionChunk>;
    let providerUsed: ProviderName;
    let modelUsed: string;
    try {
      const opened = await chatStream(
        {
          // 6144 budget: Gemini 3 thinking mode can consume 1-2K tokens on
          // reasoning_content before emitting visible content or tool_calls.
          // 4096 was occasionally cutting off in the middle of multi-tool
          // iterations. 6144 covers typical reasoning + tool JSON + narrative.
          max_tokens: 6144,
          messages,
          tools,
        },
        {
          chainEnv: AGENT_CHAIN_ENV,
          signal: ctx.signal,
          meta: { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: ctx.clientId ?? undefined, jobId: ctx.sessionUid },
        },
      );
      stream = opened.stream;
      providerUsed = opened.provider;
      modelUsed = opened.model;
      if (iter === 0) {
        await ctx.emit('agent:thought', {
          text: `Orchestrator: ${providerUsed}/${modelUsed}${opened.fallbackUsed ? ' (fallback)' : ''}`,
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      if (isAbortError(err)) {
        await ctx.emit('agent:error', { message: 'Aborted by user', at: new Date().toISOString() });
        return { iterations: iter, stopReason: 'aborted', messages };
      }
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.emit('agent:error', { message: `All LLM providers failed: ${msg}`, at: new Date().toISOString() });
      return { iterations: iter, stopReason: 'error', messages, error: msg };
    }
    void providerUsed;
    void modelUsed;

    let assistantContent = '';
    let streamingBuffer = '';
    const partialCalls = new Map<number, PartialToolCall>();
    let finishReason: string | null = null;

    try {
      for await (const chunk of stream) {
        if (ctx.signal.aborted) break;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.content) {
          assistantContent += delta.content;
          streamingBuffer += delta.content;
          if (streamingBuffer.length >= 120 || delta.content.includes('\n')) {
            const flushed = streamingBuffer;
            streamingBuffer = '';
            await ctx.emit('agent:message', {
              text: flushed,
              streaming: true,
              at: new Date().toISOString(),
            });
          }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            let entry = partialCalls.get(idx);
            if (!entry) {
              entry = { argsBuf: '' };
              partialCalls.set(idx, entry);
            }
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.argsBuf += tc.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (err) {
      if (isAbortError(err)) {
        await ctx.emit('agent:error', { message: 'Aborted by user', at: new Date().toISOString() });
        return { iterations: iter, stopReason: 'aborted', messages };
      }
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.emit('agent:error', { message: `Stream failed: ${msg}`, at: new Date().toISOString() });
      return { iterations: iter, stopReason: 'error', messages, error: msg };
    }

    if (streamingBuffer.length > 0) {
      await ctx.emit('agent:message', {
        text: streamingBuffer,
        streaming: false,
        at: new Date().toISOString(),
      });
    }

    const toolCalls: ChatCompletionMessageToolCall[] = [...partialCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, e]) => e.name && e.id)
      .map(([idx, e]) => ({
        id: e.id ?? `call_${Date.now()}_${idx}`,
        type: 'function' as const,
        function: { name: e.name ?? '', arguments: e.argsBuf || '{}' },
      }));

    const assistantMsg: ChatCompletionMessageParam =
      toolCalls.length > 0
        ? {
            role: 'assistant',
            content: assistantContent || null,
            tool_calls: toolCalls,
          }
        : { role: 'assistant', content: assistantContent };
    messages.push(assistantMsg);

    if (finishReason && finishReason !== 'tool_calls') {
      const summary = assistantContent.slice(0, 500);
      await ctx.emit('agent:complete', { at: new Date().toISOString(), summary });
      return { iterations: iter + 1, stopReason: 'end_turn', messages };
    }

    if (toolCalls.length === 0) {
      await ctx.emit('agent:complete', { at: new Date().toISOString() });
      return { iterations: iter + 1, stopReason: 'end_turn', messages };
    }

    for (const tc of toolCalls) {
      if (ctx.signal.aborted) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Aborted' });
        continue;
      }

      let parsedInput: Record<string, unknown>;
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch {
        parsedInput = {};
      }

      const tool = TOOL_BY_NAME[tc.function.name];
      await ctx.emit('agent:tool_start', {
        toolCallId: tc.id,
        tool: tc.function.name,
        args: parsedInput,
        at: new Date().toISOString(),
      });

      if (!tool) {
        await ctx.emit('agent:tool_result', {
          toolCallId: tc.id,
          tool: tc.function.name,
          ok: false,
          error: `Unknown tool: ${tc.function.name}`,
          at: new Date().toISOString(),
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Unknown tool: ${tc.function.name}`,
        });
        continue;
      }

      try {
        const result = await tool.handler(parsedInput as never, ctx);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        await ctx.emit('agent:tool_result', {
          toolCallId: tc.id,
          tool: tc.function.name,
          ok: true,
          result,
          at: new Date().toISOString(),
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr.slice(0, 20000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.emit('agent:tool_result', {
          toolCallId: tc.id,
          tool: tc.function.name,
          ok: false,
          error: msg,
          at: new Date().toISOString(),
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${msg}`,
        });
      }
    }
  }

  await ctx.emit('agent:error', {
    message: `Hit max iterations (${MAX_ITERATIONS}) without completion`,
    at: new Date().toISOString(),
  });
  return { iterations: MAX_ITERATIONS, stopReason: 'max_iterations', messages };
}
