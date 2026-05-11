-- BrandKit v2 (F3): standalone 1:1 with Client.  Mirrors primaryColor on
-- Client for compute simplicity at enrichment time; logoUrl + primaryColor
-- on Client are PRESERVED (legacy callers still read them).  Versioning via
-- BrandKitVersion snapshot rows (full prior-state JSON for rollback).
-- Spec: docs/radix-v2-ultimate-spec.md §3.

CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "fontPrimary" TEXT,
    "fontSecondary" TEXT,
    "voiceSamples" JSONB[],
    "voiceDoNot" JSONB,
    "voicePerPlatform" JSONB,
    "sampleImages" JSONB[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandKit_clientId_key" ON "BrandKit"("clientId");
CREATE INDEX "BrandKit_orgId_idx" ON "BrandKit"("orgId");
CREATE INDEX "BrandKit_clientId_idx" ON "BrandKit"("clientId");

ALTER TABLE "BrandKit"
  ADD CONSTRAINT "BrandKit_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandKit"
  ADD CONSTRAINT "BrandKit_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BrandKitVersion" (
    "id" TEXT NOT NULL,
    "brandKitId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "BrandKitVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrandKitVersion_brandKitId_version_idx" ON "BrandKitVersion"("brandKitId", "version");

ALTER TABLE "BrandKitVersion"
  ADD CONSTRAINT "BrandKitVersion_brandKitId_fkey"
  FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
