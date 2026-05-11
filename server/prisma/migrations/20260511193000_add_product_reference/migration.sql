-- ProductReference: per-client product catalog with multi-angle images.
-- Workshop 2026-05-06 #4 (Haneen) — drop a product into any generation
-- prompt for visual consistency across the campaign.
CREATE TABLE "ProductReference" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "angles" JSONB NOT NULL,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductReference_orgId_idx" ON "ProductReference"("orgId");
CREATE INDEX "ProductReference_clientId_idx" ON "ProductReference"("clientId");
CREATE INDEX "ProductReference_clientId_createdAt_idx" ON "ProductReference"("clientId", "createdAt");

ALTER TABLE "ProductReference"
  ADD CONSTRAINT "ProductReference_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductReference"
  ADD CONSTRAINT "ProductReference_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
