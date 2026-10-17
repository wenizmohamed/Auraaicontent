export type AiProviderName = 'xai' | 'gemini' | 'dashscope'; // github removed 2026-10-13: GitHub Models shut down 2026-07-30
export type AiTask = 'text' | 'image' | 'image_edit' | 'video' | 'analysis' | 'embedding';

export interface TextRequest {
  prompt: string;
  system?: string;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
  model?: string;  // optional per-call model override (powers the model picker)
  // Per-attempt timeout override. Background jobs (the month plan) need far
  // longer than the global GEMINI_TIMEOUT_MS that protects synchronous HTTP
  // routes behind nginx's 120s proxy timeout.
  timeoutMs?: number;
  // Caller-owned deadline / cancel switch. When it aborts, the in-flight
  // request is cancelled and NO further rung or provider is tried.
  signal?: AbortSignal;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  imageBase64?: string;
  mimeType?: string;
  // B1: each reference image can carry a ROLE so the model treats it correctly
  // (content/composition vs style/aesthetic vs character/product identity).
  // Realized via per-image prompt prefixes in the providers.
  referenceImages?: { base64: string; mimeType: string; role?: 'content' | 'style' | 'character' }[];
  grounded?: boolean;
  quality?: 'standard' | 'ultra';  // ultra → imagen-4.0-ultra
  model?: string;  // optional per-call model override (powers the model picker)
  // Output resolution (verified live 2026-07-02): nano-banana accepts
  // 512/1K/2K/4K via imageConfig.imageSize; Imagen accepts 1K/2K (4K is
  // clamped to 2K in the provider). Other providers ignore it.
  imageSize?: '1K' | '2K' | '4K';
}

export interface VideoRequest {
  prompt: string;
  // Optional engine override (powers the FE video-engine picker). Currently:
  // 'gemini-omni-flash-preview' → Interactions API path in gemini.provider;
  // anything else falls through to the normal Veo/Grok ladders.
  model?: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  resolution?: '720p' | '1080p' | '4k';
  imageBase64?: string;
  mimeType?: string;
  referenceImageUrls?: string[];
  fast?: boolean;  // fast → veo-3.1-fast for quicker gen
  // Cost tier (Part A): 'draft' routes to Grok ($0.05/s) first, 'hd' keeps the
  // Veo-primary env order. Set by the creative route from the FE toggle; default
  // (undefined) is treated as HD-order to preserve legacy behavior.
  tier?: 'draft' | 'hd';
  // Workshop 2026-05-06 #3 (Haneen): explicit start + end frames so the
  // video bookends are controlled, not random. Either or both can be
  // omitted — Veo will treat missing endFrame as "free interpolation"
  // and missing startFrame falls back to text-only.
  startImageBase64?: string;
  startMimeType?: string;
  endImageBase64?: string;
  endMimeType?: string;
  // User-supplied "avoid" terms. Veo supports a real negativePrompt param
  // (verified live 2026-07-02); the provider merges this with the default
  // stability negatives. Providers without the param ignore it.
  negativePrompt?: string;
  // Veo 3.1 "ingredients to video": subject/asset reference images the model
  // keeps consistent in the output (verified ACCEPTED live 2026-07-02 with
  // referenceType:'asset'). Google's docs: asset refs only (no style refs) and
  // reference-conditioned generation requires an 8s clip — the provider
  // enforces both. Max 3 refs.
  referenceImages?: { base64: string; mimeType: string }[];
  // Caller-owned cancel switch, honoured between poll ticks by async engines.
  signal?: AbortSignal;
}

export interface AnalysisRequest {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}

export interface ProviderResult<T = unknown> {
  provider: AiProviderName;
  model: string;
  output: T;
  latencyMs: number;
  fallbackUsed: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface AiProvider {
  name: AiProviderName;
  text(req: TextRequest): Promise<ProviderResult<string | object>>;
  image(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>>;
  imageEdit(req: ImageRequest): Promise<ProviderResult<{ url?: string; base64?: string }>>;
  video(req: VideoRequest): Promise<ProviderResult<{ url: string }>>;
  analysis(req: AnalysisRequest): Promise<ProviderResult<object>>;
}

export interface AiTelemetryEntry {
  provider: AiProviderName;
  model: string;
  task: AiTask;
  latencyMs: number;
  fallbackUsed: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorType?: string;
  jobId?: string;
  clientId?: string;
  // Org that made the call — lets /dashboard/ai-stats scope the shared
  // in-memory buffer per tenant instead of leaking cross-org metadata.
  orgId?: string;
  // Video cost tier ('draft' → Grok, 'hd' → Veo). Only set for video calls so
  // draft-vs-hd routing is visible in ai-stats (esp. when a tripped Grok breaker
  // silently lands drafts on veo-fast). Undefined for non-video tasks.
  tier?: 'draft' | 'hd';
  timestamp: string;
}
