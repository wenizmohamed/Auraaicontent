/**
 * TikTok Business OAuth provider.
 *
 * Endpoints: open.tiktokapis.com (Business / Login Kit v2).
 * Access token TTL: 24h. Refresh TTL: 365d. Refresh token ROTATES on each use —
 * always store the new refresh_token returned by the refresh response.
 *
 * Scopes for organic photo + video posting:
 *   user.info.basic
 *   video.publish        (also covers PHOTO via Direct Post init with media_type=PHOTO)
 *
 * Required env: TIKTOK_OAUTH_CLIENT_KEY, TIKTOK_OAUTH_CLIENT_SECRET
 *
 * Audit gate (production gotcha): until the app is audited by TikTok,
 * every published post is forced to SELF_ONLY (private). Surface this in
 * the UI; we record `audited: false` in metadata initially and the user can
 * flip it to `true` after TikTok approves.
 */
import type { OAuthProvider, OAuthExchangeResult, OAuthAccountInfo } from '../types.js';

const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TT_API  = 'https://open.tiktokapis.com/v2';

const SCOPES = ['user.info.basic', 'video.publish'];

function clientKey(): string { return process.env.TIKTOK_OAUTH_CLIENT_KEY || ''; }
function clientSecret(): string { return process.env.TIKTOK_OAUTH_CLIENT_SECRET || ''; }

export const oauth: OAuthProvider = {
  initiateUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_key: clientKey(),
      response_type: 'code',
      scope: SCOPES.join(','),
      redirect_uri: redirectUri,
      state,
    });
    return `${TT_AUTH}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthExchangeResult> {
    const r = await fetch(`${TT_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: clientKey(),
        client_secret: clientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!r.ok) throw new Error(`TikTok exchange failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
      refresh_expires_in: number;
      scope: string;
      open_id: string;
    };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresInSec: j.expires_in,
      scopes: (j.scope || '').split(','),
    };
  },

  async refresh({ refreshToken }): Promise<OAuthExchangeResult> {
    if (!refreshToken) throw new Error('TikTok refresh requires a stored refresh_token');
    const r = await fetch(`${TT_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey(),
        client_secret: clientSecret(),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!r.ok) throw new Error(`TikTok refresh failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { access_token: string; expires_in: number; refresh_token: string };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token, // ROTATES — store it
      expiresInSec: j.expires_in,
    };
  },

  async meAccount({ accessToken }): Promise<OAuthAccountInfo> {
    const r = await fetch(`${TT_API}/user/info/?fields=open_id,union_id,display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`TikTok user/info failed: ${r.status}`);
    const j = await r.json() as { data?: { user?: { open_id: string; display_name: string; avatar_url?: string } } };
    const u = j.data?.user;
    if (!u?.open_id) throw new Error('TikTok user/info returned no open_id');
    return {
      externalAccountId: u.open_id,
      externalAccountName: u.display_name,
      metadata: {
        avatarUrl: u.avatar_url,
        // Audit gate — flip to true once TikTok approves the app for public posting.
        audited: false,
      },
    };
  },
};
