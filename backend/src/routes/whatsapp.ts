import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import { parseWhatsAppEntry } from '../services/parsing.js';
import { availableProviders, resolveProvider, sendWhatsAppMessage } from '../services/whatsapp.js';

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/webhook', async (request, reply) => {
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

    return created;
  });

  fastify.post('/send', async (request, reply) => {
    const body = request.body as {
      to?: string;
      message?: string;
      provider?: string;
    };

    if (!body.to || !body.message) {
      return reply.status(400).send({ message: 'to and message are required.' });
    }

    try {
      const result = await sendWhatsAppMessage(body.to, body.message, body.provider);
      return { success: true, provider: resolveProvider(body.provider), result };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ message: (error as Error).message });
    }
  });

  fastify.get('/providers', async () => ({
    default: resolveProvider(),
    available: availableProviders
  }));
};

export default whatsappRoutes;
