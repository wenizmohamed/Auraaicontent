import { createPrismaClient } from './index.js';
import type { PrismaClient } from '@prisma/client';

// Singleton — reuse across requests, avoid connection pool exhaustion
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const db = globalForPrisma.prisma ?? createPrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
