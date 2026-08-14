// Org-scoped management endpoints: invitations + member listing.
//
// Surface:
//   GET    /api/orgs/:orgId/members           — list current org members
//   GET    /api/orgs/:orgId/invitations       — list pending invites
//   POST   /api/orgs/:orgId/invitations       — create + return invite token
//   DELETE /api/orgs/:orgId/invitations/:id   — revoke a pending invite
//   GET    /api/invitations/:token            — preview invite (public)
//   POST   /api/invitations/:token/accept     — accept (auth required)
//
// Role guard: only OWNER/ADMIN of the target org can mint or revoke invites.
// Accept flow: requires the recipient to be logged in already; if they hit
// the link unauthenticated, the frontend stores the token in localStorage
// and replays after login.

import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/prisma.js';
import { authGuard, type JwtPayload } from '../middleware/auth.js';
import { sendEmail, inviteEmailHtml, inviteEmailText } from '../lib/email.js';
import { auditService } from '../services/audit.service.js';
import { capGuard } from '../lib/plan-caps.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Team-management is gated to a small allowlist set in env (TEAM_ADMIN_EMAILS,
// comma-separated).  Even OWNERs of the org cannot manage members unless
// their email is on this list.  Lets Weni keep Mohamed as OWNER for everything
// else while reserving member CRUD to himself.
function teamAdminEmails(): string[] {
  return (process.env.TEAM_ADMIN_EMAILS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isTeamAdmin(email: string | undefined, orgRole?: string): boolean {
  // Org OWNER/ADMIN always have team management — the email allowlist is an
  // ADDITIVE escape hatch, not a lockout. (2026-07-03 audit: the real org
  // OWNER was 403'd on GET /members because only one gmail was allowlisted.)
  if (orgRole === 'OWNER' || orgRole === 'ADMIN') return true;
  if (!email) return false;
  const list = teamAdminEmails();
  if (list.length === 0) return true; // no allowlist configured → fall through to org-role check
  return list.includes(email.toLowerCase());
}

function isPrivileged(orgRole: string | undefined): boolean {
  return orgRole === 'OWNER' || orgRole === 'ADMIN';
}

// Kill every live refresh token for a user. Called whenever their standing in
// an org changes (removed, or role changed), so they cannot mint a fresh access
// token off a stale session. RefreshToken has no hard delete here on purpose:
// the model carries `revokedAt`, and marking it keeps the row for audit and for
// the reuse-detection path in /api/auth/refresh.
//
// Residual window, deliberate: the access token already in the user's hands is
// stateless JWT and stays valid until it expires (1h, or 7d when they logged in
// with rememberMe). Closing that gap fully needs a membership re-check inside
// authGuard on every request, which is NOT in scope here. Revoking refresh
// tokens caps the exposure at one access-token TTL instead of the 30-day
// refresh-token lifetime.
async function revokeUserRefreshTokens(client: any, userId: string): Promise<void> {
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function assertOrgPrivilege(
  request: any,
  reply: any,
  orgId: string,
): Promise<JwtPayload | null> {
  const user = request.user as JwtPayload | undefined;
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  // Must be a member of THIS org (not just current active org) AND privileged
  const mem = await db.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.userId, orgId } },
  });
  if (!mem) {
    reply.status(403).send({ error: 'Not a member of that organization' });
    return null;
  }
  // OWNER/ADMIN of the org OR allowlisted email (additive, never a lockout).
  if (!isTeamAdmin(user.email, mem.role)) {
    reply.status(403).send({ error: 'Team management is restricted.' });
    return null;
  }
  if (!isPrivileged(mem.role)) {
    reply.status(403).send({ error: 'OWNER or ADMIN role required' });
    return null;
  }
  return { ...user, orgRole: mem.role };
}

export async function orgsRoutes(app: FastifyInstance) {
  // GET /api/orgs/:orgId/members
  app.get('/:orgId/members', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const caller = request.user as JwtPayload;
    const callerMem = await db.orgMembership.findUnique({
      where: { userId_orgId: { userId: caller.userId, orgId } },
    });
    if (!callerMem) return reply.status(403).send({ error: 'Not a member' });
    if (!isTeamAdmin(caller.email, callerMem.role)) {
      return reply.status(403).send({ error: 'Team management is restricted.' });
    }

    const memberships = await db.orgMembership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m: any) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: m.user,
    }));
  });

  // GET /api/orgs/:orgId/invitations
  app.get('/:orgId/invitations', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const ok = await assertOrgPrivilege(request, reply, orgId);
    if (!ok) return;

    const invites = await db.invitation.findMany({
      where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i: any) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      token: i.token,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  });

  // POST /api/orgs/:orgId/invitations
  app.post('/:orgId/invitations', { preHandler: [authGuard, capGuard('seats', 'invitation.create')] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const caller = await assertOrgPrivilege(request, reply, orgId);
    if (!caller) return;

    const { email, role } = (request.body ?? {}) as { email?: string; role?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: 'Valid email required' });
    }
    const allowedRoles = ['ADMIN', 'EDITOR', 'VIEWER'];
    const r = (role || 'EDITOR').toUpperCase();
    if (!allowedRoles.includes(r)) {
      return reply.status(400).send({ error: `Role must be one of ${allowedRoles.join(', ')}` });
    }

    // If user with this email is already a member, no-op
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      const already = await db.orgMembership.findUnique({
        where: { userId_orgId: { userId: existing.id, orgId } },
      });
      if (already) {
        return reply.status(409).send({ error: 'User is already a member of this organization' });
      }
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invite = await db.invitation.create({
      data: {
        orgId,
        email: email.toLowerCase(),
        role: r as any,
        token,
        invitedById: caller.userId,
        expiresAt,
      },
    });

    // Fire-and-forget email send.  If RESEND_API_KEY is unset this no-ops
    // (logs the URL); the inviter still gets the URL back in the response
    // so they can copy/paste manually.
    const baseUrl = process.env.PUBLIC_APP_URL || process.env.RADIX_APP_BASE_URL || 'https://radixcontent.com';
    const inviteUrl = `${baseUrl}/invite/${token}`;
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const inviter = await db.user.findUnique({ where: { id: caller.userId }, select: { name: true } });
    const orgName = org?.name ?? 'an organization';
    sendEmail({
      to: invite.email,
      subject: `You're invited to join ${orgName} on AURAAI`,
      html: inviteEmailHtml({ orgName, inviterName: inviter?.name, role: invite.role, inviteUrl, expiresAt }),
      text: inviteEmailText({ orgName, inviterName: inviter?.name, role: invite.role, inviteUrl, expiresAt }),
    }).catch((e) => console.error('[invite-email] send failed', e));

    auditService.log({
      orgId,
      userId: caller.userId,
      action: 'member.invite',
      entityType: 'Invitation',
      entityId: invite.id,
      payload: { email: invite.email, role: invite.role },
    }).catch(() => {});

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      inviteUrl,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });

  // DELETE /api/orgs/:orgId/invitations/:id — revoke
  app.delete('/:orgId/invitations/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId, id } = request.params as { orgId: string; id: string };
    const ok = await assertOrgPrivilege(request, reply, orgId);
    if (!ok) return;

    const invite = await db.invitation.findUnique({ where: { id } });
    if (!invite || invite.orgId !== orgId) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }
    await db.invitation.delete({ where: { id } });
    return { success: true };
  });

  // PATCH /api/orgs/:orgId/members/:userId — change a member's role.
  // Same guards as remove-member: caller must be team-admin AND OWNER/ADMIN
  // of the org; ADMIN cannot promote anyone to OWNER or demote an OWNER;
  // last OWNER cannot be demoted.
  app.patch('/:orgId/members/:userId', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const { role } = (request.body ?? {}) as { role?: string };
    const caller = await assertOrgPrivilege(request, reply, orgId);
    if (!caller) return;

    const allowed = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];
    const next = (role || '').toUpperCase();
    if (!allowed.includes(next)) {
      return reply.status(400).send({ error: `Role must be one of ${allowed.join(', ')}` });
    }

    const target = await db.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!target) return reply.status(404).send({ error: 'Member not found' });
    if (target.role === next) return { success: true, role: next };

    // Self-demotion guard: prevent the team-admin from accidentally demoting
    // themselves out of OWNER and locking themselves out.  They can still be
    // demoted by another OWNER, just not by themselves.
    if (userId === caller.userId && target.role === 'OWNER' && next !== 'OWNER') {
      return reply.status(409).send({
        error: 'You cannot demote yourself. Ask another OWNER to do it.',
      });
    }

    // Only OWNER can mint or demote OWNERs
    if ((next === 'OWNER' || target.role === 'OWNER') && caller.orgRole !== 'OWNER') {
      return reply.status(403).send({ error: 'Only an OWNER can change OWNER status.' });
    }

    // Block demoting the last OWNER
    if (target.role === 'OWNER' && next !== 'OWNER') {
      const ownerCount = await db.orgMembership.count({ where: { orgId, role: 'OWNER' } });
      if (ownerCount <= 1) {
        return reply.status(409).send({
          error: 'Cannot demote the last OWNER. Promote another member to OWNER first.',
        });
      }
    }

    await db.$transaction(async (tx: any) => {
      await tx.orgMembership.update({
        where: { userId_orgId: { userId, orgId } },
        data: { role: next as any },
      });
      // The old orgRole is baked into their issued JWT. Revoking refresh tokens
      // forces a re-login, and the next token they get carries the new role.
      await revokeUserRefreshTokens(tx, userId);
    });
    auditService.log({
      orgId,
      userId: caller.userId,
      action: 'member.role-change',
      entityType: 'OrgMembership',
      entityId: target.id,
      payload: { targetUserId: userId, fromRole: target.role, toRole: next },
    }).catch(() => {});
    return { success: true, role: next };
  });

  // DELETE /api/orgs/:orgId/members/:userId — remove a member from the org.
  // Rules:
  //   - caller must be OWNER or ADMIN of this org
  //   - ADMIN cannot remove an OWNER (only OWNER can)
  //   - cannot remove the last remaining OWNER (would orphan the org)
  //   - removing self is allowed unless you're the last OWNER
  // If the removed user has currentOrgId pointing to this org we null it
  // so their next token-refresh resolves to a different membership (or
  // bounces them to "no organization").
  // Their refresh tokens are revoked in the same transaction so the removal
  // actually ends the session instead of leaving it alive for 30 days.
  app.delete('/:orgId/members/:userId', { preHandler: [authGuard] }, async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const caller = await assertOrgPrivilege(request, reply, orgId);
    if (!caller) return;

    const target = await db.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!target) return reply.status(404).send({ error: 'Member not found' });

    if (target.role === 'OWNER' && caller.orgRole !== 'OWNER') {
      return reply.status(403).send({ error: 'Only an OWNER can remove another OWNER.' });
    }

    if (target.role === 'OWNER') {
      const ownerCount = await db.orgMembership.count({
        where: { orgId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        return reply.status(409).send({
          error: 'Cannot remove the last OWNER. Promote another member to OWNER first.',
        });
      }
    }

    await db.$transaction(async (tx: any) => {
      await tx.orgMembership.delete({
        where: { userId_orgId: { userId, orgId } },
      });
      // If their active org pointed here, null it so resolveActiveOrg
      // falls back to another membership at next token issuance.
      const u = await tx.user.findUnique({ where: { id: userId }, select: { currentOrgId: true } });
      if (u?.currentOrgId === orgId) {
        await tx.user.update({ where: { id: userId }, data: { currentOrgId: null } });
      }
      // A removed member keeps working access for the full refresh-token
      // lifetime unless we cut their sessions here.
      await revokeUserRefreshTokens(tx, userId);
    });

    return { success: true };
  });
}

// Mounted at /api/invitations — public preview + auth-gated accept.
export async function invitationsRoutes(app: FastifyInstance) {
  // GET /api/invitations/:token — public, returns org name + role + recipient email
  app.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await db.invitation.findUnique({
      where: { token },
      include: { org: { select: { name: true, slug: true, plan: true } } },
    });
    if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
    if (invite.acceptedAt) return reply.status(410).send({ error: 'Invitation already accepted' });
    if (invite.expiresAt.getTime() < Date.now()) {
      return reply.status(410).send({ error: 'Invitation expired' });
    }
    return {
      email: invite.email,
      role: invite.role,
      org: invite.org,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });

  // POST /api/invitations/:token/accept — requires auth.  The logged-in user's
  // email must match the invite (anti-hijack).  Creates OrgMembership and
  // bumps User.currentOrgId so the next token-refresh lands them in the new org.
  app.post('/:token/accept', { preHandler: [authGuard] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const caller = request.user as JwtPayload;

    const invite = await db.invitation.findUnique({ where: { token } });
    if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
    if (invite.acceptedAt) return reply.status(410).send({ error: 'Invitation already accepted' });
    if (invite.expiresAt.getTime() < Date.now()) {
      return reply.status(410).send({ error: 'Invitation expired' });
    }
    if (invite.email.toLowerCase() !== caller.email.toLowerCase()) {
      return reply.status(403).send({
        error: `This invite is for ${invite.email} — log in as that user to accept.`,
      });
    }

    // Create or update the membership idempotently.  If the user was somehow
    // already a member, just upgrade their role (no harm).
    await db.$transaction(async (tx: any) => {
      await tx.orgMembership.upsert({
        where: { userId_orgId: { userId: caller.userId, orgId: invite.orgId } },
        update: { role: invite.role },
        create: { userId: caller.userId, orgId: invite.orgId, role: invite.role },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await tx.user.update({
        where: { id: caller.userId },
        data: { currentOrgId: invite.orgId },
      });
    });

    return { success: true, orgId: invite.orgId, role: invite.role };
  });
}
