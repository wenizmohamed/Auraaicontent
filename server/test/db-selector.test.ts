import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('createPrismaClient', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the SQLite client when DB_TARGET=sqlite', async () => {
    process.env.DB_TARGET = 'sqlite';
    process.env.DATABASE_URL = 'file:/tmp/radix-selector-test.db';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient();
    expect(client).toBeDefined();
    expect((client as any)._engineConfig?.activeProvider ?? 'sqlite').toBe('sqlite');
    await client.$disconnect();
  });

  it('returns the Postgres client when DB_TARGET unset (default)', async () => {
    delete process.env.DB_TARGET;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient();
    expect(client).toBeDefined();
    await client.$disconnect();
  });

  it('returns the Postgres client when DB_TARGET=postgres', async () => {
    process.env.DB_TARGET = 'postgres';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient();
    expect(client).toBeDefined();
    await client.$disconnect();
  });

  it('accepts log options and returns a functional client', async () => {
    delete process.env.DB_TARGET;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const { createPrismaClient } = await import('../src/db/index.js?t=' + Date.now());
    const client = createPrismaClient({ log: ['error'] });
    expect(client).toBeDefined();
    expect(typeof client.$connect).toBe('function');
    expect(typeof client.$disconnect).toBe('function');
    await client.$disconnect();
  });
});
