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
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  GEMINI_PLANNER_MODEL: optional('GEMINI_PLANNER_MODEL', 'gemini-3-flash-preview'),
  GEMINI_STRATEGIST_MODEL: optional('GEMINI_STRATEGIST_MODEL', 'gemini-3.1-pro-preview'),
  GEMINI_IMAGE_MODEL: optional('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image-preview'),
  GEMINI_VIDEO_MODEL: optional('GEMINI_VIDEO_MODEL', 'veo-3.1-generate-preview'),
  GEMINI_EMBEDDING_MODEL: optional('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2-preview'),
} as const;
