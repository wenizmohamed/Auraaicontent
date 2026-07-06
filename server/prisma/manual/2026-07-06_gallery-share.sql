CREATE TABLE IF NOT EXISTS "GalleryShareLink" (
  "id" text PRIMARY KEY,
  "orgId" text NOT NULL,
  "clientId" text NOT NULL,
  "token" text NOT NULL,
  "title" text,
  "expiresAt" timestamp(3),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "GalleryShareLink_token_key" ON "GalleryShareLink"("token");
CREATE INDEX IF NOT EXISTS "GalleryShareLink_clientId_idx" ON "GalleryShareLink"("clientId");

CREATE TABLE IF NOT EXISTS "AssetFeedback" (
  "id" text PRIMARY KEY,
  "orgId" text NOT NULL,
  "assetId" text NOT NULL,
  "shareToken" text NOT NULL,
  "authorName" text NOT NULL,
  "comment" text,
  "decision" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AssetFeedback_assetId_idx" ON "AssetFeedback"("assetId");
CREATE INDEX IF NOT EXISTS "AssetFeedback_shareToken_idx" ON "AssetFeedback"("shareToken");
