import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import db from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { computeSummary } from '../services/summaries.js';

const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/weekly', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'summary:view');
    if (!auth) return;

    const query = request.query as {
      start?: string;
      end?: string;
    };

    if (!query.start || !query.end) {
      return reply.status(400).send({ message: 'start and end query parameters are required.' });
    }

    const periodStart = new Date(query.start);
    const periodEnd = new Date(query.end);

    const transactions = await db.transaction.findMany({
      where: {
        businessId: auth.businessId,
        status: 'confirmed',
        correctionOfId: null,
        isDeleted: false,
        date: {
          gte: periodStart,
          lte: periodEnd
        }
      },
      orderBy: { date: 'desc' }
    });

    return {
      periodType: 'weekly',
      periodStart,
      periodEnd,
      summary: computeSummary(transactions)
    };
  });

  fastify.get('/monthly', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'summary:view');
    if (!auth) return;

    const query = request.query as {
      year?: string;
      month?: string;
    };

    if (!query.year || !query.month) {
      return reply.status(400).send({ message: 'year and month query parameters are required.' });
    }

    const year = Number(query.year);
    const month = Number(query.month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return reply.status(400).send({ message: 'year must be an integer and month must be between 1 and 12.' });
    }

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 1));
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

    const transactions = await db.transaction.findMany({
      where: {
        businessId: auth.businessId,
        status: 'confirmed',
        correctionOfId: null,
        isDeleted: false,
        date: {
          gte: periodStart,
          lte: periodEnd
        }
      },
      orderBy: { date: 'desc' }
    });

    return {
      periodType: 'monthly',
      periodStart,
      periodEnd,
      summary: computeSummary(transactions)
    };
  });

  fastify.get('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'summary:view');
    if (!auth) return;

    const query = request.query as {
      periodType?: 'weekly' | 'monthly';
      year?: string;
      month?: string;
    };

    const where: Record<string, any> = {
      businessId: auth.businessId
    };

    if (query.periodType) {
      where.periodType = query.periodType;
    }

    if (query.year && query.month) {
      const year = Number(query.year);
      const month = Number(query.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return reply.status(400).send({ message: 'year must be an integer and month must be between 1 and 12.' });
      }
      where.periodStart = new Date(Date.UTC(year, month - 1, 1));
    }

    const summaries = await db.summary.findMany({
      where,
      orderBy: { periodStart: 'desc' }
    });

    return summaries;
  });

  fastify.get('/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'summary:view');
    if (!auth) return;

    const params = request.params as { id: string };
    const summary = await db.summary.findUnique({
      where: { id: params.id }
    });

    if (!summary || summary.businessId !== auth.businessId) {
      return reply.status(404).send({ message: 'Summary not found.' });
    }

    return summary;
  });

  fastify.post('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'summary:view');
    if (!auth) return;

    const body = request.body as {
      periodType?: 'weekly' | 'monthly';
      periodStart?: string;
      periodEnd?: string;
    };

    if (!body.periodType || !body.periodStart || !body.periodEnd) {
      return reply.status(400).send({ message: 'periodType, periodStart, and periodEnd are required.' });
    }

    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    const transactions = await db.transaction.findMany({
      where: {
        businessId: auth.businessId,
        status: 'confirmed',
        correctionOfId: null,
        isDeleted: false,
        date: {
          gte: periodStart,
          lte: periodEnd
        }
      }
    });

    const summary = computeSummary(transactions);
    const saved = await db.summary.create({
      data: {
        businessId: auth.businessId,
        userId: auth.userId,
        periodType: body.periodType,
        periodStart,
        periodEnd,
        totalRevenue: summary.totalRevenue,
        totalExpenses: summary.totalExpenses,
        profit: summary.profit,
        transactionCount: summary.transactionCount,
        details: summary as unknown as Prisma.InputJsonValue
      }
    });

    reply.status(201);
    return saved;
  });
};

export default summaryRoutes;
