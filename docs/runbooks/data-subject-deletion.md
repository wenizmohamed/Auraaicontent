# Data-Subject Deletion (GDPR / O8)

**Purpose:** delete all data attributable to a single User identifier on request, in a single transaction.

## Cascade chain

Per `prisma/schema.prisma` (User model relations):

| Foreign | onDelete |
|---|---|
| User → RefreshToken[].userId | Cascade |
| User → AuditLog[].userId | Cascade |
| User → AgentSession[].userId | Cascade |
| User → PostComment[].authorId | Cascade |

The Prisma cascade triggers on the final `DELETE FROM "User"` statement, but the script also runs explicit child-table deletes first to surface any orphan-row errors clearly (a Cascade chain that fails partway gives a hard-to-read FK violation; explicit deletes give per-table error messages).

## Procedure

```bash
./scripts/delete-user.sh <userId>
```

The script SSH's to the VPS, parses `DATABASE_URL` from `/opt/radix-v2/server/.env`, runs the cascade in a single `BEGIN; … COMMIT;` block.

## Discovering the userId

```bash
ssh -i ~/.ssh/radix_vps root@srv1494206.hstgr.cloud "
  ENV_FILE=/opt/radix-v2/server/.env
  DB_URL=\$(awk -F= '/^DATABASE_URL=/{ sub(/^DATABASE_URL=/, \"\"); print }' \"\$ENV_FILE\" | tr -d '\"')
  DB_PASS=\$(printf '%s' \"\$DB_URL\" | sed -E 's|^postgres(ql)?://[^:]+:([^@]+)@.*$|\\2|')
  PGPASSWORD=\"\$DB_PASS\" psql -h 127.0.0.1 -U radix -d radix_planner -tAc \"SELECT id, email FROM \\\"User\\\" WHERE email='<their-email>'\"
"
```

## Audit log

The deletion itself is NOT logged to `AuditLog` (the user's own AuditLog rows are gone). Capture a separate operator log entry in `docs/runbooks/deletions.log`:

```
YYYY-MM-DD  <userId>  <operator>  <reason>
```

## What is NOT deleted

- `Client` + `ClientBrief` — organization data, not user data.
- `CalendarPost` / `Asset` / `KnowledgeItem` — client-owned, not user-owned.
- `ApiKey` — client-scoped, not user-scoped. (The per-key `lastUsedAt` is anonymized once the User is gone.)
- `ContentPiece` — has free-form `assignee: string` field but no FK to User; if the assignee value matches the deleted user's name, manually nullify those rows OR document the residual identifier.

## Tested

Demo-deletion of `demo-member@radix.local` → reseed via `node dist/prisma/seed.js` recreated cleanly. Pending live verification before declaring O8 GREEN.
