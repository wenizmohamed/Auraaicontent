import { xaiProvider } from './xai.provider.js';
import { geminiProvider } from './gemini.provider.js';
import { isRetryableAiError, AllProvidersFailedError, type ProviderFailure } from './errors.js';
import type { AiProvider, AiProviderName, AiTask, AiTelemetryEntry, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';

// ─── Routing config from env ─────────────────────────────────────
// Weni 2026-04-23: Gemini 3.1 Pro is PRIMARY across the board because the
// API key bills to the Radix company card.  Grok is the fallback.  (Kimi
// isn't in the AiProvider abstraction yet — text fallback to Kimi happens
// at the higher-level chatText/chatStream helper in services/llm/chat.ts.)
const PRIMARY: Record<string, AiProviderName> = {
  text: (process.env.AI_TEXT_PRIMARY as AiProviderName) || 'gemini',
  image: (process.env.AI_IMAGE_PRIMARY as AiProviderName) || 'gemini',
  video: (process.env.AI_VIDEO_PRIMARY as AiProviderName) || 'gemini',
  analysis: (process.env.AI_ANALYSIS_PRIMARY as AiProviderName) || 'gemini',
};

const FALLBACK_ENABLED = process.env.AI_ENABLE_FALLBACK !== 'false';

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  xai: xaiProvider,
  gemini: geminiProvider,
};

function orderedProviders(task: string): AiProvider[] {
  const normalizedTask = task === 'image_edit' ? 'image' : task;
  const primary = PRIMARY[normalizedTask] || 'gemini';
  const fallback = primary === 'gemini' ? 'xai' : 'gemini';
  return FALLBACK_ENABLED ? [PROVIDERS[primary], PROVIDERS[fallback]] : [PROVIDERS[primary]];
}

// ─── Telemetry ring buffer ───────────────────────────────────────
const telemetryBuf: (AiTelemetryEntry | null)[] = new Array(500).fill(null);
let telemetryHead = 0;
let telemetrySize = 0;
const MAX_LOG = telemetryBuf.length;

function logTelemetry(entry: AiTelemetryEntry) {
  telemetryBuf[telemetryHead] = entry;
  telemetryHead = (telemetryHead + 1) % MAX_LOG;
  if (telemetrySize < MAX_LOG) telemetrySize++;
  const fb = entry.fallbackUsed ? ' [FALLBACK]' : '';
  const err = entry.errorType ? ` err=${entry.errorType}` : '';
  const tok = entry.totalTokens ? ` [${entry.promptTokens ?? '?'}→${entry.completionTokens ?? '?'} tok]` : '';
  console.log(`[AI] ${entry.task} ${entry.provider}/${entry.model} ${entry.latencyMs}ms${tok}${fb}${err}`);
}

export function getAiTelemetry(): AiTelemetryEntry[] {
  const result: AiTelemetryEntry[] = [];
  const start = telemetrySize < MAX_LOG ? 0 : telemetryHead;
  for (let i = 0; i < telemetrySize; i++) {
    const entry = telemetryBuf[(start + i) % MAX_LOG];
    if (entry) result.push(entry);
  }
  return result;
}

// ─── Router ──────────────────────────────────────────────────────
async function routeCall<T>(
  task: AiTask,
  fn: (provider: AiProvider) => Promise<ProviderResult<T>>,
  meta?: { jobId?: string; clientId?: string },
): Promise<ProviderResult<T>> {
  const providers = orderedProviders(task);
  const failures: ProviderFailure[] = [];
  let fallbackUsed = false;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (i > 0) fallbackUsed = true;
    try {
      const result = await fn(provider);
      result.fallbackUsed = fallbackUsed;
      logTelemetry({
        provider: result.provider, model: result.model, task,
        latencyMs: result.latencyMs, fallbackUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        jobId: meta?.jobId, clientId: meta?.clientId,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableAiError(err);
      failures.push({ provider: provider.name, message: errMsg.slice(0, 200), retryable });
      logTelemetry({
        provider: provider.name, model: 'unknown', task,
        latencyMs: 0, fallbackUsed,
        errorType: errMsg.slice(0, 80),
        jobId: meta?.jobId, clientId: meta?.clientId,
        timestamp: new Date().toISOString(),
      });

      if (!retryable || !FALLBACK_ENABLED) break;
      console.warn(`[AI] ${provider.name} ${task} failed (retryable), trying fallback: ${errMsg.slice(0, 80)}`);
    }
  }
  throw new AllProvidersFailedError(task, failures);
}

// ─── Public API ──────────────────────────────────────────────────
export const aiRouter = {
  async text(req: TextRequest, meta?: { jobId?: string; clientId?: string }): Promise<ProviderResult<string | object>> {
    return routeCall('text', p => p.text(req), meta);
  },

  async image(req: ImageRequest, meta?: { jobId?: string; clientId?: string }): Promise<ProviderResult<{ url?: string; base64?: string }>> {
    return routeCall(req.imageBase64 ? 'image_edit' : 'image', p => req.imageBase64 ? p.imageEdit(req) : p.image(req), meta);
  },

  async video(req: VideoRequest, meta?: { jobId?: string; clientId?: string }): Promise<ProviderResult<{ url: string }>> {
    // Image-to-video prefers Gemini (native imageBase64 support), but falls
    // back to xAI via the normal routeCall chain when Gemini is unavailable.
    // xAI receives the base64 as a data-URL in referenceImageUrls.
    return routeCall('video', p => p.video(req), meta);
  },

  async analysis(req: AnalysisRequest, meta?: { jobId?: string; clientId?: string }): Promise<ProviderResult<object>> {
    return routeCall('analysis', p => p.analysis(req), meta);
  },
};
