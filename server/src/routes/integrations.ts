/**
 * /api/integrations — OAuth-based platform connector routes.
 *
 * Endpoints:
 *   GET    /api/integrations?clientId=...           — list connections
 *   GET    /api/integrations/oauth/:platform/initiate?clientId=...  — 302 → consent screen
 *   GET    /api/integrations/oauth/:platform/callback?code=...&state=...  — exchange + upsert
 *   DELETE /api/integrations/:id                    — revoke (deletes the row)
 *
 * The /callback endpoint is intentionally NOT auth-gated — the user lands
 * there from the OAuth provider with no Authorization header. We trust the
 * `state` token (issued during /initiate while authenticated) to recover
 * the user/org context. State is single-use + 5-min TTL.
 */
import { errStatus, errMessage } from '../services/providers/errors.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/prisma.js';
import { authGuard } from '../middleware/auth.js';
import { auditService } from '../services/audit.service.js';
import { assertClientInOrg } from '../lib/tenant.js';
import { encrypt, encryptOpt } from '../lib/secrets.js';
import { issueState, consumeState } from '../lib/oauth-state.js';
import { getPlatformModule, listPlatformIds, PLATFORM_LABELS } from '../integrations/registry.js';

const APP_BASE_URL = process.env.RADIX_APP_BASE_URL || 'https://radix.synapseai-labs.com';

function redirectUri(platform: string): string {
  return `${APP_BASE_URL}/api/integrations/oauth/${platform}/callback`;
}

export async function integrationsRoutes(app: FastifyInstance) {
  // List connections — auth-gated
  app.get('/integrations', { preHandler: authGuard }, async (request, reply) => {
    const { clientId } = (request.query as { clientId?: string }) || {};
    if (!clientId) return reply.status(400).send({ error: 'clientId required' });
    try {
      await assertClientInOrg(clientId, request.orgId!);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    const rows = await db.platformConnection.findMany({
      where: { orgId: request.orgId!, clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        externalAccountId: true,
        externalAccountName: true,
        scopes: true,
        expiresAt: true,
        status: true,
        lastError: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      supported: listPlatformIds().map((p) => ({ id: p, label: PLATFORM_LABELS[p] })),
      connections: rows,
    };
  });

  // Initiate OAuth — returns the consent URL as JSON. Frontend fetches with
  // its bearer token, then does window.location.href = url. We can't 302
  // here because top-level navigation can't carry an Authorization header,
  // so the previous redirect approach was unreachable from the SPA.
  app.get('/integrations/oauth/:platform/initiate', { preHandler: authGuard }, async (request, reply) => {
    const { platform } = request.params as { platform: string };
    const { clientId, returnUrl } = (request.query as { clientId?: string; returnUrl?: string }) || {};
    if (!clientId) return reply.status(400).send({ error: 'clientId required' });
    try {
      await assertClientInOrg(clientId, request.orgId!);
    } catch (err) {
      return reply.status(errStatus(err)).send({ error: errMessage(err) });
    }
    let mod;
    try {
      mod = getPlatformModule(platform);
    } catch (err) {
      return reply.status(400).send({ error: errMessage(err) });
    }
    // Validate returnUrl against APP_BASE_URL host to prevent open-redirect:
    // a phishing setup that runs the user through a real Meta/TikTok/LinkedIn
    // consent screen and bounces them to attacker.com. Default falls through.
    let safeReturnUrl = `${APP_BASE_URL}/workspace/settings/integrations?connected=${platform}`;
    if (returnUrl) {
      try {
        const url = new URL(returnUrl, APP_BASE_URL);
        const base = new URL(APP_BASE_URL);
        if (url.origin === base.origin) safeReturnUrl = url.toString();
      } catch {
        /* malformed → keep default */
      }
    }
    const state = await issueState({
      orgId: request.orgId!,
      userId: request.user!.userId,
      clientId,
      platform,
      returnUrl: safeReturnUrl,
    });
    const url = mod.oauth.initiateUrl({ state, redirectUri: redirectUri(platform) });

    // Helpful client-side error if the platform's OAuth client creds aren't set
    // yet — so the user gets "Not configured" instead of a Meta/TikTok/LinkedIn
    // error page after the redirect.
    const credCheck: Record<string, [string, string]> = {
      meta_ig:  ['META_OAUTH_CLIENT_ID',     'META_OAUTH_CLIENT_SECRET'],
      tiktok:   ['TIKTOK_OAUTH_CLIENT_KEY',  'TIKTOK_OAUTH_CLIENT_SECRET'],
      linkedin: ['LINKEDIN_OAUTH_CLIENT_ID', 'LINKEDIN_OAUTH_CLIENT_SECRET'],
    };
    const [idVar, secretVar] = credCheck[platform] || [];
    if (idVar && (!process.env[idVar] || !process.env[secretVar!])) {
      return reply.status(503).send({
        error: `${platform} OAuth not configured. Server admin must set ${idVar} + ${secretVar} in .env.`,
      });
    }

    return { url };
  });

  // OAuth callback — NOT auth-gated; verifies via state token
  app.get('/integrations/oauth/:platform/callback', async (request, reply) => {
    const { platform } = request.params as { platform: string };
    const { code, state, error: oauthError } = (request.query as { code?: string; state?: string; error?: string }) || {};
    if (oauthError) {
      return reply.status(400).send({ error: `OAuth provider returned: ${oauthError}` });
    }
    if (!code || !state) return reply.status(400).send({ error: 'code and state required' });

    const ctx = await consumeState(state);
    if (!ctx) return reply.status(400).send({ error: 'state invalid or expired (5-min TTL)' });
    if (ctx.platform !== platform) return reply.status(400).send({ error: 'state platform mismatch' });

    let mod;
    try {
      mod = getPlatformModule(platform);
    } catch (err) {
      return reply.status(400).send({ error: errMessage(err) });
    }

    try {
      const tokens = await mod.oauth.exchangeCode({ code, redirectUri: redirectUri(platform) });
      const account = await mod.oauth.meAccount({ accessToken: tokens.accessToken });

      const expiresAt = tokens.expiresInSec ? new Date(Date.now() + tokens.expiresInSec * 1000) : null;
      // Upsert: if the same client already connected this same external account, refresh tokens in place.
      await db.platformConnection.upsert({
        where: {
          clientId_platform_externalAccountId: {
            clientId: ctx.clientId,
            platform,
            externalAccountId: account.externalAccountId,
          },
        },
        create: {
          orgId: ctx.orgId,
          clientId: ctx.clientId,
          platform,
          externalAccountId: account.externalAccountId,
          externalAccountName: account.externalAccountName,
          accessTokenEnc: encrypt(tokens.accessToken),
          refreshTokenEnc: encryptOpt(tokens.refreshToken ?? null),
          scopes: tokens.scopes ?? [],
          expiresAt,
          status: 'connected',
          metadata: account.metadata ?? {},
        },
        update: {
          externalAccountName: account.externalAccountName,
          accessTokenEnc: encrypt(tokens.accessToken),
          refreshTokenEnc: encryptOpt(tokens.refreshToken ?? null),
          scopes: tokens.scopes ?? [],
          expiresAt,
          status: 'connected',
          lastError: null,
          metadata: account.metadata ?? {},
        },
      });

      auditService.log({
        orgId: ctx.orgId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        action: 'integration-connect',
        entityType: 'PlatformConnection',
        payload: { platform, externalAccountId: account.externalAccountId, externalAccountName: account.externalAccountName },
      });

      return reply.redirect(ctx.returnUrl);
    } catch (err) {
      // Sanitized log — no full error spread (could capture provider tokens
      // if a future code path holds one in scope when throwing).
      console.error('[integrations callback] error', { platform, message: errMessage(err) });
      return reply.status(500).send({ error: `Connect failed: ${errMessage(err)}` });
    }
  });

  // Revoke a connection — auth-gated
  app.delete('/integrations/:id', { preHandler: authGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const conn = await db.platformConnection.findFirst({ where: { id, orgId: request.orgId! } });
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    await db.platformConnection.deleteMany({ where: { id, orgId: request.orgId! } });
    auditService.log({
      orgId: request.orgId!,
      userId: request.user?.userId,
      clientId: conn.clientId,
      action: 'integration-revoke',
      entityType: 'PlatformConnection',
      payload: { platform: conn.platform, externalAccountId: conn.externalAccountId },
    });
    return { success: true };
  });
}
