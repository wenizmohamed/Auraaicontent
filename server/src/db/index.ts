// Selects the right Prisma client based on DB_TARGET env.
//   DB_TARGET=sqlite  → loads ../node_modules/.prisma/client-sqlite (desktop build)
//   DB_TARGET=postgres or unset → loads @prisma/client (default; VPS multi-tenant)
//
// The desktop electron main.cjs sets DB_TARGET=sqlite + DATABASE_URL=file:<userData>/radix.db
// before forking server/dist/index.js. The VPS keeps the existing env shape.

import { createRequire } from 'node:module';
import type { PrismaClient as PrismaClientType, Prisma } from '@prisma/client';

// createRequire lets ESM files load CJS modules (both Prisma generated clients are CJS).
const require = createRequire(import.meta.url);

type PrismaClientOptions = Prisma.PrismaClientOptions;

export function createPrismaClient(options?: PrismaClientOptions): PrismaClientType {
  const target = process.env.DB_TARGET ?? 'postgres';

  if (target === 'sqlite') {
    // Lazy require so the Postgres client doesn't need to load when SQLite is in use,
    // and vice-versa. Both clients are independent files thanks to `output =` in schemas.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('../../node_modules/.prisma/client-sqlite');
    return new PrismaClient(options);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient(options);
}
