/**
 * Platform registry — single source of truth for which platforms exist
 * and how to invoke them.
 *
 * Routes + workers stay platform-agnostic by going through this registry:
 *   const mod = getPlatformModule('meta_ig');
 *   const url = mod.oauth.initiateUrl({ state, redirectUri });
 *   const out = await mod.publish.publishImage({...});
 */
import type { PlatformId, PlatformModule } from './types.js';
import { oauth as metaOauth }      from './meta_ig/oauth.js';
import { publish as metaPublish }  from './meta_ig/publish.js';
import { oauth as ttOauth }        from './tiktok/oauth.js';
import { publish as ttPublish }    from './tiktok/publish.js';
import { oauth as liOauth }        from './linkedin/oauth.js';
import { publish as liPublish }    from './linkedin/publish.js';

const registry: Record<PlatformId, PlatformModule> = {
  meta_ig:  { id: 'meta_ig',  label: 'Instagram Business', oauth: metaOauth, publish: metaPublish },
  tiktok:   { id: 'tiktok',   label: 'TikTok Business',    oauth: ttOauth,   publish: ttPublish },
  linkedin: { id: 'linkedin', label: 'LinkedIn',           oauth: liOauth,   publish: liPublish },
};

export function getPlatformModule(id: string): PlatformModule {
  const mod = registry[id as PlatformId];
  if (!mod) throw new Error(`Unknown platform: ${id}. Supported: ${Object.keys(registry).join(', ')}`);
  return mod;
}

export function listPlatformIds(): PlatformId[] {
  return Object.keys(registry) as PlatformId[];
}

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  meta_ig: 'Instagram Business',
  tiktok: 'TikTok Business',
  linkedin: 'LinkedIn',
};
