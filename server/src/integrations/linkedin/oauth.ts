/**
 * LinkedIn personal-share OAuth provider.
 *
 * v1 ships `w_member_social` only (personal profile posting). Page posting
 * via `w_organization_social` requires Marketing Developer Platform partner
 * approval — multi-month gauntlet, deferred to v2.
 *
 * Access TTL: 60d. Refresh: 365d (programmatic refresh requires MDP — for
 * personal-share, user re-auths at 60d).
 *
 * Required env: LINKEDIN_OAUTH_CLIENT_ID, LINKEDIN_OAUTH_CLIENT_SECRET
 */
import type { OAuthProvider, OAuthExchangeResult, OAuthAccountInfo } from '../types.js';

const LI_AUTH  = 'https://www.linkedin.com/oauth/v2/authorization';
const LI_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_API   = 'https://api.linkedin.com';
const LI_VERSION = '202604';

const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

function clientId(): string { return process.env.LINKEDIN_OAUTH_CLIENT_ID || ''; }
function clientSecret(): string { return process.env.LINKEDIN_OAUTH_CLIENT_SECRET || ''; }

export const oauth: OAuthProvider = {
  initiateUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId(),
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(' '),
    });
    return `${LI_AUTH}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthExchangeResult> {
    const r = await fetch(LI_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
    });
    if (!r.ok) throw new Error(`LinkedIn exchange failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token || null,
      expiresInSec: j.expires_in,
      scopes: (j.scope || '').split(' ').filter(Boolean),
    };
  },

  async refresh({ refreshToken }): Promise<OAuthExchangeResult> {
    if (!refreshToken) {
      throw new Error('LinkedIn refresh requires Marketing Developer Platform — personal accounts must re-auth at 60d');
    }
    const r = await fetch(LI_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId(),
        client_secret: clientSecret(),
      }),
    });
    if (!r.ok) throw new Error(`LinkedIn refresh failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { access_token: string; expires_in: number; refresh_token?: string };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token || refreshToken,
      expiresInSec: j.expires_in,
    };
  },

  async meAccount({ accessToken }): Promise<OAuthAccountInfo> {
    // OIDC userinfo endpoint — easier than the legacy /v2/me + /v2/email-address dance
    const r = await fetch(`${LI_API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': LI_VERSION },
    });
    if (!r.ok) throw new Error(`LinkedIn userinfo failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { sub: string; name?: string; email?: string; picture?: string };
    return {
      externalAccountId: `urn:li:person:${j.sub}`,
      externalAccountName: j.name || j.email || j.sub,
      metadata: {
        email: j.email,
        avatarUrl: j.picture,
      },
    };
  },
};
