// Defense-in-depth tenant scoping. Every tenant-scoped model query MUST
// include orgId in `where` (for read/update/delete) or `data` (for
// create/upsert). The extension throws if it doesn't, so a missed scope
// surfaces as a loud error in dev/test instead of a silent cross-tenant
// data leak in production.
//
// Set RADIX_TENANT_GUARD=warn to log instead of throw (for migrations or
// jobs that need temporary unscoped access). Default = throw.
//
// Models exempted from scoping (no per-tenant data):
//   User, RefreshToken, Organization, OrgMembership, Invitation
import { Prisma } from '@prisma/client';

const TENANT_MODELS = new Set([
  'Client',
  'ApiKey',
  'ContentPiece',
  'ClientBrief',
  'KnowledgeItem',
  'KnowledgeChunk',
  'Asset',
  'CalendarMonth',
  'CalendarPost',
  'PostVisualReference',
  'CalendarPostAsset',
  'PostVersion',
  'PostComment',
  'ReviewLink',
  'ExportJob',
  'AuditLog',
  'AgentSession',
  'AgentMessage',
  'AgentEvent',
  'UsageEvent',
  'PlatformConnection',
  'Generation',
]);

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPS_WITH_WHERE = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

const CREATE_OPS = new Set(['create', 'createMany', 'upsert']);

function whereHasOrgScope(where: any): boolean {
  if (!where || typeof where !== 'object') return false;
  if ('orgId' in where) return true;
  // Composite `where` clauses with AND/OR: any branch with orgId counts.
  if (Array.isArray(where.AND) && where.AND.some(whereHasOrgScope)) return true;
  // Some routes scope via parent FK (e.g. CalendarPost via calendarMonth.orgId).
  // Allow if parent relation has orgId in its filter — the FK + parent's orgId
  // index keeps this safe.
  for (const v of Object.values(where)) {
    if (v && typeof v === 'object' && 'orgId' in (v as any)) return true;
  }
  return false;
}

function dataHasOrgScope(data: any): boolean {
  if (!data) return false;
  if (Array.isArray(data)) return data.every(dataHasOrgScope);
  if (typeof data !== 'object') return false;
  if ('orgId' in data) return true;
  // Connect via relation: { org: { connect: { id: ... } } }
  if (data.org?.connect?.id) return true;
  return false;
}

export const tenantGuardExtension = Prisma.defineExtension({
  name: 'tenant-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_MODELS.has(model)) return query(args);

        const mode = process.env.RADIX_TENANT_GUARD ?? 'throw';
        if (mode === 'off') return query(args);

        let violation: string | null = null;

        if (READ_OPS.has(operation) || WRITE_OPS_WITH_WHERE.has(operation)) {
          const where = (args as any)?.where;
          if (!whereHasOrgScope(where)) {
            violation = `${model}.${operation} called without orgId in where clause`;
          }
        } else if (CREATE_OPS.has(operation)) {
          const data = (args as any)?.data ?? (args as any)?.create;
          if (!dataHasOrgScope(data)) {
            violation = `${model}.${operation} called without orgId in data`;
          }
        }

        if (violation) {
          if (mode === 'warn') {
            // eslint-disable-next-line no-console
            console.warn('[tenant-guard]', violation);
          } else {
            throw new Error(`[tenant-guard] ${violation}`);
          }
        }
        return query(args);
      },
    },
  },
});
