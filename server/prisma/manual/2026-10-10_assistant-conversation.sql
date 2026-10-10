-- Assistant conversation store: one row per (org, user). Holds the chat/agent
-- transcript so it follows the user across devices, plus the last chat reply
-- so a reply survives a page refresh while it was still being generated.
-- Idempotent: safe to run more than once (prod's migration ledger is behind,
-- so tables are added by raw SQL, never `prisma migrate deploy`).
CREATE TABLE IF NOT EXISTS "AssistantConversation" (
  "id" text PRIMARY KEY,
  "orgId" text NOT NULL,
  "userId" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "rev" double precision NOT NULL DEFAULT 0,
  "lastTurn" jsonb,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT "AssistantConversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantConversation_orgId_userId_key" ON "AssistantConversation"("orgId", "userId");
CREATE INDEX IF NOT EXISTS "AssistantConversation_orgId_idx" ON "AssistantConversation"("orgId");
