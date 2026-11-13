import dotenv from 'dotenv';

// In production/dev, .env is the single source of truth and must override any
// stale variables persisted in PM2's dump.pm2 or inherited from parent shells.
// In unit tests (NODE_ENV === 'test' or VITEST), keep test-hoisted env vars intact.
const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
dotenv.config({ override: !isTest });
