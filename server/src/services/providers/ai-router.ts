import { xaiProvider } from './xai.provider.js';
import { geminiProvider } from './gemini.provider.js';
import { isRetryableAiError, AllProvidersFailedError, type ProviderFailure } from './errors.js';
import type { AiProvider, AiProviderName, AiTask, AiTelemetryEntry, AnalysisRequest, ImageRequest, ProviderResult, TextRequest, VideoRequest } from './types.js';

// ─── Routing config from env ─────────────────────────────────────
const PRIMARY: Record<string, AiProviderName> = {
  text: (process.env.AI_TEXT_PRIMARY as AiProviderName) || 'xai',
  image: (process.env.AI_IMAGE_PRIMARY as AiProviderName) || 'xai',
  video: (process.env.AI_VIDEO_PRIMARY as AiProviderName) || 'xai',
  analysis: (process.env.AI_ANALYSIS_PRIMARY as AiProviderName) || 'gemini',
};

const FALLBACK_ENABLED = process.env.AI_ENABLE_FALLBACK !== 'false';

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  xai: xaiProvider,
  gemini: geminiProvider,
};

function orderedProviders(task: string): AiProvider[] {
  const normalizedTask = task === 'image_edit' ? 'image' : task;
  const primary = PRIMARY[normalizedTask] || 'xai';
  const fallback = primary === 'xai' ? 'gemini' : 'xai';
  return FALLBACK_ENABLED ? [PROVIDERS[primary], PROVIDERS[fallback]] : [PROVIDERS[primary]];
}

// ─── Telemetry log ───────────────────────────────────────────────
const telemetryLog: AiTelemetryEntry[] = [];
const MAX_LOG = 500;

function logTelemetry(entry: AiTelemetryEntry) {
  telemetryLog.push(entry);
  if (telemetryLog.length > MAX_LOG) telemetryLog.shift();
  // Also log to console for debugging
  const fb = entry.fallbackUsed ? ' [FALLBACK]' : '';
  const err = entry.errorType ? ` err=${entry.errorType}` : '';
  console.log(`[AI] ${entry.task} ${entry.provider}/${entry.model} ${entry.latencyMs}ms${fb}${err}`);
}

export function getAiTelemetry(): AiTelemetryEntry[] {
  return [...telemetryLog];
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
    // Image-to-video requires Gemini — xAI's video() ignores `imageBase64`,
    // which would silently degrade to text-to-video. Force Gemini when an input
    // image is present, regardless of AI_VIDEO_PRIMARY.
    if (req.imageBase64 && req.mimeType) {
      const forced = async (): Promise<ProviderResult<{ url: string }>> => {
        const start = Date.now();
        try {
          const result = await geminiProvider.video(req);
          logTelemetry({
            provider: result.provider, model: result.model, task: 'video',
            latencyMs: result.latencyMs || (Date.now() - start), fallbackUsed: false,
            jobId: meta?.jobId, clientId: meta?.clientId,
            timestamp: new Date().toISOString(),
          });
          return result;
        } catch (err) {
          const errType = err instanceof Error ? err.message.slice(0, 80) : String(err);
          logTelemetry({
            provider: 'gemini', model: 'forced-image-to-video', task: 'video',
            latencyMs: Date.now() - start, fallbackUsed: false,
            errorType: errType,
            jobId: meta?.jobId, clientId: meta?.clientId,
            timestamp: new Date().toISOString(),
          });
          throw err;
        }
      };
      return forced();
    }
    return routeCall('video', p => p.video(req), meta);
  },

  async analysis(req: AnalysisRequest, meta?: { jobId?: string; clientId?: string }): Promise<ProviderResult<object>> {
    return routeCall('analysis', p => p.analysis(req), meta);
  },
};
