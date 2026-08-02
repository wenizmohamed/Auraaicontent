import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  orgId: string;        // active organization for tenant scoping
  orgRole?: string;     // OWNER | ADMIN | EDITOR | VIEWER for the active org
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

// Augment the Fastify request type with `user` and `orgId` so route
// handlers can read them without casting through `any`.
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
    orgId?: string;
  }
}

// Fastify preHandler hook — attaches user + active orgId to request.
// Tenant-scoped routes can read request.orgId directly; missing orgId
// in the token means the user has no active organization (legacy token
// from before the multi-tenancy migration) → reject and force re-login.
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload.orgId) {
      return reply.status(401).send({ error: 'Token missing org scope', requireLogin: true });
    }
    request.user = payload;
    request.orgId = payload.orgId;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

// Role gate — wrap routes that should only fire for OWNER/ADMIN.
/**
 * Blocks the read-only VIEWER role from destructive/write endpoints.
 * The Members UI offers VIEWER and renders it read-only, but nothing on the
 * server enforced it — a VIEWER could DELETE a client and cascade-wipe its
 * calendars, assets, knowledge base and brand kit (found 2026-08-02).
 * Additive by design: OWNER/ADMIN/EDITOR and any future role pass, so this
 * can never lock out an existing member (prod has zero VIEWERs today).
 */
export async function denyViewer(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.orgRole === 'VIEWER') {
    return reply.status(403).send({ error: 'Your role is read-only for this organization' });
  }
}

export function requireOrgRole(...allowed: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user?.orgRole;
    if (!role || !allowed.includes(role)) {
      return reply.status(403).send({ error: 'Insufficient role for this organization' });
    }
  };
}
