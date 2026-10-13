import { FastifyInstance, type FastifyRequest } from 'fastify';
import type { OrgRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/prisma.js';
import { signToken, authGuard, mintRefreshToken, hashRefreshToken, type JwtPayload } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';
import { sendEmail, resetEmailHtml, resetEmailText } from '../lib/email.js';
import { canSeePricing } from '../lib/pricing-visibility.js';

// Single source of truth for password length. Lowered 12 → 6 (2026-06-29):
// users kept getting locked out and there was no self-serve recovery, so a
// looser floor + a working "forgot password" flow beats a strict floor nobody
// could recover from.
const MIN_PASSWORD = 6;
// Reset links are short-lived and single-use.
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function reqMeta(request: FastifyRequest): { userAgent: string | null; ip: string | null } {
  const ua = (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;
  const ip = (request.ip as string | undefined) ?? null;
  return { userAgent: ua, ip };
}

// Pick the user's active org. Prefers User.currentOrgId; falls back to
// their first OrgMembership; returns null if they have none. Multi-org
// users hit /api/auth/switch-org to change.
async function resolveActiveOrg(userId: string): Promise<{ orgId: string; orgRole: string } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { currentOrgId: true },
  });

  if (user?.currentOrgId) {
    const mem = await db.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: user.currentOrgId } },
    });
    if (mem) return { orgId: mem.orgId, orgRole: mem.role };
  }

  const first = await db.orgMembership.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  if (first) {
    await db.user.update({ where: { id: userId }, data: { currentOrgId: first.orgId } });
    return { orgId: first.orgId, orgRole: first.role };
  }
  return null;
}

export async function authRoutes(app: FastifyInstance) {

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const { email, password, rememberMe } = request.body as {
      email: string;
      password: string;
      rememberMe?: boolean;
    };

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const active = await resolveActiveOrg(user.id);
    if (!active) {
      return reply.status(403).send({ error: 'Account has no organization. Contact support.' });
    }

    const token = signToken(
      { userId: user.id, email: user.email, role: user.role, orgId: active.orgId, orgRole: active.orgRole },
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

    const memberships = await db.orgMembership.findMany({
      where: { userId: user.id },
      include: { org: { select: { id: true, name: true, slug: true, plan: true } } },
    });

    auditService.log({
      orgId: active.orgId,
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      payload: { rememberMe: Boolean(rememberMe) },
    }).catch(() => {});

    return {
      token,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      rememberMe: Boolean(rememberMe),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      activeOrgId: active.orgId,
      memberships: memberships.map((m) => ({ orgId: m.orgId, role: m.role, org: m.org })),
    };
  });

  // POST /api/auth/refresh — rotate access+refresh tokens.  Revokes the
  // presented refresh token and issues a new pair.  Reuse of a revoked
  // token triggers a full user-wide revocation (compromise signal).
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };
    if (!refreshToken || typeof refreshToken !== 'string') {
      return reply.status(400).send({ error: 'refreshToken required' });
    }
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
    const active = await resolveActiveOrg(user.id);
    if (!active) {
      return reply.status(403).send({ error: 'Account has no organization', requireLogin: true });
    }
    const newAccess = signToken({ userId: user.id, email: user.email, role: user.role, orgId: active.orgId, orgRole: active.orgRole });
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
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      activeOrgId: active.orgId,
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
      select: { id: true, email: true, name: true, role: true, currentOrgId: true, createdAt: true },
    });
    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }
    const memberships = await db.orgMembership.findMany({
      where: { userId },
      include: { org: { select: { id: true, name: true, slug: true, plan: true } } },
    });
    const activeMembership = memberships.find((m) => m.orgId === request.orgId);
    return {
      ...user,
      activeOrgId: request.orgId,
      memberships: memberships.map((m) => ({ orgId: m.orgId, role: m.role, org: m.org })),
      // Costs/prices are owner, admin and accounting only (ACCOUNTING_EMAILS).
      canSeePricing: canSeePricing(user.email, activeMembership?.role ?? request.user?.orgRole),
    };
  });

  // GET /api/auth/orgs — list current user's memberships
  app.get('/orgs', { preHandler: [authGuard] }, async (request) => {
    const { userId } = request.user!;
    const memberships = await db.orgMembership.findMany({
      where: { userId },
      include: { org: true },
    });
    return memberships.map((m) => ({ orgId: m.orgId, role: m.role, org: m.org }));
  });

  // POST /api/auth/switch-org — set currentOrgId and re-issue access token
  app.post('/switch-org', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId } = (request.body ?? {}) as { orgId?: string };
    const { userId } = request.user!;
    if (!orgId) return reply.status(400).send({ error: 'orgId required' });

    const mem = await db.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!mem) return reply.status(403).send({ error: 'Not a member of that organization' });

    await db.user.update({ where: { id: userId }, data: { currentOrgId: orgId } });

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: 'user not found' });

    const newToken = signToken({ userId: user.id, email: user.email, role: user.role, orgId, orgRole: mem.role });
    return { token: newToken, activeOrgId: orgId, orgRole: mem.role };
  });

  // POST /api/auth/register — gated in production, but ALWAYS open for emails
  // whose domain matches AUTO_ORG_DOMAINS (configured agency tenants). This
  // lets employees self-onboard without admin intervention while still blocking
  // arbitrary public signups + spam. Override the gate entirely with
  // ALLOW_PUBLIC_REGISTER=true.
  app.post('/register', async (request, reply) => {
    const { email, password, name, rememberMe } = request.body as {
      email: string;
      password: string;
      name: string;
      rememberMe?: boolean;
    };

    // Compute whether the email belongs to a whitelisted auto-join domain.
    // Done BEFORE the prod gate so domain-employees bypass the 404.
    // AUTO_ORG_DOMAINS must be set explicitly — empty default means no
    // implicit prod-org enrolment in dev/staging/CI.
    const domainAllowed = (() => {
      const raw = process.env.AUTO_ORG_DOMAINS || '';
      const domain = email?.split('@')[1]?.toLowerCase();
      if (!domain) return false;
      return raw.split(',').map(s => s.trim()).filter(Boolean).some(entry => {
        const [d] = entry.split(':');
        return d?.toLowerCase() === domain;
      });
    })();

    // Prod gate: 404 unless ALLOW_PUBLIC_REGISTER=true OR the email's domain is
    // whitelisted in AUTO_ORG_DOMAINS OR a valid (pending, unexpired) invitation
    // exists for this email. An invite IS authorization to register — without
    // this, externally-invited collaborators (domains outside AUTO_ORG_DOMAINS)
    // hit a 404 "Not found" and can never sign up. After registration the
    // frontend replays the invite (accept → join org), so a personal org is
    // created here and they're switched into the inviting org on accept.
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_PUBLIC_REGISTER !== 'true' &&
      !domainAllowed
    ) {
      const invited = email
        ? await db.invitation.findFirst({
            where: {
              email: { equals: email, mode: 'insensitive' },
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          })
        : null;
      if (!invited) {
        return reply.status(404).send({ error: 'Not found' });
      }
    }

    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'Email, password, and name required' });
    }
    if (password.length < MIN_PASSWORD) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Email-domain → org auto-join rule. Comma-separated DOMAIN:ORG_ID:ROLE
    // entries in env. Example: "radixmediamena.com:org_radix_media:EDITOR"
    // When the new user's email matches a configured domain, skip personal-org
    // creation and add them straight to the existing tenant.
    function lookupDomainOrg(addr: string): { orgId: string; role: string } | null {
      const raw = process.env.AUTO_ORG_DOMAINS || '';
      const domain = addr.split('@')[1]?.toLowerCase();
      if (!domain) return null;
      for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
        const [d, oid, role] = entry.split(':');
        if (d?.toLowerCase() === domain && oid) {
          return { orgId: oid, role: (role || 'EDITOR').toUpperCase() };
        }
      }
      return null;
    }
    const autoOrg = lookupDomainOrg(email);

    // Atomic: create User + (auto-join existing org OR create personal Organization)
    //         + OrgMembership + currentOrgId.
    // 14-day trial only applies to personal-org path. Auto-join uses existing org's plan.
    const slug = (email.split('@')[0] + '-' + Math.random().toString(36).slice(2, 6)).toLowerCase();
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, name, role: 'member' },
      });
      let orgId: string;
      let orgRole: string;
      if (autoOrg) {
        // Confirm the configured org actually exists; fall back to personal-org
        // if it's been deleted (defensive — bad env config shouldn't 500 signup).
        const existing = await tx.organization.findUnique({ where: { id: autoOrg.orgId } });
        if (existing) {
          orgId = existing.id;
          orgRole = autoOrg.role;
          await tx.orgMembership.create({
            data: { userId: user.id, orgId, role: orgRole as OrgRole },
          });
        } else {
          const org = await tx.organization.create({
            data: { name: `${name}'s workspace`, slug, plan: 'trial', trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
          });
          orgId = org.id;
          orgRole = 'OWNER';
          await tx.orgMembership.create({ data: { userId: user.id, orgId, role: 'OWNER' } });
        }
      } else {
        const org = await tx.organization.create({
          data: { name: `${name}'s workspace`, slug, plan: 'trial', trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
        });
        orgId = org.id;
        orgRole = 'OWNER';
        await tx.orgMembership.create({ data: { userId: user.id, orgId, role: 'OWNER' } });
      }
      await tx.user.update({ where: { id: user.id }, data: { currentOrgId: orgId } });
      return { user, orgId, orgRole };
    });

    const token = signToken(
      { userId: result.user.id, email: result.user.email, role: result.user.role, orgId: result.orgId, orgRole: result.orgRole },
      Boolean(rememberMe),
    );
    // Mint a refresh token exactly like /login does. Without this the client
    // stores refreshToken = null, rotateRefresh() short-circuits, and the
    // session dies at the 1 hour access-token TTL with no silent refresh.
    const refresh = mintRefreshToken();
    const meta = reqMeta(request);
    await db.refreshToken.create({
      data: {
        userId: result.user.id,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });

    auditService.log({
      orgId: result.orgId,
      userId: result.user.id,
      action: 'auth.register',
      entityType: 'User',
      entityId: result.user.id,
      payload: { orgId: result.orgId, autoJoined: !!autoOrg },
    }).catch(() => {});

    return {
      token,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      rememberMe: Boolean(rememberMe),
      user: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role },
      activeOrgId: result.orgId,
    };
  });

  // PATCH /api/auth/me — update the current user's profile (name only for now).
  app.patch('/me', { preHandler: [authGuard] }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const { name } = (request.body ?? {}) as { name?: string };
    const trimmed = (name ?? '').trim();
    if (!trimmed) return reply.status(400).send({ error: 'Name is required' });
    if (trimmed.length > 120) return reply.status(400).send({ error: 'Name is too long' });

    const user = await db.user.update({
      where: { id: userId },
      data: { name: trimmed },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return user;
  });

  // POST /api/auth/password — change password while signed in. Verifies the
  // current password, sets the new one, and revokes all OTHER refresh tokens so
  // stale sessions can't keep going after a credential change.
  app.post('/password', { preHandler: [authGuard] }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const { currentPassword, newPassword } = (request.body ?? {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Current and new password required' });
    }
    if (newPassword.length < MIN_PASSWORD) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({ where: { id: userId }, data: { passwordHash } });

    // Revoke every active refresh token for this user (incl. other devices).
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    auditService.log({
      orgId: request.orgId,
      userId,
      action: 'auth.password_change',
      entityType: 'User',
      entityId: userId,
    }).catch(() => {});

    return { success: true };
  });

  // POST /api/auth/forgot-password — public. Always returns success regardless
  // of whether the email exists (no account enumeration). When a matching user
  // exists, mints a single-use, hashed, 1-hour reset token and emails the link.
  app.post('/forgot-password', async (request) => {
    const { email } = (request.body ?? {}) as { email?: string };
    const addr = (email ?? '').trim().toLowerCase();
    const generic = { success: true, message: 'If that email is registered, a reset link is on its way.' };
    if (!addr) return generic;

    const user = await db.user.findUnique({ where: { email: addr } });
    if (!user) return generic; // silent — don't leak which emails exist

    // Invalidate any outstanding (unused, unexpired) resets for this user so
    // only the newest link works.
    await db.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    const meta = reqMeta(request);
    await db.passwordReset.create({
      data: { userId: user.id, tokenHash, expiresAt, userAgent: meta.userAgent, ip: meta.ip },
    });

    const baseUrl = process.env.RADIX_APP_BASE_URL || process.env.PUBLIC_APP_URL || 'https://radixcontent.com';
    const resetUrl = `${baseUrl}/reset-password/${raw}`;

    // Fire-and-forget. If RESEND_API_KEY is unset this logs the URL to pm2 so
    // an admin can hand it over — the flow still works without a provider.
    sendEmail({
      to: user.email,
      subject: 'Reset your AURAAI password',
      html: resetEmailHtml({ name: user.name, resetUrl, expiresAt }),
      text: resetEmailText({ name: user.name, resetUrl, expiresAt }),
    }).catch((e) => console.error('[reset-email] send failed', e?.message));

    auditService.log({
      orgId: user.currentOrgId ?? undefined,
      userId: user.id,
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
    }).catch(() => {});

    return generic;
  });

  // POST /api/auth/reset-password — public. Consumes a valid reset token, sets
  // the new password, marks the token used, and revokes ALL refresh tokens.
  app.post('/reset-password', async (request, reply) => {
    const { token, password } = (request.body ?? {}) as { token?: string; password?: string };
    if (!token || !password) {
      return reply.status(400).send({ error: 'Token and new password required' });
    }
    if (password.length < MIN_PASSWORD) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.passwordReset.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return reply.status(400).send({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db.$transaction([
      db.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      db.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    auditService.log({
      orgId: undefined,
      userId: row.userId,
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: row.userId,
    }).catch(() => {});

    return { success: true, message: 'Password updated. You can now sign in.' };
  });
}
