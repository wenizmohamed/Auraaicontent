import type {
  AiProvider,
  AnalysisRequest,
  ImageRequest,
  ProviderResult,
  TextRequest,
  VideoRequest,
} from './types.js';
import { AiProviderError, AiCancelledError, abortReasonText, throwIfCancelled } from './errors.js';
import { runModelLadder, readLadder } from './model-chain.js';

const TIMEOUT = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '120000', 10);
const CLAUDE_CODE_ANCHOR = "You are Claude Code, Anthropic's official CLI for Claude.";

function baseUrl(): string {
  const raw = (process.env.ANTHROPIC_BASE_URL || 'https://claudeapikey.dev').replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

function getKey(): string {
  const key = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiProviderError('anthropic', 'init', 'ANTHROPIC_AUTH_TOKEN not set', 401);
  return key;
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function balancedJsonSlice(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function safeJsonParse(raw: string, label: string): any {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const balanced = balancedJsonSlice(cleaned);
    if (balanced) {
      try { return JSON.parse(balanced); } catch { /* fall through */ }
    }
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    throw new AiProviderError('anthropic', label, `JSON parse failed. Response: ${raw.slice(0, 200)}`);
  }
}

async function anthropicFetch(
  path: string,
  body: object,
  opts: { timeoutMs?: number; signal?: AbortSignal; label?: string } = {},
): Promise<any> {
  const label = opts.label || 'text';
  throwIfCancelled(opts.signal, label);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const key = getKey();
    const res = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
        'x-app': 'cli',
        'User-Agent': 'claude-cli/2.1.0 (external, cli)',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new AiProviderError('anthropic', label, `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AiProviderError('anthropic', label, `unparseable response: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    if (opts.signal?.aborted) throw new AiCancelledError(label, abortReasonText(opts.signal));
    if (timedOut) throw new AiProviderError('anthropic', label, `timeout after ${timeoutMs}ms`, 504);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function extractTextContent(data: any): string {
  if (Array.isArray(data?.content)) {
    const textParts = data.content
      .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text);
    if (textParts.length > 0 && textParts.join('').trim()) {
      return textParts.join('\n').trim();
    }
    const thinkingParts = data.content
      .filter((b: any) => b && b.type === 'thinking' && typeof b.thinking === 'string')
      .map((b: any) => b.thinking);
    if (thinkingParts.length > 0 && thinkingParts.join('').trim()) {
      return thinkingParts.join('\n').trim();
    }
  }
  const msg = data?.choices?.[0]?.message;
  if (typeof msg?.content === 'string' && msg.content.trim()) return msg.content.trim();
  if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim()) return msg.reasoning_content.trim();
  return '';
}

function extractUsage(data: any): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const u = data?.usage;
  if (!u) return {};
  const p = u.input_tokens ?? u.prompt_tokens;
  const c = u.output_tokens ?? u.completion_tokens;
  const t = u.total_tokens ?? (((p ?? 0) + (c ?? 0)) || undefined);
  return {
    ...(typeof p === 'number' ? { promptTokens: p } : {}),
    ...(typeof c === 'number' ? { completionTokens: c } : {}),
    ...(typeof t === 'number' ? { totalTokens: t } : {}),
  };
}

export const anthropicProvider: AiProvider = {
  name: 'anthropic',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    const defaultLadder = [
      process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-5-5',
      process.env.ANTHROPIC_OPUS_MODEL || 'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ];
    const ladder = readLadder('ANTHROPIC_TEXT_LADDER', defaultLadder);
    if (req.model && /^claude-/i.test(req.model)) {
      const rest = ladder.filter(e => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    // claude-sonnet-5-5 / claude-opus-5-5 require temperature=1 and emit ~300-600
    // thinking tokens before text blocks, sharing max_tokens.
    const maxTokens = Math.max(req.maxTokens ?? (req.json ? 8192 : 4096), 2048);
    const systemText = req.json
      ? `${req.system ? `${req.system}\n\n` : ''}Respond ONLY with valid raw JSON (no markdown code fences, no commentary).`
      : req.system;
    const systemBlocks = [
      { type: 'text', text: CLAUDE_CODE_ANCHOR },
    ];
    const combinedUserPrompt = systemText
      ? `${systemText}\n\n${req.prompt}`
      : req.prompt;

    const result = await runModelLadder('anthropic', 'text', ladder, async (entry) => {
      const data = await anthropicFetch(
        '/messages',
        {
          model: entry.model,
          temperature: 1,
          max_tokens: maxTokens,
          system: systemBlocks,
          messages: [
            { role: 'user', content: combinedUserPrompt },
          ],
        },
        { timeoutMs: req.timeoutMs, signal: req.signal, label: 'text' },
      );
      const content = extractTextContent(data);
      if (!content) {
        throw new AiProviderError('anthropic', 'text', `empty completion from ${entry.model}`, 503);
      }
      const parsed = req.json ? safeJsonParse(content, 'text') : content;
      return { data, parsed };
    });

    return {
      provider: 'anthropic',
      model: result.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: result.result.parsed,
      ...extractUsage(result.result.data),
    };
  },

  async image(_req: ImageRequest): Promise<never> {
    throw new AiProviderError('anthropic', 'image', 'Anthropic does not generate images - falling through', 503);
  },

  async imageEdit(_req: ImageRequest): Promise<never> {
    throw new AiProviderError('anthropic', 'imageEdit', 'Anthropic does not edit images - falling through', 503);
  },

  async video(_req: VideoRequest): Promise<never> {
    throw new AiProviderError('anthropic', 'video', 'Anthropic does not generate video - falling through', 503);
  },

  async analysis(req: AnalysisRequest): Promise<ProviderResult<object>> {
    const ladder = readLadder('ANTHROPIC_ANALYSIS_LADDER', [
      process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-5-5',
      process.env.ANTHROPIC_OPUS_MODEL || 'claude-opus-5-5',
      'claude-sonnet-4-6',
    ]);
    const start = Date.now();
    const result = await runModelLadder('anthropic', 'analysis', ladder, async (entry) => {
      const data = await anthropicFetch(
        '/messages',
        {
          model: entry.model,
          temperature: 1,
          max_tokens: 4096,
          system: [
            { type: 'text', text: CLAUDE_CODE_ANCHOR },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: req.mimeType || 'image/png',
                    data: req.imageBase64,
                  },
                },
                {
                  type: 'text',
                  text: `Analyze the provided image carefully and respond ONLY with valid raw JSON (no markdown fences).\n\n${req.prompt}`,
                },
              ],
            },
          ],
        },
        { signal: req.signal, label: 'analysis' },
      );
      const content = extractTextContent(data) || '{}';
      return { data, parsed: safeJsonParse(content, 'analysis') };
    });

    return {
      provider: 'anthropic',
      model: result.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: result.result.parsed,
      ...extractUsage(result.result.data),
    };
  },
};
