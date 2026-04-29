// Environment validation — fail fast if required vars are missing

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: parseInt(optional('PORT', '8080'), 10),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6379'),
  JWT_SECRET: required('JWT_SECRET'),

  // xAI
  XAI_API_KEY: optional('XAI_API_KEY', ''),
  XAI_BASE_URL: optional('XAI_BASE_URL', 'https://api.x.ai/v1'),
  XAI_TEXT_MODEL: optional('XAI_TEXT_MODEL', 'grok-4.20'),
  XAI_IMAGE_MODEL: optional('XAI_IMAGE_MODEL', 'grok-imagine-image'),
  XAI_VIDEO_MODEL: optional('XAI_VIDEO_MODEL', 'grok-imagine-video'),
  XAI_TIMEOUT_MS: parseInt(optional('XAI_TIMEOUT_MS', '90000'), 10),

  // Gemini
  GEMINI_API_KEY: optional('GEMINI_API_KEY', ''),
  GEMINI_TEXT_MODEL: optional('GEMINI_TEXT_MODEL', 'gemini-3.1-pro-preview'),
  GEMINI_FLASH_TEXT_MODEL: optional('GEMINI_FLASH_TEXT_MODEL', 'gemini-3.1-flash-lite-preview'),
  GEMINI_IMAGE_MODEL: optional('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image-preview'),
  GEMINI_IMAGE_FAST_MODEL: optional('GEMINI_IMAGE_FAST_MODEL', 'imagen-4.0-fast-generate-001'),
  GEMINI_VIDEO_MODEL: optional('GEMINI_VIDEO_MODEL', 'veo-3.1-generate-preview'),
  GEMINI_EMBEDDING_MODEL: optional('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2-preview'),
  GEMINI_TIMEOUT_MS: parseInt(optional('GEMINI_TIMEOUT_MS', '90000'), 10),

  // Routing
  AI_TEXT_PRIMARY: optional('AI_TEXT_PRIMARY', 'gemini'),
  AI_IMAGE_PRIMARY: optional('AI_IMAGE_PRIMARY', 'gemini'),
  AI_VIDEO_PRIMARY: optional('AI_VIDEO_PRIMARY', 'gemini'),
  AI_ANALYSIS_PRIMARY: optional('AI_ANALYSIS_PRIMARY', 'gemini'),
  AI_ENABLE_FALLBACK: optional('AI_ENABLE_FALLBACK', 'true'),

  PREVIEW_URL: optional('PREVIEW_URL', 'http://localhost:5174'),
} as const;
