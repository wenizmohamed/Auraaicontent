/**
 * Task A6: SQLite migration integration test
 *
 * Apply-method: sqlite3 CLI via execSync (child_process).
 * Rationale: `prisma migrate deploy --schema=prisma/schema-sqlite.prisma` resolves
 * migrations relative to the schema dir, which is server/prisma/ — that folder also
 * contains the Postgres migrations/ dir, causing Prisma to try to apply Postgres SQL
 * to SQLite (mismatch). The sqlite3 CLI approach is hermetic and matches A2's smoke.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const migrationSqlPath = path.join(
  serverDir,
  'prisma',
  'migrations-sqlite',
  '0_init',
  'migration.sql'
);

describe('SQLite migration', () => {
  let tmpDir: string;
  let dbPath: string;
  let dbUrl: string;

  // Save original env — we mutate process.env for the CRUD test
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'radix-sqlite-mig-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbUrl = `file:${dbPath}`;
  });

  afterAll(async () => {
    // Restore env before cleanup
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }

    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows file-lock: SQLite WAL/SHM files may still be open. Non-fatal — tmpdir is cleaned on reboot.
    }
  });

  it('applies 0_init migration cleanly via sqlite3 CLI', () => {
    // Read the SQL file and pipe it to sqlite3
    execSync(`sqlite3 "${dbPath}" < "${migrationSqlPath}"`, {
      shell: true,
      stdio: 'pipe',
    });
    // No throw = migration applied cleanly
    expect(true).toBe(true);
  });

  it('inserts and reads a User row via createPrismaClient()', async () => {
    // Capture original env keys we are about to mutate
    originalEnv['DB_TARGET'] = process.env.DB_TARGET;
    originalEnv['DATABASE_URL'] = process.env.DATABASE_URL;

    process.env.DB_TARGET = 'sqlite';
    process.env.DATABASE_URL = dbUrl;

    // Cache-bust the module so Vitest picks up the new env on each run
    const { createPrismaClient } = await import(
      '../src/db/index.js?t=' + Date.now()
    );

    const prisma = createPrismaClient();
    try {
      const created = await prisma.user.create({
        data: {
          email: 'sqlite-test@example.com',
          name: 'SQLite Test',
          passwordHash: 'hashed-pw',
          role: 'admin',
        },
      });

      expect(created.id).toBeTruthy();
      expect(created.email).toBe('sqlite-test@example.com');

      const fetched = await prisma.user.findUnique({
        where: { email: 'sqlite-test@example.com' },
      });

      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('SQLite Test');
      expect(fetched?.role).toBe('admin');
      expect(fetched?.passwordHash).toBe('hashed-pw');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('enforces unique email constraint', async () => {
    // env is still set from previous test
    const { createPrismaClient } = await import(
      '../src/db/index.js?t=' + Date.now()
    );

    const prisma = createPrismaClient();
    try {
      await expect(
        prisma.user.create({
          data: {
            email: 'sqlite-test@example.com', // duplicate
            name: 'Duplicate',
            passwordHash: 'hash2',
            role: 'member',
          },
        })
      ).rejects.toThrow();
    } finally {
      await prisma.$disconnect();
    }
  });
});
