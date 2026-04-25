-- Add missing FK indexes to keep large-table joins from sequential scans.
-- All wrapped in IF NOT EXISTS so the migration is idempotent if any of
-- these were added piecemeal in earlier work. PostVisualReference.postId
-- already has @@index in schema → not re-added here.

CREATE INDEX IF NOT EXISTS "KnowledgeItem_clientId_idx" ON "KnowledgeItem"("clientId");
CREATE INDEX IF NOT EXISTS "Asset_clientId_idx" ON "Asset"("clientId");
CREATE INDEX IF NOT EXISTS "CalendarPost_calendarMonthId_idx" ON "CalendarPost"("calendarMonthId");
CREATE INDEX IF NOT EXISTS "PostComment_postId_idx" ON "PostComment"("postId");
CREATE INDEX IF NOT EXISTS "PostComment_authorId_idx" ON "PostComment"("authorId");
CREATE INDEX IF NOT EXISTS "ReviewLink_clientId_idx" ON "ReviewLink"("clientId");
CREATE INDEX IF NOT EXISTS "ExportJob_clientId_idx" ON "ExportJob"("clientId");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_clientId_idx" ON "AuditLog"("clientId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_knowledgeItemId_idx" ON "KnowledgeChunk"("knowledgeItemId");

-- Add unique constraints needed for idempotent upserts in seed.ts.
-- These reflect the data-model invariants ("one month string per client",
-- "one post per (date,month)") that were already enforced at the
-- application layer but never declared in the schema.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarMonth_clientId_month_key') THEN
    ALTER TABLE "CalendarMonth" ADD CONSTRAINT "CalendarMonth_clientId_month_key" UNIQUE ("clientId", "month");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarPost_calendarMonthId_date_key') THEN
    ALTER TABLE "CalendarPost" ADD CONSTRAINT "CalendarPost_calendarMonthId_date_key" UNIQUE ("calendarMonthId", "date");
  END IF;
END $$;
