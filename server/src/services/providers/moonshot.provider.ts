import OpenAI from 'openai';
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

const TIMEOUT = parseInt(process.env.MOONSHOT_TIMEOUT_MS || '90000', 10);

function getBaseUrl(): string {
  return (process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
}

let cachedClient: OpenAI | null = null;
let cachedKey = '';
let cachedBase = '';

function getClient(): OpenAI {
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) throw new AiProviderError('moonshot', 'init', 'MOONSHOT_API_KEY not set', 401);
  const base = getBaseUrl();
  if (!cachedClient || cachedKey !== key || cachedBase !== base) {
    cachedClient = new OpenAI({
      apiKey: key,
      baseURL: base,
      timeout: TIMEOUT,
      maxRetries: 1,
    });
    cachedKey = key;
    cachedBase = base;
  }
  return cachedClient;
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
    throw new AiProviderError('moonshot', label, `JSON parse failed. Response: ${raw.slice(0, 200)}`);
  }
}

export const moonshotProvider: AiProvider = {
  name: 'moonshot',

  async text(req: TextRequest): Promise<ProviderResult<string | object>> {
    throwIfCancelled(req.signal, 'text');
    const defaultLadder = [
      process.env.MOONSHOT_MODEL || 'kimi-k3.1-pro-highspeed',
      'kimi-k3.1-pro',
      'kimi-k3',
    ];
    const ladder = readLadder('MOONSHOT_TEXT_LADDER', defaultLadder);
    if (req.model && /^kimi/i.test(req.model)) {
      const rest = ladder.filter(e => e.model !== req.model);
      ladder.length = 0;
      ladder.push({ model: req.model }, ...rest);
    }

    const start = Date.now();
    // Kimi K3.1 reasoning models require temperature=1 and share max_tokens
    // across reasoning_content and final content.
    const maxTokens = Math.max(req.maxTokens ?? (req.json ? 8192 : 4096), 4096);
    const systemText = req.json
      ? `${req.system ? `${req.system}\n\n` : ''}Respond ONLY with valid raw JSON (no markdown code fences, no commentary).`
      : req.system;

    const result = await runModelLadder('moonshot', 'text', ladder, async (entry) => {
      throwIfCancelled(req.signal, 'text');
      try {
        const client = getClient();
        const isReasoningKimi = /k3\.1|k2\.5/i.test(entry.model);
        const completion = await client.chat.completions.create(
          {
            model: entry.model,
            temperature: isReasoningKimi ? 1 : (req.temperature ?? 0.7),
            max_tokens: maxTokens,
            ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
            messages: [
              ...(systemText ? [{ role: 'system' as const, content: systemText }] : []),
              { role: 'user' as const, content: req.prompt },
            ],
          },
          {
            timeout: req.timeoutMs ?? TIMEOUT,
            signal: req.signal,
          },
        );
        const msg = completion.choices?.[0]?.message as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        const content = (typeof msg?.content === 'string' && msg.content.trim())
          ? msg.content.trim()
          : (typeof msg?.reasoning_content === 'string' ? msg.reasoning_content.trim() : '');
        if (!content) {
          throw new AiProviderError('moonshot', 'text', `empty completion from ${entry.model}`, 503);
        }
        const parsed = req.json ? safeJsonParse(content, 'text') : content;
        return { completion, parsed };
      } catch (err: any) {
        if (req.signal?.aborted) throw new AiCancelledError('text', abortReasonText(req.signal));
        const status = err?.status || err?.statusCode;
        throw new AiProviderError('moonshot', 'text', err?.message || String(err), status);
      }
    });

    const u = result.result.completion.usage;
    return {
      provider: 'moonshot',
      model: result.modelUsed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      output: result.result.parsed,
      ...(typeof u?.prompt_tokens === 'number' ? { promptTokens: u.prompt_tokens } : {}),
      ...(typeof u?.completion_tokens === 'number' ? { completionTokens: u.completion_tokens } : {}),
      ...(typeof u?.total_tokens === 'number' ? { totalTokens: u.total_tokens } : {}),
    };
  },

  async image(_req: ImageRequest): Promise<never> {
    throw new AiProviderError('moonshot', 'image', 'Moonshot does not generate images - falling through', 503);
  },

  async imageEdit(_req: ImageRequest): Promise<never> {
    throw new AiProviderError('moonshot', 'imageEdit', 'Moonshot does not edit images - falling through', 503);
  },

  async video(_req: VideoRequest): Promise<never> {
    throw new AiProviderError('moonshot', 'video', 'Moonshot does not generate video - falling through', 503);
  },

  async analysis(_req: AnalysisRequest): Promise<never> {
    throw new AiProviderError('moonshot', 'analysis', 'Moonshot analysis falls through to multimodal providers', 503);
  },
};
