import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';

const transactionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      userId: string;
      type: 'revenue' | 'expense';
      amount: number;
      date?: string;
      category?: string;
      notes?: string;
    };

    if (!body.userId || !body.type || typeof body.amount !== 'number' || body.amount <= 0) {
      return reply.status(400).send({ message: 'A valid userId, type, and positive amount are required.' });
    }

    const transaction = await db.transaction.create({
      data: {
        userId: body.userId,
        type: body.type,
        amount: body.amount,
        date: body.date ? new Date(body.date) : new Date(),
        category: body.category ?? null,
        notes: body.notes ?? null
      }
    });

    reply.status(201);
    return transaction;
  });

  fastify.get('/', async (request, reply) => {
    const query = request.query as {
      userId?: string;
      type?: 'revenue' | 'expense';
      start?: string;
      end?: string;
    };

    if (!query.userId) {
      return reply.status(400).send({ message: 'userId query parameter is required.' });
    }

    const where: Record<string, any> = { userId: query.userId };

    if (query.type) {
      where.type = query.type;
    }

    if (query.start || query.end) {
      where.date = {};
      if (query.start) {
        where.date.gte = new Date(query.start);
      }
      if (query.end) {
        where.date.lte = new Date(query.end);
      }
    }

    const transactions = await db.transaction.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    return transactions;
  });
};

export default transactionRoutes;
