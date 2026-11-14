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

  // Anthropic (Claude) through the official API only, with a Claude Console
  // key (sk-ant-...). The reseller base URL and the subscription-style
  // ANTHROPIC_AUTH_TOKEN were removed 2026-11-14 (providers/anthropic.provider.ts).
  ANTHROPIC_API_KEY: optional('ANTHROPIC_API_KEY', ''),
  ANTHROPIC_TEXT_MODEL: optional('ANTHROPIC_TEXT_MODEL', 'claude-sonnet-5-5'),
  ANTHROPIC_OPUS_MODEL: optional('ANTHROPIC_OPUS_MODEL', 'claude-opus-5-5'),
  ANTHROPIC_TIMEOUT_MS: parseInt(optional('ANTHROPIC_TIMEOUT_MS', '120000'), 10),

  // Gemini
  GEMINI_API_KEY: optional('GEMINI_API_KEY', ''),
  GEMINI_TEXT_MODEL: optional('GEMINI_TEXT_MODEL', 'gemini-4-carbon'),
  GEMINI_FLASH_TEXT_MODEL: optional('GEMINI_FLASH_TEXT_MODEL', 'gemini-3.8-flash'),
  GEMINI_IMAGE_MODEL: optional('GEMINI_IMAGE_MODEL', 'gemini-3-pro-image'),
  GEMINI_IMAGE_FAST_MODEL: optional('GEMINI_IMAGE_FAST_MODEL', 'gemini-nano-banana-2.1'),
  GEMINI_VIDEO_MODEL: optional('GEMINI_VIDEO_MODEL', 'gemini-omni-1.2-flash'),
  GEMINI_EMBEDDING_MODEL: optional('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2-preview'),
  GEMINI_TIMEOUT_MS: parseInt(optional('GEMINI_TIMEOUT_MS', '90000'), 10),

  // Vertex AI / Agent Platform (Google Cloud project hubz-510406).
  // Added 2026-11-07. The Gemini Developer API key above is billing-dead
  // (402 "prepayment credits are depleted" on every model), while the Vertex
  // entitlement on the same project is funded and serves text + image +
  // image-edit + analysis.
  //
  // The location lives in the PATH, not the host: the working URL is
  //   https://aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/google/models/<id>:generateContent
  // `us-aiplatform.googleapis.com` answers 400 "Invalid hostname".
  VERTEX_API_KEY: optional('VERTEX_API_KEY', ''),
  VERTEX_PROJECT: optional('VERTEX_PROJECT', 'hubz-510406'),
  VERTEX_LOCATION: optional('VERTEX_LOCATION', 'us'),
  VERTEX_HOST: optional('VERTEX_HOST', 'https://aiplatform.googleapis.com'),
  VERTEX_TEXT_MODEL: optional('VERTEX_TEXT_MODEL', 'gemini-3.8-flash'),
  VERTEX_IMAGE_MODEL: optional('VERTEX_IMAGE_MODEL', 'gemini-nano-banana-2.1'),
  VERTEX_IMAGE_EDIT_MODEL: optional('VERTEX_IMAGE_EDIT_MODEL', 'gemini-nano-banana-2.1'),
  VERTEX_ANALYSIS_MODEL: optional('VERTEX_ANALYSIS_MODEL', 'gemini-3.8-flash'),
  VERTEX_TIMEOUT_MS: parseInt(optional('VERTEX_TIMEOUT_MS', '90000'), 10),
  VERTEX_IMAGE_TIMEOUT_MS: parseInt(optional('VERTEX_IMAGE_TIMEOUT_MS', '180000'), 10),

  // DashScope (Alibaba Model Studio workspace) — multi-model text + image.
  DASHSCOPE_API_KEY: optional('DASHSCOPE_API_KEY', ''),
  DASHSCOPE_BASE_URL: optional('DASHSCOPE_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
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
  AURACONTENT_APP_BASE_URL: optional('AURACONTENT_APP_BASE_URL', 'https://srv1494206.hstgr.cloud'),

  // AES-256-GCM key for encrypting OAuth tokens at rest. Generate with
  // `openssl rand -base64 32`. Required for any platform connection to work;
  // we don't `required()` it so the server still boots in dev without it
  // — the secrets.ts helpers throw with a clear message when actually used.
  AURACONTENT_INTEGRATION_KEY: optional('AURACONTENT_INTEGRATION_KEY', ''),

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
