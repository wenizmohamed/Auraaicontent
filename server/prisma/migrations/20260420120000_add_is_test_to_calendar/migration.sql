-- AlterTable: add isTest flag to CalendarMonth so smoke-test months
-- don't leak into user-facing Recent Months / calendar pickers.
ALTER TABLE "CalendarMonth"
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark pre-existing smoke/VPS/test rows created by scripts/smoke-*.sh
-- Patterns covered:
--   "Smoke 1775843291"         (scripts/smoke-all.sh, smoke-meeting.sh)
--   "Smoke Test 1775843291"    (scripts/smoke-generate.sh)
--   "VPS Smoke 1775843291"     (scripts/smoke-meeting.sh VPS branch)
--   "Test <anything>"          (manual QA rows)
UPDATE "CalendarMonth"
SET "isTest" = true
WHERE "month" ~* '^(vps[[:space:]]+smoke|smoke([[:space:]]+test)?|test)[[:space:]]'
   OR "month" ~* '(smoke[[:space:]]*test|vps[[:space:]]*smoke)';
