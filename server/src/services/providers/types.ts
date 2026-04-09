export type AiProviderName = 'xai' | 'gemini';
export type AiTask = 'text' | 'image' | 'image_edit' | 'video' | 'analysis' | 'embedding';

export interface TextRequest {
  prompt: string;
  system?: string;
  temperature?: number;
  json?: boolean;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  imageBase64?: string;
  mimeType?: string;
  referenceImages?: { base64: string; mimeType: string }[];
  grounded?: boolean;
}

export interface VideoRequest {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  resolution?: '720p' | '1080p' | '4k';
  imageBase64?: string;
  mimeType?: string;
  referenceImageUrls?: string[];
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
  errorType?: string;
  jobId?: string;
  clientId?: string;
  timestamp: string;
}
