/**
 * LinkedIn personal-share publish module.
 *
 * Three-step:
 *   1. POST /rest/images?action=initializeUpload   → returns ephemeral uploadUrl + image URN
 *   2. PUT  the image bytes to uploadUrl
 *   3. POST /rest/posts                            → creates the post referencing the image URN
 *
 * Required headers on every /rest call:
 *   LinkedIn-Version: 202604
 *   X-Restli-Protocol-Version: 2.0.0
 *   Authorization: Bearer <access_token>
 */
import type { PublishProvider, PublishImageInput, PublishResult } from '../types.js';

const LI_API = 'https://api.linkedin.com';
const LI_VERSION = '202604';

function liHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

export const publish: PublishProvider = {
  async publishImage(input: PublishImageInput): Promise<PublishResult> {
    const { accessToken, externalAccountId, imageUrl, caption, hashtags } = input;
    // externalAccountId is already a URN like `urn:li:person:abc123`
    const ownerUrn = externalAccountId;

    // Stage 1 — initialize image upload
    const initRes = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: liHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!initRes.ok) throw new Error(`LinkedIn image init failed: ${initRes.status} ${await initRes.text()}`);
    const init = await initRes.json() as { value?: { uploadUrl?: string; image?: string } };
    const uploadUrl = init.value?.uploadUrl;
    const imageUrn  = init.value?.image;
    if (!uploadUrl || !imageUrn) throw new Error('LinkedIn image init missing uploadUrl/image');

    // Stage 2 — fetch the image bytes from our public URL, then PUT to LinkedIn's ephemeral upload URL
    const imgFetch = await fetch(imageUrl);
    if (!imgFetch.ok) throw new Error(`Source image fetch failed: ${imgFetch.status} ${imageUrl}`);
    const imgBytes = await imgFetch.arrayBuffer();
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: imgBytes,
    });
    if (!putRes.ok) throw new Error(`LinkedIn image PUT failed: ${putRes.status} ${await putRes.text()}`);

    // Stage 3 — create the post
    const fullCaption = (hashtags?.length ? `${caption}\n\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}` : caption).slice(0, 3000);
    const postRes = await fetch(`${LI_API}/rest/posts`, {
      method: 'POST',
      headers: liHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: ownerUrn,
        commentary: fullCaption,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { id: imageUrn, title: caption.slice(0, 80) || 'Post' } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!postRes.ok) throw new Error(`LinkedIn post create failed: ${postRes.status} ${await postRes.text()}`);
    // Post URN is returned in the x-restli-id header; body is empty
    const postUrn = postRes.headers.get('x-restli-id') || postRes.headers.get('x-linkedin-id') || '';
    if (!postUrn) throw new Error('LinkedIn post create returned no URN');
    const id = postUrn.includes(':') ? postUrn.split(':').pop()! : postUrn;
    return {
      externalId: postUrn,
      url: `https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A${encodeURIComponent(id)}/`,
    };
  },
};
