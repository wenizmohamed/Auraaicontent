/**
 * Meta / Instagram Business OAuth provider.
 *
 * Uses Facebook Login for Business → exchanges short-lived user token for a
 * long-lived (60d) token, then resolves the linked IG Business Account id.
 *
 * Refresh: GET /refresh_access_token. Token must be ≥24h old, <60d.
 *
 * Scopes (request all four for content publishing):
 *   instagram_business_basic
 *   instagram_business_content_publish
 *   pages_show_list
 *   business_management
 *
 * Required env: META_OAUTH_CLIENT_ID, META_OAUTH_CLIENT_SECRET
 */
import type { OAuthProvider, OAuthExchangeResult, OAuthAccountInfo } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const FB_DIALOG  = 'https://www.facebook.com/v21.0/dialog/oauth';

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'pages_show_list',
  'business_management',
];

function clientId(): string {
  return process.env.META_OAUTH_CLIENT_ID || '';
}
function clientSecret(): string {
  return process.env.META_OAUTH_CLIENT_SECRET || '';
}

export const oauth: OAuthProvider = {
  initiateUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(','),
      response_type: 'code',
    });
    return `${FB_DIALOG}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthExchangeResult> {
    // Step 1 — short-lived user access token
    const params = new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      code,
    });
    const r1 = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
    if (!r1.ok) throw new Error(`Meta short-lived exchange failed: ${r1.status} ${await r1.text()}`);
    const j1 = await r1.json() as { access_token: string; expires_in?: number };

    // Step 2 — exchange for long-lived (60d) user token
    const params2 = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: clientId(),
      client_secret: clientSecret(),
      fb_exchange_token: j1.access_token,
    });
    const r2 = await fetch(`${GRAPH_BASE}/oauth/access_token?${params2.toString()}`);
    if (!r2.ok) throw new Error(`Meta long-lived exchange failed: ${r2.status} ${await r2.text()}`);
    const j2 = await r2.json() as { access_token: string; expires_in?: number; token_type?: string };

    return {
      accessToken: j2.access_token,
      refreshToken: null, // Meta doesn't issue refresh tokens — long-lived is rolled via /refresh_access_token
      expiresInSec: j2.expires_in ?? 60 * 24 * 60 * 60, // default to 60d
      scopes: SCOPES,
    };
  },

  async refresh({ accessToken }): Promise<OAuthExchangeResult> {
    // Meta uses long-lived token rolling rather than the OAuth refresh_token grant.
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token', // for IG Basic Display; for IG Business we use the Graph endpoint below
      access_token: accessToken,
    });
    const r = await fetch(`${GRAPH_BASE}/refresh_access_token?${params.toString()}`);
    if (!r.ok) throw new Error(`Meta refresh failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { access_token: string; expires_in?: number };
    return {
      accessToken: j.access_token,
      refreshToken: null,
      expiresInSec: j.expires_in ?? 60 * 24 * 60 * 60,
    };
  },

  async meAccount({ accessToken }): Promise<OAuthAccountInfo> {
    // 1. Find FB Pages the user manages
    const pagesRes = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(accessToken)}`);
    if (!pagesRes.ok) throw new Error(`Meta /me/accounts failed: ${pagesRes.status}`);
    const pages = await pagesRes.json() as { data: Array<{ id: string; name: string; access_token: string }> };
    if (!pages.data?.length) throw new Error('No Facebook Pages found on this Meta account.');

    // 2. For the first Page, look up the linked IG Business Account
    const page = pages.data[0];
    const igRes = await fetch(`${GRAPH_BASE}/${page.id}?fields=instagram_business_account,name&access_token=${encodeURIComponent(page.access_token)}`);
    if (!igRes.ok) throw new Error(`Meta page→IG lookup failed: ${igRes.status}`);
    const igLink = await igRes.json() as { instagram_business_account?: { id: string }; name?: string };
    if (!igLink.instagram_business_account?.id) {
      throw new Error(`Page "${page.name}" has no linked Instagram Business Account. Link one in Meta Business Suite first.`);
    }

    // 3. Fetch the IG account display name
    const igMetaRes = await fetch(`${GRAPH_BASE}/${igLink.instagram_business_account.id}?fields=username,name&access_token=${encodeURIComponent(page.access_token)}`);
    const igMeta = igMetaRes.ok ? await igMetaRes.json() as { username?: string; name?: string } : {};

    return {
      externalAccountId: igLink.instagram_business_account.id,
      externalAccountName: igMeta.username || igMeta.name || page.name,
      metadata: {
        facebookPageId: page.id,
        facebookPageName: page.name,
        // Cache the Page access token — Page tokens are non-expiring when derived from a live long-lived user token
        pageAccessToken: page.access_token,
      },
    };
  },
};
