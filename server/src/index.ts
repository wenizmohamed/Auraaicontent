import 'dotenv/config';
import { env } from './config/env.js';
import { buildApp } from './app.js';

const app = await buildApp();

await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Radix server running on http://localhost:${env.PORT}`);
