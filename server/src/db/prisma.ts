import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from '../lib/prisma-tenant.js';

// Singleton — reuse across requests, avoid connection pool exhaustion.
// Tenant-guard extension throws (or warns, depending on RADIX_TENANT_GUARD)
// when a tenant-scoped model is queried without orgId. Defense in depth on
// top of explicit scoping at the route layer.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makeClient> | undefined;
  systemPrisma: PrismaClient | undefined;
};

function makeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  }).$extends(tenantGuardExtension);
}

export const db = globalForPrisma.prisma ?? makeClient();

// systemDb — unguarded singleton for background workers that legitimately
// scan across orgs (scheduler tick, token-health sweep). Per-request route
// code MUST use `db` so the tenant guard catches missed scoping.
export const systemDb: PrismaClient =
  globalForPrisma.systemPrisma ?? new PrismaClient({ log: ['error'] });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
  globalForPrisma.systemPrisma = systemDb;
}
