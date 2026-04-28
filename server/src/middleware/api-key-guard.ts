import type { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/prisma.js';

// External-API key auth. Format: `sk-radix-{32-hex}`. The plaintext key is
// shown to the user exactly once at creation; only its bcrypt hash + a
// 12-char prefix live in `ApiKey`.
//
// Lookup strategy: bcrypt hashes don't have a stable byte sequence we can
// index, so we scan candidate rows by keyPrefix (first 12 chars of the
// plaintext, deterministic) — that narrows the comparison to typically <5
// rows even at high key counts, then bcrypt-compare the survivors.
//
// On match: sets `request.apiKeyContext = { clientId, keyId }` and updates
// `lastUsedAt` async (fire-and-forget — never blocks the request).

export interface ApiKeyContext {
  clientId: string;
  keyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyContext?: ApiKeyContext;
  }
}

const KEY_PREFIX = 'sk-radix-';

/** Generate a fresh `sk-radix-{32-hex}` key. Plaintext returned to the user once. */
export function mintApiKey(): { plaintext: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(16).toString('hex');
  const plaintext = `${KEY_PREFIX}${random}`;
  const prefix = plaintext.slice(0, 12);
  const hash = bcrypt.hashSync(plaintext, 10);
  return { plaintext, prefix, hash };
}

export async function apiKeyGuard(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return reply.status(401).send({ ok: false, error: 'Missing API key' });
  }

  const token = auth.slice(7).trim();
  if (!token.startsWith(KEY_PREFIX)) {
    return reply.status(401).send({ ok: false, error: 'Invalid API key format' });
  }

  const prefix = token.slice(0, 12);
  const candidates = await db.apiKey.findMany({
    where: { keyPrefix: prefix, revokedAt: null },
    select: { id: true, clientId: true, keyHash: true, expiresAt: true },
    take: 10,
  });

  if (candidates.length === 0) {
    return reply.status(401).send({ ok: false, error: 'Invalid or revoked API key' });
  }

  const now = Date.now();
  let matched: { id: string; clientId: string } | null = null;
  for (const c of candidates) {
    if (c.expiresAt && c.expiresAt.getTime() < now) continue;
    if (bcrypt.compareSync(token, c.keyHash)) {
      matched = { id: c.id, clientId: c.clientId };
      break;
    }
  }

  if (!matched) {
    return reply.status(401).send({ ok: false, error: 'Invalid or revoked API key' });
  }

  request.apiKeyContext = { clientId: matched.clientId, keyId: matched.id };

  // Fire-and-forget lastUsedAt update — failure here must NOT block the
  // request; auditability is best-effort.
  db.apiKey
    .update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } })
    .catch((err: any) => console.warn('[api-key] lastUsedAt update failed:', err?.message));
}
