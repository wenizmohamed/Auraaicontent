import { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { signToken, authGuard, mintRefreshToken, hashRefreshToken, type JwtPayload } from '../middleware/auth.js';
import { parseOr400 } from '../lib/parseOr400.js';

function reqMeta(request: FastifyRequest): { userAgent: string | null; ip: string | null } {
  const ua = request.headers['user-agent']?.slice(0, 300) ?? null;
  const ip = request.ip ?? null;
  return { userAgent: ua, ip };
}

// Zod schemas — single source of truth for request shape + validation.
const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional(),
});
const RefreshBody = z.object({
  refreshToken: z.string().min(1).max(512),
});
const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(80),
  rememberMe: z.boolean().optional(),
});
const UpdateMeBody = z.object({
  name: z.string().trim().min(2).max(80),
});
const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

// parseOr400 moved to ../lib/parseOr400.js — DRY across the route layer (S2).

export async function authRoutes(app: FastifyInstance) {

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = parseOr400(LoginBody, request.body, reply);
    if (!body) return;
    const { email, password, rememberMe } = body;

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = signToken(
      { userId: user.id, email: user.email, role: user.role },
      Boolean(rememberMe),
    );
    const refresh = mintRefreshToken();
    const meta = reqMeta(request);
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return {
      token,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      rememberMe: Boolean(rememberMe),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
    };
  });

  // POST /api/auth/refresh — rotate access+refresh tokens.  Revokes the
  // presented refresh token and issues a new pair.  Reuse of a revoked
  // token triggers a full user-wide revocation (compromise signal).
  app.post('/refresh', async (request, reply) => {
    const body = parseOr400(RefreshBody, request.body, reply);
    if (!body) return;
    const { refreshToken } = body;
    const hash = hashRefreshToken(refreshToken);
    const row = await db.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!row) {
      return reply.status(401).send({ error: 'invalid refresh token' });
    }
    // Reuse of revoked token = attacker replay. Revoke the whole user.
    if (row.revokedAt) {
      await db.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return reply.status(401).send({ error: 'refresh token reuse detected — all sessions revoked', requireLogin: true });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return reply.status(401).send({ error: 'refresh token expired', requireLogin: true });
    }

    const user = row.user;
    const newAccess = signToken({ userId: user.id, email: user.email, role: user.role });
    const fresh = mintRefreshToken();
    const meta = reqMeta(request);
    const newRow = await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: fresh.hash,
        expiresAt: fresh.expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    await db.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: newRow.id },
    });
    return {
      token: newAccess,
      refreshToken: fresh.raw,
      refreshExpiresAt: fresh.expiresAt.toISOString(),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt.toISOString() },
    };
  });

  // POST /api/auth/logout — revoke the presented refresh token so it can't
  // be replayed.  Access token stays valid until its short TTL expires;
  // that's acceptable (1h max).  Frontend discards both.
  app.post('/logout', async (request) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };
    if (refreshToken && typeof refreshToken === 'string') {
      const hash = hashRefreshToken(refreshToken);
      await db.refreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  });

  // GET /api/auth/me — requires valid token
  app.get('/me', { preHandler: [authGuard] }, async (request) => {
    const { userId } = request.user as JwtPayload;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }
    return user;
  });

  // PATCH /api/auth/me — update profile (name only; email/role immutable here)
  app.patch('/me', { preHandler: [authGuard] }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const body = parseOr400(UpdateMeBody, request.body, reply);
    if (!body) return;
    const user = await db.user.update({
      where: { id: userId },
      data: { name: body.name },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return user;
  });

  // POST /api/auth/password — change password (verifies current, then bcrypts new)
  app.post('/password', { preHandler: [authGuard] }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const body = parseOr400(PasswordBody, request.body, reply);
    if (!body) return;
    const { currentPassword, newPassword } = body;
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    // Revoke all refresh tokens — force re-auth on other sessions for safety.
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  });

  // POST /api/auth/register — dev convenience, disable in production
  app.post('/register', async (request, reply) => {
    const body = parseOr400(RegisterBody, request.body, reply);
    if (!body) return;
    const { email, password, name, rememberMe } = body;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { email, passwordHash, name, role: 'member' },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = signToken(
      { userId: user.id, email: user.email, role: user.role },
      Boolean(rememberMe),
    );
    return { token, rememberMe: Boolean(rememberMe), user };
  });
}
