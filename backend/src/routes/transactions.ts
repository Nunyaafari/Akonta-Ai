import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { writeAuditLog } from '../services/audit.js';

const transactionTypes = ['revenue', 'expense'] as const;
const transactionEventTypes = [
  'cash_sale',
  'momo_sale',
  'credit_sale',
  'debtor_recovery',
  'stock_purchase',
  'operating_expense',
  'owner_withdrawal',
  'loan_received',
  'loan_repayment',
  'supplier_credit',
  'capital_introduced',
  'other'
] as const;
const transactionStatuses = ['draft', 'confirmed'] as const;

type TransactionTypeInput = (typeof transactionTypes)[number];
type TransactionEventTypeInput = (typeof transactionEventTypes)[number];
type TransactionStatusInput = (typeof transactionStatuses)[number];

const isTransactionType = (value: unknown): value is TransactionTypeInput =>
  typeof value === 'string' && transactionTypes.includes(value as TransactionTypeInput);

const isTransactionEventType = (value: unknown): value is TransactionEventTypeInput =>
  typeof value === 'string' && transactionEventTypes.includes(value as TransactionEventTypeInput);

const isTransactionStatus = (value: unknown): value is TransactionStatusInput =>
  typeof value === 'string' && transactionStatuses.includes(value as TransactionStatusInput);

const parseOptionalDate = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const startOfUtcToday = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const isHistorical = (value: Date): boolean => value.getTime() < startOfUtcToday().getTime();

const serializePatch = (payload: Record<string, unknown>): string => `PATCH_JSON:${JSON.stringify(payload)}`;
const parsePatchFromReason = (reason?: string | null): Record<string, unknown> | null => {
  if (!reason || !reason.startsWith('PATCH_JSON:')) return null;
  const raw = reason.slice('PATCH_JSON:'.length);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:create');
    if (!auth) return;

    const body = request.body as {
      type: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      amount: number;
      date?: string;
      category?: string;
      notes?: string;
      correctionReason?: string;
      sourceChannel?: 'app' | 'whatsapp' | 'system';
    };

    if (!isTransactionType(body.type) || typeof body.amount !== 'number' || body.amount <= 0) {
      return reply.status(400).send({ message: 'A valid type and positive amount are required.' });
    }

    if (body.eventType && !isTransactionEventType(body.eventType)) {
      return reply.status(400).send({ message: 'Invalid eventType value.' });
    }

    if (body.status && !isTransactionStatus(body.status)) {
      return reply.status(400).send({ message: 'Invalid status value.' });
    }

    const parsedDate = parseOptionalDate(body.date);
    if (body.date && !parsedDate) {
      return reply.status(400).send({ message: 'Invalid date value.' });
    }

    const status = body.status ?? 'confirmed';
    const transaction = await db.transaction.create({
      data: {
        businessId: auth.businessId,
        userId: auth.userId,
        createdByUserId: auth.userId,
        sourceChannel: body.sourceChannel ?? 'app',
        type: body.type,
        eventType: body.eventType ?? 'other',
        status,
        amount: body.amount,
        date: parsedDate ?? new Date(),
        category: body.category ?? null,
        notes: body.notes ?? null,
        correctionReason: body.correctionReason ?? null,
        approvalStatus: 'not_required',
        confirmedAt: status === 'confirmed' ? new Date() : null
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'transaction',
      entityId: transaction.id,
      action: 'transaction_created',
      performedByUserId: auth.userId,
      newValue: transaction as unknown as Record<string, unknown>
    });

    reply.status(201);
    return transaction;
  });

  fastify.get('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:view');
    if (!auth) return;

    const query = request.query as {
      type?: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      start?: string;
      end?: string;
      includeCorrections?: string;
      includeDeleted?: string;
      mineOnly?: string;
    };

    if (query.type && !isTransactionType(query.type)) {
      return reply.status(400).send({ message: 'Invalid type query parameter.' });
    }

    if (query.eventType && !isTransactionEventType(query.eventType)) {
      return reply.status(400).send({ message: 'Invalid eventType query parameter.' });
    }

    if (query.status && !isTransactionStatus(query.status)) {
      return reply.status(400).send({ message: 'Invalid status query parameter.' });
    }

    const where: Record<string, any> = { businessId: auth.businessId };

    if (query.type) where.type = query.type;
    if (query.eventType) where.eventType = query.eventType;
    if (query.status) where.status = query.status;
    if (query.includeCorrections !== 'true') where.correctionOfId = null;
    if (query.includeDeleted !== 'true') where.isDeleted = false;

    const forceMineOnly = auth.role === 'cashier' || auth.role === 'viewer';
    if (forceMineOnly || query.mineOnly === 'true') {
      where.createdByUserId = auth.userId;
    }

    if (query.start || query.end) {
      where.date = {};
      if (query.start) {
        const parsed = parseOptionalDate(query.start);
        if (!parsed) return reply.status(400).send({ message: 'Invalid start date value.' });
        where.date.gte = parsed;
      }
      if (query.end) {
        const parsed = parseOptionalDate(query.end);
        if (!parsed) return reply.status(400).send({ message: 'Invalid end date value.' });
        where.date.lte = parsed;
      }
    }

    const transactions = await db.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        createdByUser: { select: { id: true, name: true, fullName: true } },
        approvedByUser: { select: { id: true, name: true, fullName: true } }
      }
    });

    return transactions;
  });

  fastify.patch('/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:edit_same_day');
    if (!auth) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      type?: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      amount?: number;
      date?: string;
      category?: string | null;
      notes?: string | null;
      correctionReason?: string | null;
      approvalReason?: string;
    };

    if (body.type && !isTransactionType(body.type)) {
      return reply.status(400).send({ message: 'Invalid type value.' });
    }
    if (body.eventType && !isTransactionEventType(body.eventType)) {
      return reply.status(400).send({ message: 'Invalid eventType value.' });
    }
    if (body.status && !isTransactionStatus(body.status)) {
      return reply.status(400).send({ message: 'Invalid status value.' });
    }
    if (body.amount !== undefined && (typeof body.amount !== 'number' || body.amount <= 0)) {
      return reply.status(400).send({ message: 'amount must be a positive number.' });
    }

    const parsedDate = parseOptionalDate(body.date);
    if (body.date && !parsedDate) {
      return reply.status(400).send({ message: 'Invalid date value.' });
    }

    const existing = await db.transaction.findUnique({ where: { id } });
    if (!existing || existing.businessId !== auth.businessId || existing.isDeleted) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    const proposedPatch: Record<string, unknown> = {
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(parsedDate ? { date: parsedDate.toISOString() } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.correctionReason !== undefined ? { correctionReason: body.correctionReason } : {})
    };

    if (Object.keys(proposedPatch).length === 0) {
      return existing;
    }

    const historical = isHistorical(existing.date);
    if (historical) {
      const canHistoricalEdit = await requirePermission(request, reply, 'transaction:edit_historical');
      if (!canHistoricalEdit) return;

      const approval = await db.transactionApproval.create({
        data: {
          transactionId: existing.id,
          requestedByUserId: auth.userId,
          status: 'pending',
          reason: serializePatch(proposedPatch)
        }
      });

      await db.transaction.update({
        where: { id: existing.id },
        data: { approvalStatus: 'pending' }
      });

      await writeAuditLog({
        businessId: auth.businessId,
        entityType: 'transaction',
        entityId: existing.id,
        action: 'historical_edit_requested',
        performedByUserId: auth.userId,
        newValue: proposedPatch as unknown as Record<string, unknown>
      });

      return reply.status(202).send({
        message: 'Historical change submitted for approval.',
        approvalId: approval.id,
        approvalStatus: approval.status
      });
    }

    const nextStatus = body.status ?? existing.status;
    const updated = await db.transaction.update({
      where: { id },
      data: {
        type: body.type ?? existing.type,
        eventType: body.eventType ?? existing.eventType,
        status: nextStatus,
        amount: body.amount ?? existing.amount,
        date: parsedDate ?? existing.date,
        category: body.category === undefined ? existing.category : body.category,
        notes: body.notes === undefined ? existing.notes : body.notes,
        correctionReason: body.correctionReason === undefined ? existing.correctionReason : body.correctionReason,
        confirmedAt: nextStatus === 'confirmed' ? existing.confirmedAt ?? new Date() : null,
        approvalStatus: 'not_required'
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'transaction',
      entityId: updated.id,
      action: 'transaction_updated',
      performedByUserId: auth.userId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>
    });

    return updated;
  });

  fastify.delete('/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:delete_same_day');
    if (!auth) return;

    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string } | undefined;

    const existing = await db.transaction.findUnique({ where: { id } });
    if (!existing || existing.businessId !== auth.businessId || existing.isDeleted) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    if (isHistorical(existing.date)) {
      const canHistoricalDelete = await requirePermission(request, reply, 'transaction:delete_historical');
      if (!canHistoricalDelete) return;

      const approval = await db.transactionApproval.create({
        data: {
          transactionId: existing.id,
          requestedByUserId: auth.userId,
          status: 'pending',
          reason: `DELETE_REQUEST:${(body?.reason ?? '').trim()}`
        }
      });

      await db.transaction.update({
        where: { id: existing.id },
        data: { approvalStatus: 'pending' }
      });

      await writeAuditLog({
        businessId: auth.businessId,
        entityType: 'transaction',
        entityId: existing.id,
        action: 'historical_delete_requested',
        performedByUserId: auth.userId,
        newValue: { reason: body?.reason ?? null }
      });

      return reply.status(202).send({
        message: 'Historical delete submitted for approval.',
        approvalId: approval.id,
        approvalStatus: approval.status
      });
    }

    const deleted = await db.transaction.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        approvalStatus: 'not_required'
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'transaction',
      entityId: existing.id,
      action: 'transaction_deleted',
      performedByUserId: auth.userId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: deleted as unknown as Record<string, unknown>
    });

    return { success: true, id: deleted.id };
  });

  fastify.patch('/:id/confirm', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:edit_same_day');
    if (!auth) return;

    const { id } = request.params as { id: string };
    const existing = await db.transaction.findUnique({ where: { id } });

    if (!existing || existing.businessId !== auth.businessId) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    if (existing.status === 'confirmed') {
      return existing;
    }

    const confirmed = await db.transaction.update({
      where: { id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        approvalStatus: 'not_required'
      }
    });

    return confirmed;
  });

  fastify.post('/:id/corrections', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'transaction:create');
    if (!auth) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      type?: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      amount?: number;
      date?: string;
      category?: string | null;
      notes?: string | null;
      correctionReason?: string | null;
    };

    const original = await db.transaction.findUnique({ where: { id } });
    if (!original || original.businessId !== auth.businessId || original.isDeleted) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    const parsedDate = parseOptionalDate(body.date);
    if (body.date && !parsedDate) {
      return reply.status(400).send({ message: 'Invalid date value.' });
    }

    const correction = await db.transaction.create({
      data: {
        businessId: auth.businessId,
        userId: original.userId,
        createdByUserId: auth.userId,
        sourceChannel: 'app',
        type: body.type ?? original.type,
        eventType: body.eventType ?? original.eventType,
        status: body.status ?? 'confirmed',
        amount: body.amount ?? original.amount,
        date: parsedDate ?? original.date,
        category: body.category === undefined ? original.category : body.category,
        notes: body.notes === undefined ? original.notes : body.notes,
        correctionReason: body.correctionReason ?? 'Correction entry',
        correctionOfId: original.id,
        approvalStatus: 'not_required',
        confirmedAt: body.status === 'draft' ? null : new Date()
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'transaction',
      entityId: correction.id,
      action: 'transaction_corrected',
      performedByUserId: auth.userId,
      oldValue: original as unknown as Record<string, unknown>,
      newValue: correction as unknown as Record<string, unknown>
    });

    reply.status(201);
    return correction;
  });

  fastify.get('/approvals/pending', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'approval:review');
    if (!auth) return;

    const approvals = await db.transactionApproval.findMany({
      where: {
        status: 'pending',
        transaction: {
          businessId: auth.businessId
        }
      },
      include: {
        transaction: true,
        requestedByUser: {
          select: { id: true, name: true, fullName: true }
        }
      },
      orderBy: { requestedAt: 'asc' }
    });

    return approvals;
  });

  fastify.post('/approvals/:approvalId/review', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'approval:review');
    if (!auth) return;

    const { approvalId } = request.params as { approvalId: string };
    const body = request.body as {
      action?: 'approve' | 'reject';
      note?: string;
    };

    if (!body.action || (body.action !== 'approve' && body.action !== 'reject')) {
      return reply.status(400).send({ message: 'action must be approve or reject.' });
    }

    const approval = await db.transactionApproval.findUnique({
      where: { id: approvalId },
      include: { transaction: true }
    });

    if (!approval || approval.transaction.businessId !== auth.businessId) {
      return reply.status(404).send({ message: 'Approval request not found.' });
    }

    if (approval.status !== 'pending') {
      return reply.status(409).send({ message: 'Approval request already reviewed.' });
    }

    let updatedTransaction = approval.transaction;

    if (body.action === 'approve') {
      const patch = parsePatchFromReason(approval.reason);
      if (patch) {
        const patchDate = typeof patch.date === 'string' ? parseOptionalDate(patch.date) : null;
        updatedTransaction = await db.transaction.update({
          where: { id: approval.transactionId },
          data: {
            type: (patch.type as TransactionTypeInput) ?? approval.transaction.type,
            eventType: (patch.eventType as TransactionEventTypeInput) ?? approval.transaction.eventType,
            status: (patch.status as TransactionStatusInput) ?? approval.transaction.status,
            amount: typeof patch.amount === 'number' ? patch.amount : approval.transaction.amount,
            date: patchDate ?? approval.transaction.date,
            category: patch.category !== undefined ? (patch.category as string | null) : approval.transaction.category,
            notes: patch.notes !== undefined ? (patch.notes as string | null) : approval.transaction.notes,
            correctionReason: patch.correctionReason !== undefined
              ? (patch.correctionReason as string | null)
              : approval.transaction.correctionReason,
            approvalStatus: 'approved',
            approvedByUserId: auth.userId
          }
        });
      } else if (approval.reason?.startsWith('DELETE_REQUEST:')) {
        updatedTransaction = await db.transaction.update({
          where: { id: approval.transactionId },
          data: {
            isDeleted: true,
            approvalStatus: 'approved',
            approvedByUserId: auth.userId
          }
        });
      } else {
        updatedTransaction = await db.transaction.update({
          where: { id: approval.transactionId },
          data: {
            approvalStatus: 'approved',
            approvedByUserId: auth.userId
          }
        });
      }
    } else {
      updatedTransaction = await db.transaction.update({
        where: { id: approval.transactionId },
        data: {
          approvalStatus: 'rejected'
        }
      });
    }

    const reviewed = await db.transactionApproval.update({
      where: { id: approval.id },
      data: {
        status: body.action === 'approve' ? 'approved' : 'rejected',
        reviewedByUserId: auth.userId,
        reviewedAt: new Date(),
        reviewNote: body.note ?? null
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'transaction_approval',
      entityId: reviewed.id,
      action: body.action === 'approve' ? 'approval_approved' : 'approval_rejected',
      performedByUserId: auth.userId,
      oldValue: approval as unknown as Record<string, unknown>,
      newValue: reviewed as unknown as Record<string, unknown>
    });

    return {
      approval: reviewed,
      transaction: updatedTransaction
    };
  });
};

export default plugin;
