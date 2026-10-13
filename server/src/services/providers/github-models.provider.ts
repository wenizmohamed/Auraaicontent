// GitHub Models provider — free OpenAI-compatible inference on the account's PAT.
//
// Endpoint: https://models.github.ai/inference  (OpenAI chat-completions shape)
// Auth    : Authorization: Bearer ${GITHUB_MODELS_TOKEN}  (a plain GitHub PAT)
// Models  : openai/gpt-4o (default), deepseek/DeepSeek-R1,
//           meta/Llama-3.3-70B-Instruct, mistralai/Mistral-Large-2411, …
//
// Role in Radix: the FREE lane for small text work — rewrites, hashtags, quick
// captions, analysis — so paid providers stop paying for chatter. NOT used for
// the month-plan JSON (free tier caps output at 4K tokens; big plans truncate).
import OpenAI from 'openai';
import type { AiProvider, AnalysisRequest, ProviderResult, TextRequest } from './types.js';
import { AiProviderError, AiCancelledError, abortReasonText, throwIfCancelled } from './errors.js';

const BASE_URL = 'https://models.github.ai/inference';
const TEXT_MODEL = process.env.GITHUB_MODELS_TEXT_MODEL || 'openai/gpt-4o';
const TIMEOUT_MS = parseInt(process.env.GITHUB_MODELS_TIMEOUT_MS || '60000', 10);

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    const key = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN;
    if (!key) throw new AiProviderError('github', 'init', 'GITHUB_MODELS_TOKEN is not set — GitHub Models provider unavailable', 401);
    _client = new OpenAI({ apiKey: key, baseURL: BASE_URL, timeout: TIMEOUT_MS });
  }
  return _client;
}

function safeJson(s: string): object {
  try {
    const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  } catch { return { raw: s }; }
}

async function chat(req: TextRequest | AnalysisRequest, json: boolean): Promise<ProviderResult<string | object>> {
  const client = getClient();
  const model = (req as TextRequest).model || TEXT_MODEL;
  const start = Date.now();
  const { signal, timeoutMs } = req as TextRequest;
  throwIfCancelled(signal, 'text');
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if ((req as TextRequest).system) messages.push({ role: 'system', content: (req as TextRequest).system! });
  messages.push({ role: 'user', content: req.prompt });

  let r: OpenAI.Chat.ChatCompletion;
  try {
    r = await client.chat.completions.create({
      model,
      messages,
      max_tokens: (req as TextRequest).maxTokens ?? 4096,
      ...((req as TextRequest).temperature != null ? { temperature: (req as TextRequest).temperature } : {}),
      ...(json ? { response_format: { type: 'json_object' as const } } : {}),
    }, {
      ...(signal ? { signal } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
  } catch (err) {
    if (signal?.aborted) throw new AiCancelledError('text', abortReasonText(signal));
    throw err;
  }

  const text = r.choices[0]?.message?.content ?? '';
  return {
    provider: 'github', model: r.model || model,
    latencyMs: Date.now() - start, fallbackUsed: false,
    output: json ? safeJson(text) : text,
    promptTokens: r.usage?.prompt_tokens, completionTokens: r.usage?.completion_tokens,
    totalTokens: r.usage?.total_tokens,
  };
}

export const githubModelsProvider: AiProvider = {
  name: 'github',
  text: (req) => chat(req, !!req.json),
  analysis: (req) => chat(req, true).then(r => ({ ...r, output: typeof r.output === 'object' ? r.output : safeJson(String(r.output)) })),
  image: () => { throw new AiProviderError('github', 'image', 'GitHub Models has no image generation', 501); },
  imageEdit: () => { throw new AiProviderError('github', 'image_edit', 'GitHub Models has no image editing', 501); },
  video: () => { throw new AiProviderError('github', 'video', 'GitHub Models has no video generation', 501); },
};
