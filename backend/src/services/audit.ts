import type { Prisma } from '@prisma/client';
import db from '../lib/db.js';

interface AuditParams {
  businessId: string;
  entityType: string;
  entityId: string;
  action: string;
  performedByUserId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export const writeAuditLog = async (params: AuditParams): Promise<void> => {
  await db.auditLog.create({
    data: {
      businessId: params.businessId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      performedByUserId: params.performedByUserId,
      oldValue: (params.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (params.newValue ?? undefined) as Prisma.InputJsonValue | undefined
    }
  });
};
