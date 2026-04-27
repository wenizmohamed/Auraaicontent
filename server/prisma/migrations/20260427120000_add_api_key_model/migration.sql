-- ApiKey: external-integration keys, bcrypt-hashed, scoped per Client.
-- Plaintext key (sk-radix-{32}) returned ONCE at creation; only hash persists.
-- Revocation is soft (revokedAt timestamp) so audit trails survive.
CREATE TABLE "ApiKey" (
    "id"          TEXT NOT NULL,
    "clientId"    TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "keyHash"     TEXT NOT NULL,
    "keyPrefix"   TEXT NOT NULL,
    "lastUsedAt"  TIMESTAMP(3),
    "expiresAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"   TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_clientId_idx" ON "ApiKey"("clientId");
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

ALTER TABLE "ApiKey"
    ADD CONSTRAINT "ApiKey_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
