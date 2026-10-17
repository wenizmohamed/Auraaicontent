import 'dotenv/config';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime/io.js';
import { auditConfiguredModelPricing } from './lib/ai-pricing.js';

// Phase 2 coverage guard: warn loudly at boot if any .env-configured model
// lacks a price (would log $0 in the cost meter).
auditConfiguredModelPricing();

const app = await buildApp();

await app.listen({ port: env.PORT, host: '0.0.0.0' });
await attachRealtime(app);
console.log(`AuraAI server running on http://localhost:${env.PORT} (socket.io: /socket.io)`);
