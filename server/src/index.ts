import './load-env.js';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime/io.js';
import { auditConfiguredModelPricing } from './lib/ai-pricing.js';

// Phase 2 coverage guard: warn loudly at boot if any .env-configured model
// lacks a price (would log $0 in the cost meter).
auditConfiguredModelPricing();

const app = await buildApp();

// Loopback only. nginx (TLS, security headers, body limits) is the public
// front door; with 0.0.0.0 and no firewall the API also answered plain HTTP
// on the public IP at :8080, bypassing all of it. Set HOST to override.
await app.listen({ port: env.PORT, host: process.env.HOST || '127.0.0.1' });
await attachRealtime(app);
console.log(`AURA server running on http://localhost:${env.PORT} (socket.io: /socket.io)`);
