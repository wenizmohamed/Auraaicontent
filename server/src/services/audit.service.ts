import { db } from '../db/prisma.js';

/**
 * Lightweight audit logger — writes to the AuditLog Prisma model.
 * Fire-and-forget: errors are logged to console but never thrown.
 *
 * orgId is required (NOT NULL post-migration). When the caller doesn't
 * have org context (e.g. unauthenticated /v2 token routes), pass
 * `orgId: undefined` and we drop the log instead of throwing — auditing
 * of unauthenticated calls happens at the access-log layer.
 */
export const auditService = {
  async log(params: {
    orgId: string | undefined;
    userId?: string;
    clientId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    payload?: Record<string, any>;
  }) {
    if (!params.orgId) return; // unauthenticated — no audit row
    try {
      await db.auditLog.create({
        data: {
          orgId: params.orgId,
          userId: params.userId || null,
          clientId: params.clientId || null,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId || null,
          payload: params.payload ?? undefined,
        },
      });
    } catch (err) {
      console.error('[audit] Failed to write audit log:', err);
    }
  },

  async recent(orgId: string, limit: number = 50) {
    return db.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async byClient(orgId: string, clientId: string, limit: number = 50) {
    return db.auditLog.findMany({
      where: { orgId, clientId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
