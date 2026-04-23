// Tool-calling loop using Anthropic Messages API.
// Streams assistant text deltas as agent:message events, executes tool calls
// against the registry, feeds tool_result blocks back into the conversation.
// Max 10 iterations (safety cap). Aborts on ctx.signal.

import Anthropic from '@anthropic-ai/sdk';
import { TOOL_BY_NAME, toAnthropicTools } from './tools/index.js';
import type { ToolContext } from './tool-types.js';

// Superagent LRN-20260420-008 finding #4: 10 was too tight for manus-grade
// workflows (scrape -> analyze -> gen -> caption -> compliance chains
// routinely hit 14-16 iters).  20 keeps the safety cap but stops truncating
// valid multi-client plans.
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS ?? '20', 10);
const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
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
  messages: Message[];
  error?: string;
}

export async function runAgentLoop({ input, ctx }: RunAgentArgs): Promise<RunAgentResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const messages: Message[] = [{ role: 'user', content: input }];
  const tools = toAnthropicTools();

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

    let stream;
    try {
      stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tools,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content as string | Anthropic.Messages.ContentBlockParam[],
        })),
      });
    } catch (err) {
      if (isAbortError(err)) {
        await ctx.emit('agent:error', { message: 'Aborted by user', at: new Date().toISOString() });
        return { iterations: iter, stopReason: 'aborted', messages };
      }
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.emit('agent:error', { message: `LLM call failed: ${msg}`, at: new Date().toISOString() });
      return { iterations: iter, stopReason: 'error', messages, error: msg };
    }

    let streamingBuffer = '';
    stream.on('text', async (delta: string) => {
      streamingBuffer += delta;
      // throttle: emit per ~120 chars
      if (streamingBuffer.length >= 120 || delta.includes('\n')) {
        const flushed = streamingBuffer;
        streamingBuffer = '';
        await ctx.emit('agent:message', {
          text: flushed,
          streaming: true,
          at: new Date().toISOString(),
        });
      }
    });

    let finalMessage;
    try {
      finalMessage = await stream.finalMessage();
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

    const assistantBlocks: ContentBlock[] = finalMessage.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') {
        return { type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> };
      }
      return { type: 'text', text: '' };
    });
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Emit any standalone thought text blocks (if no streaming buffer captured them).
    for (const block of assistantBlocks) {
      if (block.type === 'text' && block.text.trim()) {
        // streaming already emitted these — skip re-emit to avoid double
      }
    }

    if (finalMessage.stop_reason === 'end_turn' || finalMessage.stop_reason === 'stop_sequence') {
      const summary = assistantBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .slice(0, 500);
      await ctx.emit('agent:complete', { at: new Date().toISOString(), summary });
      return { iterations: iter + 1, stopReason: 'end_turn', messages };
    }

    if (finalMessage.stop_reason !== 'tool_use') {
      await ctx.emit('agent:complete', { at: new Date().toISOString() });
      return { iterations: iter + 1, stopReason: 'end_turn', messages };
    }

    // Execute all tool_use blocks
    const toolResults: ContentBlock[] = [];
    for (const block of assistantBlocks) {
      if (block.type !== 'tool_use') continue;
      if (ctx.signal.aborted) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Aborted',
          is_error: true,
        });
        continue;
      }

      const tool = TOOL_BY_NAME[block.name];
      await ctx.emit('agent:tool_start', {
        toolCallId: block.id,
        tool: block.name,
        args: block.input,
        at: new Date().toISOString(),
      });

      if (!tool) {
        await ctx.emit('agent:tool_result', {
          toolCallId: block.id,
          tool: block.name,
          ok: false,
          error: `Unknown tool: ${block.name}`,
          at: new Date().toISOString(),
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      try {
        const result = await tool.handler(block.input as never, ctx);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        await ctx.emit('agent:tool_result', {
          toolCallId: block.id,
          tool: block.name,
          ok: true,
          result,
          at: new Date().toISOString(),
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultStr.slice(0, 20000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.emit('agent:tool_result', {
          toolCallId: block.id,
          tool: block.name,
          ok: false,
          error: msg,
          at: new Date().toISOString(),
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  await ctx.emit('agent:error', {
    message: `Hit max iterations (${MAX_ITERATIONS}) without completion`,
    at: new Date().toISOString(),
  });
  return { iterations: MAX_ITERATIONS, stopReason: 'max_iterations', messages };
}
