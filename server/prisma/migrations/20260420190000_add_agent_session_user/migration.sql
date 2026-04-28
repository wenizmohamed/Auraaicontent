-- Per-user multi-tenant ownership for AgentSession.
-- Nullable FK + SetNull on user delete so legacy rows survive a user deletion.

ALTER TABLE "AgentSession" ADD COLUMN "userId" TEXT;

-- Backfill: assign all pre-existing sessions to the dev account so the
-- dev user still sees their test history post-migration.  Sessions for
-- which no dev user exists simply stay NULL (invisible to normal queries).
UPDATE "AgentSession"
SET "userId" = (SELECT id FROM "User" WHERE email = 'dev@radix.local' LIMIT 1)
WHERE "userId" IS NULL;

CREATE INDEX "AgentSession_userId_idx" ON "AgentSession"("userId");

ALTER TABLE "AgentSession"
  ADD CONSTRAINT "AgentSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
