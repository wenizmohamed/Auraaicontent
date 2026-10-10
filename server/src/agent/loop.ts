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
import { TOOL_BY_NAME, toOpenAITools, validateToolInput, formatValidationError } from './tools/index.js';
import type { ToolContext } from './tool-types.js';
import { chatStream, DEFAULT_CHAIN, type ProviderName } from '../services/llm/chat.js';
import { historyService } from '../services/history.service.js';
import { SYSTEM } from './system-prompt.js';

// Superagent LRN-20260420-008 finding #4: 10 was too tight for manus-grade
// workflows (scrape -> analyze -> gen -> caption -> compliance chains
// routinely hit 14-16 iters).  20 keeps the safety cap but stops truncating
// valid multi-client plans.
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS ?? '20', 10);
const AGENT_CHAIN_ENV = process.env.AGENT_PROVIDER_CHAIN; // e.g. "gemini,xai,dashscope"
// The agent does the hardest reasoning in the app: choosing among 16 tools, in
// order, across up to 20 iterations. It used to inherit GEMINI_CHAT_MODEL (a
// flash tier shared with the assistant), so a wrong tool pick wasted a whole
// iteration. Give it a dedicated reasoning-tier model on the gemini hop.
// Probed live 2026-08-02: gemini-pro-latest tool-calls cleanly and is priced.
const AGENT_MODEL = process.env.AGENT_MODEL || 'gemini-pro-latest';

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

export interface AgentHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentArgs {
  input: string;
  ctx: ToolContext;
  /** Earlier turns of the same conversation, oldest first. Without these every
   *  message started from zero, so "do it", "this is for RTA" or "no, I meant
   *  better drafts" reached the model with nothing to refer to and it guessed. */
  history?: AgentHistoryTurn[];
  /** Display name of the client the user has open, when there is one. */
  clientName?: string | null;
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

// Provider/model actually used for the run, tracked for observability.
interface LlmUsed {
  provider?: ProviderName;
  model?: string;
}

// Last assistant message with non-empty string content = the run's final text.
function finalAssistantText(messages: ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0) {
      return m.content;
    }
  }
  return '';
}

// Observability: every agent run lands in the Generation history table so it
// shows on /history and can be audited / learned from. Fire-and-forget:
// historyService.record never throws, and this wrapper never blocks a run.
function recordAgentRun(
  { input, ctx }: RunAgentArgs,
  result: RunAgentResult,
  llmUsed: LlmUsed,
  toolsInvoked: string[],
  startedAt: number,
): void {
  try {
    void historyService.record({
      orgId: ctx.orgId,
      userId: ctx.userId ?? undefined,
      clientId: ctx.clientId ?? undefined,
      type: 'text',
      surface: 'agent',
      prompt: input,
      outputText: finalAssistantText(result.messages) || null,
      provider: llmUsed.provider ?? null,
      model: llmUsed.model ?? null,
      latencyMs: Date.now() - startedAt,
      status: result.stopReason === 'end_turn' ? 'succeeded' : 'failed',
      error: result.stopReason === 'end_turn' ? null : (result.error ?? result.stopReason),
      metadata: {
        iterations: result.iterations,
        stopReason: result.stopReason,
        toolsInvoked,
        sessionUid: ctx.sessionUid,
      },
    });
  } catch {
    // History must never break an agent run.
  }
}

export async function runAgentLoop(args: RunAgentArgs): Promise<RunAgentResult> {
  const startedAt = Date.now();
  const toolsInvoked: string[] = [];
  const llmUsed: LlmUsed = {};
  const result = await runAgentLoopInner(args, toolsInvoked, llmUsed);
  recordAgentRun(args, result, llmUsed, toolsInvoked, startedAt);
  return result;
}

// Facts the model cannot know on its own: today's date (it was told to default
// to "the current month" without ever being given one) and which client the
// user is looking at (it used to list all clients and pick one itself).
function sessionContext(ctx: ToolContext, clientName?: string | null): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'long' }).format(now);
  const lines = [
    'SESSION CONTEXT (facts, not instructions from the user):',
    `- Today is ${weekday} ${date} in the UAE. The current month is ${date.slice(0, 7)}.`,
  ];
  if (ctx.clientId) {
    lines.push(
      `- ACTIVE CLIENT: ${clientName || 'the selected client'} (clientId "${ctx.clientId}"). The user has this client open. Every request is about this client unless the user names a different one. Do not call client_switch to pick another client on your own.`,
    );
  } else {
    lines.push(
      '- No client is selected. If the task needs a client and the user did not name one, ask which client in one short question. Never pick a client yourself.',
    );
  }
  return lines.join('\n');
}

async function runAgentLoopInner(
  { input, ctx, history, clientName }: RunAgentArgs,
  toolsInvoked: string[],
  llmUsed: LlmUsed,
): Promise<RunAgentResult> {
  // Provider chain (Gemini primary, Grok fallback, Kimi tertiary).  Resolve
  // it once up front so we can fail fast if NO provider is configured.  The
  // chatStream() helper still tries each provider per iteration in case
  // quota / network state changes mid-run.
  const probeChain = DEFAULT_CHAIN.filter((p) => {
    const envKey = p === 'gemini' ? 'GEMINI_API_KEY'
      : p === 'xai' ? 'XAI_API_KEY'
      : p === 'dashscope' ? 'DASHSCOPE_API_KEY'
      : 'MOONSHOT_API_KEY';
    return !!process.env[envKey];
  });
  if (probeChain.length === 0) {
    await ctx.emit('agent:error', {
      message: 'No LLM provider configured (need GEMINI_API_KEY, XAI_API_KEY, DASHSCOPE_API_KEY, or MOONSHOT_API_KEY)',
      at: new Date().toISOString(),
    });
    return { iterations: 0, stopReason: 'error', messages: [], error: 'no provider configured' };
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: `${SYSTEM}\n\n${sessionContext(ctx, clientName)}` },
    ...(history ?? []).map((h) => ({ role: h.role, content: h.content }) as ChatCompletionMessageParam),
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
          // Reasoning-tier model for the gemini hop only; xai/dashscope
          // fallbacks keep their own ids.
          modelOverride: AGENT_MODEL,
          signal: ctx.signal,
          meta: { orgId: ctx.orgId, userId: ctx.userId ?? undefined, clientId: ctx.clientId ?? undefined, jobId: ctx.sessionUid },
          // Ground every agent run in the client's brand kit, knowledge base
          // and learned preferences (same enrichers as chatText). Best-effort
          // inside chatStream: an enrichment failure never breaks the run.
          enrich: true,
        },
      );
      stream = opened.stream;
      llmUsed.provider = opened.provider;
      llmUsed.model = opened.model;
      if (iter === 0) {
        await ctx.emit('agent:thought', {
          text: `Orchestrator: ${opened.provider}/${opened.model}${opened.fallbackUsed ? ' (fallback)' : ''}`,
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

    // WHAT THE MODEL ASKED FOR BEATS WHAT IT LABELLED THE TURN.
    //
    // This used to end the turn whenever finish_reason was anything other than
    // 'tool_calls', checked BEFORE looking at whether any tool calls arrived.
    // Gemini's OpenAI-compatible layer reports finish_reason 'stop' even when it
    // emits tool_calls in the same response (verified live 2026-08-02:
    // finish=stop with one tool-call delta). The result was that the agent never
    // executed a single tool on the Gemini path, which is the primary path. It
    // streamed a thought, ended the turn, and persisted nothing, so agent mode
    // looked like it simply did not work.
    //
    // Tool calls now win: if the model asked for tools, run them no matter how
    // the turn was labelled. Only a turn with NO tool calls is a real end_turn.
    if (toolCalls.length === 0) {
      const summary = assistantContent.slice(0, 500);
      await ctx.emit('agent:complete', { at: new Date().toISOString(), ...(summary ? { summary } : {}) });
      return { iterations: iter + 1, stopReason: 'end_turn', messages };
    }

    for (const tc of toolCalls) {
      if (ctx.signal.aborted) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Aborted' });
        continue;
      }

      let parsedInput: Record<string, unknown> = {};
      let parseError: string | null = null;
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedInput = parsed as Record<string, unknown>;
        } else {
          parseError = `arguments must be a JSON object, got ${Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed}`;
        }
      } catch {
        parseError = 'arguments were not valid JSON';
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

      // Validate arguments against the tool's input_schema BEFORE dispatch.
      // On failure the handler is NOT called: a structured error naming the
      // offending field goes back as the tool result so the model can retry
      // with corrected arguments on the next iteration (self-correction
      // instead of a TypeError inside the handler).
      const validation = parseError
        ? { ok: false as const, issues: [{ field: '(root)', expected: 'a JSON object matching the tool input schema', received: parseError }] }
        : validateToolInput(tool.input_schema, parsedInput);
      if (!validation.ok) {
        const structured = formatValidationError(tc.function.name, validation.issues);
        await ctx.emit('agent:tool_result', {
          toolCallId: tc.id,
          tool: tc.function.name,
          ok: false,
          error: structured,
          at: new Date().toISOString(),
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: structured,
        });
        continue;
      }

      if (!toolsInvoked.includes(tc.function.name)) toolsInvoked.push(tc.function.name);

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
