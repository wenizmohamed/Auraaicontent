/**
 * Meta / Instagram Business publish module.
 *
 * Two-step "container then publish" flow per the IG Graph API:
 *   POST /{ig-user-id}/media          → returns creation_id (the container)
 *   POST /{ig-user-id}/media_publish  → publishes the container
 *
 * Image must be served from a public HTTPS URL — Meta fetches it server-side.
 * Caption capped at 2200 chars; hashtags capped at 30 (IG hard limit).
 *
 * NOTE: We use the Page access token (cached on PlatformConnection.metadata.
 * pageAccessToken at OAuth time) rather than the user token because Page
 * tokens are non-expiring when derived from a live long-lived user token.
 */
import type { PublishProvider, PublishImageInput, PublishResult } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;

function buildCaption(caption: string, hashtags: string[] = []): string {
  const tags = hashtags.slice(0, HASHTAG_MAX).map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
  const full = tags ? `${caption}\n\n${tags}` : caption;
  return full.length <= CAPTION_MAX ? full : full.slice(0, CAPTION_MAX - 1) + '…';
}

export const publish: PublishProvider = {
  async publishImage(input: PublishImageInput): Promise<PublishResult> {
    const { externalAccountId: igUserId, imageUrl, caption, hashtags, metadata } = input;
    if (!/^https:\/\//i.test(imageUrl)) {
      throw new Error(`Meta requires public HTTPS imageUrl; got "${imageUrl.slice(0, 80)}"`);
    }
    // Page access token preferred; fall back to user token if metadata didn't cache one.
    const token = metadata?.pageAccessToken || input.accessToken;

    // Step 1 — create media container
    const containerParams = new URLSearchParams({
      image_url: imageUrl,
      caption: buildCaption(caption, hashtags),
      access_token: token,
    });
    const r1 = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
      method: 'POST',
      body: containerParams,
    });
    if (!r1.ok) {
      throw new Error(`Meta media-container failed: ${r1.status} ${await r1.text()}`);
    }
    const j1 = await r1.json() as { id?: string; error?: any };
    if (!j1.id) throw new Error(`Meta media-container missing id: ${JSON.stringify(j1).slice(0, 200)}`);

    // Step 2 — publish the container
    const publishParams = new URLSearchParams({
      creation_id: j1.id,
      access_token: token,
    });
    const r2 = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      body: publishParams,
    });
    if (!r2.ok) {
      throw new Error(`Meta media-publish failed: ${r2.status} ${await r2.text()}`);
    }
    const j2 = await r2.json() as { id?: string };
    if (!j2.id) throw new Error(`Meta media-publish missing id: ${JSON.stringify(j2).slice(0, 200)}`);

    // Best-effort: fetch the post permalink for the UI link
    let url: string | undefined;
    try {
      const permaRes = await fetch(`${GRAPH_BASE}/${j2.id}?fields=permalink&access_token=${encodeURIComponent(token)}`);
      if (permaRes.ok) {
        const perma = await permaRes.json() as { permalink?: string };
        url = perma.permalink;
      }
    } catch { /* permalink is decorative */ }

    return { externalId: j2.id, url };
  },
};
