// Server entry point — stub only for Commit 1A
// Business logic comes in Commit 2+

import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ status: 'ok', service: 'radix-server', version: '1.0.0' }));

const port = Number(process.env.PORT || 8080);
await app.listen({ port, host: '0.0.0.0' });
