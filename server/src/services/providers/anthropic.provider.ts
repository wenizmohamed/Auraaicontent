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

// Claude through the OFFICIAL Anthropic API with a Claude Console key, and
// nothing else.
//
// Until 2026-11-14 this pointed at a reseller (claudeapikey.dev) and dressed
// every request up as the Claude Code CLI (claude-code beta header, claude-cli
// User-Agent, a "You are Claude Code" system prompt with the real
// instructions moved into the user turn) so a Claude SUBSCRIPTION token would
// be accepted. Anthropic does not allow that for an app: developers building
// products "should use API key authentication through Claude Console", and
// Anthropic does "not permit third-party developers ... to route requests
// through Free, Pro, Max, or Ultra plan credentials on behalf of their users"
// (code.claude.com/docs/en/legal-and-compliance, read 2026-11-14). The
// reseller was also out of balance and was receiving client prompts.
//
// Without an official key the provider reports itself unconfigured and every
// chain skips it.
const ANTHROPIC_API = 'https://api.anthropic.com/v1';

/** The official Claude Console API key, or undefined. Console API keys start
 *  sk-ant-api. Everything else is ignored, including a reseller token and a
 *  Claude subscription token (`claude setup-token` makes sk-ant-oat...), which
 *  Anthropic does not allow an app to use. */
export function anthropicApiKey(): string | undefined {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  return k.startsWith('sk-ant-api') ? k : undefined;
}

function getKey(): string {
  const key = anthropicApiKey();
  if (!key) throw new AiProviderError('anthropic', 'init', 'ANTHROPIC_API_KEY (an official sk-ant-api Claude Console key) is not set', 401);
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
    const res = await fetch(`${ANTHROPIC_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
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
    const maxTokens = Math.max(req.maxTokens ?? (req.json ? 8192 : 4096), 2048);
    const systemText = req.json
      ? `${req.system ? `${req.system}\n\n` : ''}Respond ONLY with valid raw JSON (no markdown code fences, no commentary).`
      : req.system;

    const result = await runModelLadder('anthropic', 'text', ladder, async (entry) => {
      const data = await anthropicFetch(
        '/messages',
        {
          model: entry.model,
          temperature: 1,
          max_tokens: maxTokens,
          // The real system prompt goes in `system`, where the official API
          // expects it.
          ...(systemText ? { system: systemText } : {}),
          messages: [
            { role: 'user', content: req.prompt },
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
