/**
 * Shared types for platform integration providers.
 *
 * Every provider module exports an `oauth` and a `publish` object matching
 * these interfaces. The route + worker layers stay platform-agnostic by
 * routing through the registry.
 */

export type PlatformId = 'meta_ig' | 'tiktok' | 'linkedin';

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken?: string | null;
  /** Seconds until access token expires, from now. Some providers omit this. */
  expiresInSec?: number | null;
  scopes?: string[];
}

export interface OAuthAccountInfo {
  /** Platform's stable account identifier (IG user id, TT open_id, LI urn:li:person:...). */
  externalAccountId: string;
  /** Display name shown in the connector card. */
  externalAccountName: string;
  /** Optional platform-specific metadata stored on PlatformConnection.metadata. */
  metadata?: Record<string, any>;
}

export interface OAuthProvider {
  /** Build the consent URL the user is redirected to. */
  initiateUrl(args: { state: string; redirectUri: string }): string;
  /** Exchange the authorization code for tokens. */
  exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthExchangeResult>;
  /** Refresh an expiring access token. Throws if the platform doesn't support refresh. */
  refresh(args: { refreshToken: string | null; accessToken: string }): Promise<OAuthExchangeResult>;
  /** Fetch the connected account's id + display name with a freshly-exchanged token. */
  meAccount(args: { accessToken: string }): Promise<OAuthAccountInfo>;
}

export interface PublishImageInput {
  accessToken: string;
  /** Platform-specific account id. For Meta, this is the IG Business Account id. */
  externalAccountId: string;
  /** Optional platform-specific metadata from PlatformConnection.metadata. */
  metadata?: Record<string, any>;
  /** Public HTTPS image URL — most platforms fetch the image rather than accepting upload bytes. */
  imageUrl: string;
  caption: string;
  hashtags?: string[];
}

export interface PublishResult {
  /** Platform's published post id. */
  externalId: string;
  /** Public URL to the live post, when available. */
  url?: string;
}

export interface PublishProvider {
  publishImage(input: PublishImageInput): Promise<PublishResult>;
}

export interface PlatformModule {
  id: PlatformId;
  label: string;
  oauth: OAuthProvider;
  publish: PublishProvider;
}
