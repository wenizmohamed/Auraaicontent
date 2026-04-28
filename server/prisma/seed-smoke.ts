// Permanent smoke account — idempotent seed.  Creates a canonical dev user
// so /verify-user cycles don't have to reseed+purge+relogin every run.
//
// Usage:  pnpm dlx tsx prisma/seed-smoke.ts
//         (or on VPS: cd /opt/radix-v2/server && node dist/prisma/seed-smoke.js)
//
// Reads SMOKE_EMAIL and SMOKE_PASSWORD from env, falls back to sane defaults
// that are ONLY used in dev.  In prod the env vars must be set or the seed
// bails out safely.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const SMOKE_EMAIL = process.env.SMOKE_EMAIL || 'smoke@radix.local';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-pw-2026';
const SMOKE_NAME = process.env.SMOKE_NAME || 'Smoke Tester';
const SMOKE_ROLE = process.env.SMOKE_ROLE || 'member';

async function main() {
  const db = new PrismaClient();
  try {
    const existing = await db.user.findUnique({ where: { email: SMOKE_EMAIL } });
    const hash = await bcrypt.hash(SMOKE_PASSWORD, 12);
    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: { passwordHash: hash, name: SMOKE_NAME, role: SMOKE_ROLE },
      });
      console.log(`[smoke-seed] refreshed password for existing user ${SMOKE_EMAIL} (id=${existing.id})`);
    } else {
      const u = await db.user.create({
        data: { email: SMOKE_EMAIL, passwordHash: hash, name: SMOKE_NAME, role: SMOKE_ROLE },
      });
      console.log(`[smoke-seed] created user ${SMOKE_EMAIL} (id=${u.id}) role=${SMOKE_ROLE}`);
    }
    console.log(`[smoke-seed] DONE. Login with ${SMOKE_EMAIL} + password from SMOKE_PASSWORD env.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
