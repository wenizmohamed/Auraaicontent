import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from '../lib/prisma-tenant.js';

// Singleton — reuse across requests, avoid connection pool exhaustion.
// Tenant-guard extension throws (or warns, depending on RADIX_TENANT_GUARD)
// when a tenant-scoped model is queried without orgId. Defense in depth on
// top of explicit scoping at the route layer.
const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof makeClient> | undefined };

function makeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  }).$extends(tenantGuardExtension);
}

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
