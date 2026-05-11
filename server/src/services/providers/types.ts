export type AiProviderName = 'xai' | 'gemini';
export type AiTask = 'text' | 'image' | 'image_edit' | 'video' | 'analysis' | 'embedding';

export interface TextRequest {
  prompt: string;
  system?: string;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  imageBase64?: string;
  mimeType?: string;
  referenceImages?: { base64: string; mimeType: string }[];
  grounded?: boolean;
  quality?: 'standard' | 'ultra';  // ultra → imagen-4.0-ultra
}

export interface VideoRequest {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  resolution?: '720p' | '1080p' | '4k';
  imageBase64?: string;
  mimeType?: string;
  referenceImageUrls?: string[];
  fast?: boolean;  // fast → veo-3.1-fast for quicker gen
  // Workshop 2026-05-06 #3 (Haneen): explicit start + end frames so the
  // video bookends are controlled, not random. Either or both can be
  // omitted — Veo will treat missing endFrame as "free interpolation"
  // and missing startFrame falls back to text-only.
  startImageBase64?: string;
  startMimeType?: string;
  endImageBase64?: string;
  endMimeType?: string;
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
  timestamp: string;
}
