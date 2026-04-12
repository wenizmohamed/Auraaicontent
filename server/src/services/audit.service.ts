import { db } from '../db/prisma.js';

/**
 * Lightweight audit logger — writes to the AuditLog Prisma model.
 * Fire-and-forget: errors are logged to console but never thrown.
 */
export const auditService = {
  async log(params: {
    userId?: string;
    clientId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    payload?: Record<string, any>;
  }) {
    try {
      await db.auditLog.create({
        data: {
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

  async recent(limit: number = 50) {
    return db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async byClient(clientId: string, limit: number = 50) {
    return db.auditLog.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
