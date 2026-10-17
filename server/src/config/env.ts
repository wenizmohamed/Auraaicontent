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
  // imagen-4.0-fast-generate-001 was the default until 2026-05-04 when Google
  // started returning 404 "model not found". Falling back to the gemini flash
  // image model which is currently active. Override in .env to switch back if
  // imagen returns.
  GEMINI_IMAGE_FAST_MODEL: optional('GEMINI_IMAGE_FAST_MODEL', 'gemini-3.1-flash-image-preview'),
  GEMINI_VIDEO_MODEL: optional('GEMINI_VIDEO_MODEL', 'veo-3.1-generate-preview'),
  GEMINI_EMBEDDING_MODEL: optional('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2-preview'),
  GEMINI_TIMEOUT_MS: parseInt(optional('GEMINI_TIMEOUT_MS', '90000'), 10),

  // DashScope (Alibaba Model Studio "Token Plan") — multi-model text + image.
  DASHSCOPE_API_KEY: optional('DASHSCOPE_API_KEY', ''),
  DASHSCOPE_BASE_URL: optional('DASHSCOPE_BASE_URL', 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'),
  DASHSCOPE_TEXT_MODEL: optional('DASHSCOPE_TEXT_MODEL', 'qwen3.8-max'),
  DASHSCOPE_VISION_MODEL: optional('DASHSCOPE_VISION_MODEL', 'qwen3.8-max'),
  DASHSCOPE_IMAGE_MODEL: optional('DASHSCOPE_IMAGE_MODEL', 'qwen-image-3.0-pro'),
  DASHSCOPE_VIDEO_MODEL: optional('DASHSCOPE_VIDEO_MODEL', 'wan3.0-video'),
  DASHSCOPE_TIMEOUT_MS: parseInt(optional('DASHSCOPE_TIMEOUT_MS', '120000'), 10),

  // Routing
  AI_TEXT_PRIMARY: optional('AI_TEXT_PRIMARY', 'dashscope'),
  AI_IMAGE_PRIMARY: optional('AI_IMAGE_PRIMARY', 'dashscope'),
  AI_VIDEO_PRIMARY: optional('AI_VIDEO_PRIMARY', 'dashscope'),
  // Video is ~97% of AI spend and volume 5x'd in a month — daily guardrail.
  // SOFT logs a WARN (watchdog sentinel alerts on it); HARD (0 = off) blocks
  // further video gen for that org for the rest of the UTC day.
  VIDEO_DAILY_SOFT_USD: optional('VIDEO_DAILY_SOFT_USD', '40'),
  VIDEO_DAILY_HARD_USD: optional('VIDEO_DAILY_HARD_USD', '0'),
  AI_ANALYSIS_PRIMARY: optional('AI_ANALYSIS_PRIMARY', 'dashscope'),
  AI_ENABLE_FALLBACK: optional('AI_ENABLE_FALLBACK', 'true'),

  PREVIEW_URL: optional('PREVIEW_URL', 'http://localhost:5174'),

  // Public base URL — used to build OAuth redirect URIs that match what's
  // registered in each platform's developer console.
  RADIX_APP_BASE_URL: optional('RADIX_APP_BASE_URL', 'https://srv1494206.hstgr.cloud'),

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
