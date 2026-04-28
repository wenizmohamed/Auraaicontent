import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

// Fastify module augmentation — `request.user` is set by authGuard.
// Optional because non-authed routes don't have it.
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

// Access token (short-lived).  Frontend holds this in memory + calls
// /api/auth/refresh to rotate when it expires.  rememberMe=true extends
// the access token to 7d to reduce refresh round-trips for trusted
// workstations — the refresh token itself lives 30d regardless.
export function signToken(payload: JwtPayload, rememberMe = false): string {
  const expiresIn = rememberMe ? '7d' : '1h';
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

// Refresh token rotation — each login mints a fresh 256-bit random string.
// The raw token goes to the client; only the SHA-256 hash is stored in
// Postgres (so a DB leak doesn't hand attackers replay tokens).  30-day TTL.
// On rotate: old row is revoked + marked `replacedBy`; new row is issued.
// Reuse of a revoked token = account compromise → all user tokens revoked.
export interface RefreshTokenPair {
  raw: string;           // goes to client
  hash: string;          // stored in DB
  expiresAt: Date;
}

export function mintRefreshToken(): RefreshTokenPair {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Fastify preHandler hook — attaches user to request
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    request.user = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}
