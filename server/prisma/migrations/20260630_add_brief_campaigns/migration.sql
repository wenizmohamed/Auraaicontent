-- Per-campaign brief storage (A1 fix): each campaign keeps its own
-- audience/objective/keyMessage instead of collapsing to campaign #1.
ALTER TABLE "ClientBrief" ADD COLUMN IF NOT EXISTS "campaigns" JSONB;
