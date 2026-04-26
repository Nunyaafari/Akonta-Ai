import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../lib/auth.js';
import { getMonthlyInsights } from '../services/insights.js';

const parseYearMonth = (yearValue?: string, monthValue?: string) => {
  const year = Number(yearValue);
  const month = Number(monthValue);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

const insightRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/monthly', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'insight:view');
    if (!auth) return;

    const query = request.query as {
      year?: string;
      month?: string;
    };

    if (!query.year || !query.month) {
      return reply.status(400).send({ message: 'year and month query parameters are required.' });
    }

    const yearMonth = parseYearMonth(query.year, query.month);
    if (!yearMonth) {
      return reply.status(400).send({ message: 'year must be an integer and month must be between 1 and 12.' });
    }

    return getMonthlyInsights({
      businessId: auth.businessId,
      userId: auth.userId,
      year: yearMonth.year,
      month: yearMonth.month
    });
  });

  fastify.get('/current', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'insight:view');
    if (!auth) return;

    const now = new Date();
    return getMonthlyInsights({
      businessId: auth.businessId,
      userId: auth.userId,
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      now
    });
  });
};

export default insightRoutes;
