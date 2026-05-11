-- F2 Post scheduler — adds the columns the scheduler.worker polls.
-- §2 of docs/radix-v2-ultimate-spec.md.
--
-- scheduledAt           : ISO datetime when the post should auto-publish.
-- platformConnectionId  : FK to PlatformConnection (which account to publish to).
-- scheduleError         : last error message from a failed auto-publish run
--                         (publish.worker.ts already writes per-platform errors
--                         into platformPublishStatus; this column is the
--                         scheduler's single-string surface for UI badges).

ALTER TABLE "CalendarPost"
  ADD COLUMN     "scheduledAt"          TIMESTAMP(3),
  ADD COLUMN     "platformConnectionId" TEXT,
  ADD COLUMN     "scheduleError"        TEXT;

-- Worker queries: where status='scheduled' AND scheduledAt <= now+60s.
-- Composite index keeps the poll cheap as the table grows.
CREATE INDEX "CalendarPost_status_scheduledAt_idx"
  ON "CalendarPost" ("status", "scheduledAt");

-- Soft FK (no cascade) — if the connection is revoked we still want the
-- row around so the user can re-attach a different connection. Worker
-- handles the missing-connection case by marking the post 'failed'.
ALTER TABLE "CalendarPost"
  ADD CONSTRAINT "CalendarPost_platformConnectionId_fkey"
  FOREIGN KEY ("platformConnectionId")
  REFERENCES   "PlatformConnection"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "CalendarPost_platformConnectionId_idx"
  ON "CalendarPost" ("platformConnectionId");
