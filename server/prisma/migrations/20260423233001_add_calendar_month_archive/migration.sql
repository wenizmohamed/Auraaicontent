-- Add soft-archive fields to CalendarMonth so "Reset Month" becomes reversible.
-- Hard delete still supported via DELETE ?hard=true but default is archive.
ALTER TABLE "CalendarMonth"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "CalendarMonth_clientId_isArchived_idx"
  ON "CalendarMonth"("clientId", "isArchived");
