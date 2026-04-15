import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import { parseWhatsAppEntry } from '../services/parsing.js';
import { computeSummary } from '../services/summaries.js';
import { getBudgetsForPeriod, computeBudgetStatus } from '../services/budgets.js';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      userId?: string;
      message?: string;
    };

    if (!body.userId || !body.message) {
      return reply.status(400).send({ message: 'userId and message are required.' });
    }

    const parsed = parseWhatsAppEntry(body.message);

    if (parsed.length === 0) {
      return reply.status(400).send({ message: 'Could not parse a revenue or expense entry from the provided message.' });
    }

    const created = await Promise.all(
      parsed.map((transaction) =>
        db.transaction.create({
          data: {
            userId: body.userId as string,
            type: transaction.type,
            amount: transaction.amount,
            date: transaction.date ?? new Date(),
            category: transaction.category ?? (transaction.type === 'expense' ? 'Expense' : 'Revenue'),
            notes: transaction.notes ?? null
          }
        })
      )
    );

    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

    const monthlyTransactions = await db.transaction.findMany({
      where: {
        userId: body.userId as string,
        date: {
          gte: periodStart,
          lte: periodEnd
        }
      }
    });

    const budgets = await getBudgetsForPeriod(body.userId as string, 'monthly', periodStart);
    const budgetStatuses = budgets.map((budget) => computeBudgetStatus(budget, monthlyTransactions));

    return {
      transactions: created,
      summary: computeSummary(created),
      monthlySummary: computeSummary(monthlyTransactions),
      budgetStatuses
    };
  });
};

export default chatRoutes;
