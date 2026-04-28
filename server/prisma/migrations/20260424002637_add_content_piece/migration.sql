-- ContentPiece: production-tracking table (stations, assignees, deadlines,
-- review status).  Previously lived entirely in browser localStorage
-- (radix_content_pieces) — rating P1 2026-04-24.
CREATE TABLE "ContentPiece" (
  "id"             TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "station"        TEXT NOT NULL,
  "topicId"        TEXT NOT NULL DEFAULT '',
  "status"         TEXT NOT NULL DEFAULT 'Draft',
  "assignee"       TEXT NOT NULL DEFAULT '',
  "deadline"       TEXT NOT NULL DEFAULT '',
  "visualRefUrl"   TEXT NOT NULL DEFAULT '',
  "visualRefImage" TEXT NOT NULL DEFAULT '',
  "notes"          TEXT NOT NULL DEFAULT '',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentPiece_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentPiece_clientId_idx" ON "ContentPiece"("clientId");
CREATE INDEX "ContentPiece_clientId_status_idx" ON "ContentPiece"("clientId", "status");
CREATE INDEX "ContentPiece_clientId_station_idx" ON "ContentPiece"("clientId", "station");

ALTER TABLE "ContentPiece"
  ADD CONSTRAINT "ContentPiece_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
