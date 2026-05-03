/**
 * TikTok Business publish module — photo direct-post.
 *
 * Three-stage flow:
 *   1. POST /v2/post/publish/content/init/  with media_type=PHOTO
 *      → returns publish_id + upload URLs (TikTok pulls the photo from the URL we provide)
 *   2. (TikTok fetches the image asynchronously)
 *   3. POST /v2/post/publish/status/fetch/   to poll until status === 'PUBLISH_COMPLETE'
 *
 * Until the app is audited, posts land as SELF_ONLY regardless of the
 * disable_comment / privacy_level settings. Surfaced to the user via
 * connection.metadata.audited.
 */
import type { PublishProvider, PublishImageInput, PublishResult } from '../types.js';

const TT_API = 'https://open.tiktokapis.com/v2';
const POLL_INTERVAL_MS = 4_000;
const POLL_MAX_TRIES = 30; // ~2 minutes

export const publish: PublishProvider = {
  async publishImage(input: PublishImageInput): Promise<PublishResult> {
    const { accessToken, imageUrl, caption, hashtags, metadata } = input;
    const audited = metadata?.audited === true;
    const fullCaption = (hashtags?.length ? `${caption}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}` : caption).slice(0, 2200);

    // Stage 1 — init
    const initRes = await fetch(`${TT_API}/post/publish/content/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: fullCaption.slice(0, 90),  // optional title — short
          description: fullCaption,
          privacy_level: audited ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY',
          disable_comment: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [imageUrl],
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      }),
    });
    if (!initRes.ok) throw new Error(`TikTok init failed: ${initRes.status} ${await initRes.text()}`);
    const init = await initRes.json() as { data?: { publish_id?: string }, error?: { code?: string; message?: string } };
    if (init.error?.code && init.error.code !== 'ok') {
      throw new Error(`TikTok init error: ${init.error.code} — ${init.error.message}`);
    }
    const publishId = init.data?.publish_id;
    if (!publishId) throw new Error('TikTok init returned no publish_id');

    // Stage 2 — poll status
    let lastStatus: string | undefined;
    let externalId: string | undefined;
    for (let i = 0; i < POLL_MAX_TRIES; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const sRes = await fetch(`${TT_API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      if (!sRes.ok) continue;
      const s = await sRes.json() as { data?: { status?: string; publicaly_available_post_id?: string[]; fail_reason?: string } };
      lastStatus = s.data?.status;
      if (lastStatus === 'PUBLISH_COMPLETE') {
        externalId = s.data?.publicaly_available_post_id?.[0] || publishId;
        break;
      }
      if (lastStatus === 'FAILED') {
        throw new Error(`TikTok publish failed: ${s.data?.fail_reason || 'unknown'}`);
      }
    }
    if (!externalId) throw new Error(`TikTok publish timed out (last status: ${lastStatus})`);

    return {
      externalId,
      url: audited ? `https://www.tiktok.com/@unknown/photo/${externalId}` : undefined,
    };
  },
};
