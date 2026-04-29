-- Multi-tenancy migration. Adds Organization, OrgMembership, Invitation,
-- UsageEvent. Backfills every existing tenant row into a single
-- "Radix Media" organization so the migration is non-destructive.
--
-- Order matters: create Organization → seed row → add nullable orgId
-- columns → backfill → SET NOT NULL → indices + foreign keys. Anything
-- else risks a constraint violation against pre-existing rows.

BEGIN;

-- ─── 1. Enum + new tables ─────────────────────────────────────────────
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripeCustomerId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'EDITOR',
    "token" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "ref" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- ─── 2. Seed default org and enroll all existing users ────────────────
INSERT INTO "Organization" ("id", "name", "slug", "plan", "status", "createdAt", "updatedAt")
VALUES ('org_radix_media', 'Radix Media', 'radix-media', 'agency', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "OrgMembership" ("id", "userId", "orgId", "role", "createdAt")
SELECT 'mem_seed_' || "id", "id", 'org_radix_media', 'OWNER', CURRENT_TIMESTAMP
FROM "User";

ALTER TABLE "User" ADD COLUMN "currentOrgId" TEXT;
UPDATE "User" SET "currentOrgId" = 'org_radix_media';

-- ─── 3. Add orgId to every tenant model — nullable, backfill, NOT NULL ─

-- Client (root of clientId graph)
ALTER TABLE "Client" ADD COLUMN "dialect" TEXT;
ALTER TABLE "Client" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Client" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Client" ADD COLUMN "whatsappNumber" TEXT;
UPDATE "Client" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "Client" ALTER COLUMN "orgId" SET NOT NULL;

-- Direct children of Client
ALTER TABLE "ApiKey" ADD COLUMN "orgId" TEXT;
UPDATE "ApiKey" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "ApiKey" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "ContentPiece" ADD COLUMN "orgId" TEXT;
UPDATE "ContentPiece" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "ContentPiece" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "ClientBrief" ADD COLUMN "orgId" TEXT;
UPDATE "ClientBrief" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "ClientBrief" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "KnowledgeItem" ADD COLUMN "orgId" TEXT;
UPDATE "KnowledgeItem" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "KnowledgeItem" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "Asset" ADD COLUMN "orgId" TEXT;
UPDATE "Asset" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "Asset" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "CalendarMonth" ADD COLUMN "orgId" TEXT;
UPDATE "CalendarMonth" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "CalendarMonth" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "ReviewLink" ADD COLUMN "orgId" TEXT;
UPDATE "ReviewLink" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "ReviewLink" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "ExportJob" ADD COLUMN "orgId" TEXT;
UPDATE "ExportJob" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "ExportJob" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN "orgId" TEXT;
UPDATE "AuditLog" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "orgId" SET NOT NULL;

-- Grandchildren (no direct clientId — denormalize via parent join)
ALTER TABLE "KnowledgeChunk" ADD COLUMN "orgId" TEXT;
UPDATE "KnowledgeChunk" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "CalendarPost" ADD COLUMN "orgId" TEXT;
UPDATE "CalendarPost" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "CalendarPost" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "PostVisualReference" ADD COLUMN "orgId" TEXT;
UPDATE "PostVisualReference" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "PostVisualReference" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "CalendarPostAsset" ADD COLUMN "orgId" TEXT;
UPDATE "CalendarPostAsset" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "CalendarPostAsset" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "PostVersion" ADD COLUMN "orgId" TEXT;
UPDATE "PostVersion" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "PostVersion" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "PostComment" ADD COLUMN "orgId" TEXT;
UPDATE "PostComment" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "PostComment" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "AgentSession" ADD COLUMN "orgId" TEXT;
UPDATE "AgentSession" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "AgentSession" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "AgentMessage" ADD COLUMN "orgId" TEXT;
UPDATE "AgentMessage" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "AgentMessage" ALTER COLUMN "orgId" SET NOT NULL;

ALTER TABLE "AgentEvent" ADD COLUMN "orgId" TEXT;
UPDATE "AgentEvent" SET "orgId" = 'org_radix_media' WHERE "orgId" IS NULL;
ALTER TABLE "AgentEvent" ALTER COLUMN "orgId" SET NOT NULL;

-- ─── 4. Indexes ───────────────────────────────────────────────────────
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "OrgMembership_orgId_idx" ON "OrgMembership"("orgId");
CREATE UNIQUE INDEX "OrgMembership_userId_orgId_key" ON "OrgMembership"("userId", "orgId");
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_orgId_idx" ON "Invitation"("orgId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE INDEX "UsageEvent_orgId_createdAt_idx" ON "UsageEvent"("orgId", "createdAt");
CREATE INDEX "UsageEvent_orgId_kind_createdAt_idx" ON "UsageEvent"("orgId", "kind", "createdAt");

CREATE INDEX "AgentEvent_orgId_idx" ON "AgentEvent"("orgId");
CREATE INDEX "AgentMessage_orgId_idx" ON "AgentMessage"("orgId");
CREATE INDEX "AgentSession_orgId_idx" ON "AgentSession"("orgId");
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");
CREATE INDEX "Asset_orgId_idx" ON "Asset"("orgId");
CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog"("orgId");
CREATE INDEX "CalendarMonth_orgId_idx" ON "CalendarMonth"("orgId");
CREATE INDEX "CalendarPost_orgId_idx" ON "CalendarPost"("orgId");
CREATE INDEX "CalendarPostAsset_orgId_idx" ON "CalendarPostAsset"("orgId");

DROP INDEX "Client_slug_key";
CREATE INDEX "Client_orgId_idx" ON "Client"("orgId");
CREATE UNIQUE INDEX "Client_orgId_slug_key" ON "Client"("orgId", "slug");

CREATE INDEX "ClientBrief_orgId_idx" ON "ClientBrief"("orgId");
CREATE INDEX "ContentPiece_orgId_idx" ON "ContentPiece"("orgId");
CREATE INDEX "ExportJob_orgId_idx" ON "ExportJob"("orgId");
CREATE INDEX "KnowledgeChunk_orgId_idx" ON "KnowledgeChunk"("orgId");
CREATE INDEX "KnowledgeItem_orgId_idx" ON "KnowledgeItem"("orgId");
CREATE INDEX "PostComment_orgId_idx" ON "PostComment"("orgId");
CREATE INDEX "PostVersion_orgId_idx" ON "PostVersion"("orgId");
CREATE INDEX "PostVisualReference_orgId_idx" ON "PostVisualReference"("orgId");
CREATE INDEX "ReviewLink_orgId_idx" ON "ReviewLink"("orgId");

-- ─── 5. Foreign keys ──────────────────────────────────────────────────
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Client" ADD CONSTRAINT "Client_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientBrief" ADD CONSTRAINT "ClientBrief_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarMonth" ADD CONSTRAINT "CalendarMonth_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarPost" ADD CONSTRAINT "CalendarPost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostVisualReference" ADD CONSTRAINT "PostVisualReference_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarPostAsset" ADD CONSTRAINT "CalendarPostAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostVersion" ADD CONSTRAINT "PostVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
