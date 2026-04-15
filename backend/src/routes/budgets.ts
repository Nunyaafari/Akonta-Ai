import type { FastifyPluginAsync } from 'fastify';
import { BudgetTargetType } from '@prisma/client';
import db from '../lib/db.js';
import { upsertBudget, getBudgetsForPeriod } from '../services/budgets.js';

const budgetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const query = request.query as {
      userId?: string;
      year?: string;
      month?: string;
    };

    if (!query.userId) {
      return reply.status(400).send({ message: 'userId query parameter is required.' });
    }

    if (!query.year || !query.month) {
      return reply.status(400).send({ message: 'year and month query parameters are required.' });
    }

    const year = Number(query.year);
    const month = Number(query.month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return reply.status(400).send({ message: 'year must be an integer and month must be between 1 and 12.' });
    }

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const budgets = await getBudgetsForPeriod(query.userId, 'monthly', periodStart);
    return budgets;
  });

  fastify.get('/current', async (request, reply) => {
    const query = request.query as {
      userId?: string;
    };

    if (!query.userId) {
      return reply.status(400).send({ message: 'userId query parameter is required.' });
    }

    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const budgets = await getBudgetsForPeriod(query.userId, 'monthly', periodStart);

    return budgets;
  });

  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      userId?: string;
      year?: number;
      month?: number;
      targetType?: BudgetTargetType;
      amount?: number;
      category?: string;
      notes?: string;
    };

    if (!body.userId || typeof body.year !== 'number' || typeof body.month !== 'number' || !body.targetType || typeof body.amount !== 'number') {
      return reply.status(400).send({ message: 'userId, year, month, targetType, and amount are required.' });
    }

    try {
      const budget = await upsertBudget(
        body.userId,
        body.year,
        body.month,
        body.targetType,
        body.amount,
        body.category,
        body.notes
      );

      reply.status(201);
      return budget;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ message: 'Unable to save budget. Please try again.' });
    }
  });
};

export default budgetRoutes;
