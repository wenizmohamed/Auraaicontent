-- Agent platform: AgentSession, AgentMessage, AgentEvent
-- Phase 1 of the Radix → AURA-Manus transform (Socket.IO spine + event persistence).

CREATE TABLE "AgentSession" (
  "id"        TEXT NOT NULL,
  "uid"       TEXT NOT NULL,
  "clientId"  TEXT,
  "title"     TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSession_uid_key" ON "AgentSession"("uid");
CREATE INDEX "AgentSession_clientId_idx" ON "AgentSession"("clientId");
CREATE INDEX "AgentSession_updatedAt_idx" ON "AgentSession"("updatedAt");

ALTER TABLE "AgentSession"
  ADD CONSTRAINT "AgentSession_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgentMessage" (
  "id"         TEXT NOT NULL,
  "sessionId"  TEXT NOT NULL,
  "role"       TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "toolCallId" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentMessage_sessionId_idx" ON "AgentMessage"("sessionId");

ALTER TABLE "AgentMessage"
  ADD CONSTRAINT "AgentMessage_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentEvent" (
  "id"        TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentEvent_sessionId_createdAt_idx" ON "AgentEvent"("sessionId", "createdAt");

ALTER TABLE "AgentEvent"
  ADD CONSTRAINT "AgentEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
