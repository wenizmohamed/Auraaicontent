-- Mounted via docker-compose.ci.yml into /docker-entrypoint-initdb.d/.
-- Runs once on first postgres boot before any prisma migration.
-- Required by migration 20260408145852_init which creates a `vector`-typed
-- column on KnowledgeChunk.embedding.
CREATE EXTENSION IF NOT EXISTS vector;
