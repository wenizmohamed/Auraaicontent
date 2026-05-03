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

  // Public base URL — used to build OAuth redirect URIs that match what's
  // registered in each platform's developer console.
  RADIX_APP_BASE_URL: optional('RADIX_APP_BASE_URL', 'https://radix.synapseai-labs.com'),

  // AES-256-GCM key for encrypting OAuth tokens at rest. Generate with
  // `openssl rand -base64 32`. Required for any platform connection to work;
  // we don't `required()` it so the server still boots in dev without it
  // — the secrets.ts helpers throw with a clear message when actually used.
  RADIX_INTEGRATION_KEY: optional('RADIX_INTEGRATION_KEY', ''),

  // Platform OAuth client credentials. Empty defaults so the build doesn't
  // crash before the user provisions developer apps; the OAuth routes throw
  // a clear error when Connect is clicked without creds.
  META_OAUTH_CLIENT_ID:     optional('META_OAUTH_CLIENT_ID', ''),
  META_OAUTH_CLIENT_SECRET: optional('META_OAUTH_CLIENT_SECRET', ''),
  TIKTOK_OAUTH_CLIENT_KEY:    optional('TIKTOK_OAUTH_CLIENT_KEY', ''),
  TIKTOK_OAUTH_CLIENT_SECRET: optional('TIKTOK_OAUTH_CLIENT_SECRET', ''),
  LINKEDIN_OAUTH_CLIENT_ID:     optional('LINKEDIN_OAUTH_CLIENT_ID', ''),
  LINKEDIN_OAUTH_CLIENT_SECRET: optional('LINKEDIN_OAUTH_CLIENT_SECRET', ''),
} as const;
