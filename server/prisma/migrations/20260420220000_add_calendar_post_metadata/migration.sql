-- Agent annotation payload on posts: compliance findings, tool provenance,
-- research notes.  Nullable for backfill safety.

ALTER TABLE "CalendarPost" ADD COLUMN "metadata" JSONB;
