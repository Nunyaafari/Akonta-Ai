import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';

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

const transactionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      userId: string;
      type: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      amount: number;
      date?: string;
      category?: string;
      notes?: string;
      correctionReason?: string;
    };

    if (!body.userId || !isTransactionType(body.type) || typeof body.amount !== 'number' || body.amount <= 0) {
      return reply.status(400).send({ message: 'A valid userId, type, and positive amount are required.' });
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
        userId: body.userId,
        type: body.type,
        eventType: body.eventType ?? 'other',
        status,
        amount: body.amount,
        date: parsedDate ?? new Date(),
        category: body.category ?? null,
        notes: body.notes ?? null,
        correctionReason: body.correctionReason ?? null,
        confirmedAt: status === 'confirmed' ? new Date() : null
      }
    });

    reply.status(201);
    return transaction;
  });

  fastify.get('/', async (request, reply) => {
    const query = request.query as {
      userId?: string;
      type?: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      start?: string;
      end?: string;
      includeCorrections?: string;
    };

    if (!query.userId) {
      return reply.status(400).send({ message: 'userId query parameter is required.' });
    }

    if (query.type && !isTransactionType(query.type)) {
      return reply.status(400).send({ message: 'Invalid type query parameter.' });
    }

    if (query.eventType && !isTransactionEventType(query.eventType)) {
      return reply.status(400).send({ message: 'Invalid eventType query parameter.' });
    }

    if (query.status && !isTransactionStatus(query.status)) {
      return reply.status(400).send({ message: 'Invalid status query parameter.' });
    }

    const where: Record<string, any> = { userId: query.userId };

    if (query.type) {
      where.type = query.type;
    }

    if (query.eventType) {
      where.eventType = query.eventType;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.includeCorrections !== 'true') {
      where.correctionOfId = null;
    }

    if (query.start || query.end) {
      where.date = {};
      if (query.start) {
        const parsed = parseOptionalDate(query.start);
        if (!parsed) {
          return reply.status(400).send({ message: 'Invalid start date value.' });
        }
        where.date.gte = parsed;
      }
      if (query.end) {
        const parsed = parseOptionalDate(query.end);
        if (!parsed) {
          return reply.status(400).send({ message: 'Invalid end date value.' });
        }
        where.date.lte = parsed;
      }
    }

    const transactions = await db.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
    });

    return transactions;
  });

  fastify.patch('/:id', async (request, reply) => {
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
    if (!existing) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    const hasCoreChange =
      body.type !== undefined ||
      body.eventType !== undefined ||
      body.amount !== undefined ||
      body.date !== undefined ||
      body.category !== undefined ||
      body.notes !== undefined;

    if (existing.status === 'confirmed' && hasCoreChange) {
      return reply
        .status(409)
        .send({ message: 'Confirmed transactions must be corrected with POST /api/transactions/:id/corrections.' });
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
        confirmedAt: nextStatus === 'confirmed' ? existing.confirmedAt ?? new Date() : null
      }
    });

    return updated;
  });

  fastify.patch('/:id/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.transaction.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    if (existing.status === 'confirmed') {
      return existing;
    }

    const confirmed = await db.transaction.update({
      where: { id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date()
      }
    });

    return confirmed;
  });

  fastify.post('/:id/corrections', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      type?: TransactionTypeInput;
      eventType?: TransactionEventTypeInput;
      status?: TransactionStatusInput;
      amount?: number;
      date?: string;
      category?: string | null;
      notes?: string | null;
      correctionReason?: string;
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

    const original = await db.transaction.findUnique({ where: { id } });
    if (!original) {
      return reply.status(404).send({ message: 'Transaction not found.' });
    }

    const correctionStatus = body.status ?? 'confirmed';
    const correctionReason = body.correctionReason ?? 'Corrected transaction entry';

    const correction = await db.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: original.userId,
          type: body.type ?? original.type,
          eventType: body.eventType ?? original.eventType,
          status: correctionStatus,
          amount: body.amount ?? original.amount,
          date: parsedDate ?? original.date,
          category: body.category === undefined ? original.category : body.category,
          notes: body.notes === undefined ? original.notes : body.notes,
          correctionReason,
          correctionOfId: original.id,
          confirmedAt: correctionStatus === 'confirmed' ? new Date() : null
        }
      });

      if (original.status === 'confirmed') {
        await tx.transaction.update({
          where: { id: original.id },
          data: {
            status: 'draft',
            confirmedAt: null,
            correctionReason: `Superseded by correction ${created.id}`
          }
        });
      }

      return created;
    });

    reply.status(201);
    return {
      originalTransactionId: original.id,
      correction
    };
  });
};

export default transactionRoutes;
