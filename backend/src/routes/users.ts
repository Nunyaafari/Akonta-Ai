import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import db from '../lib/db.js';

const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      name: string;
      phoneNumber: string;
      businessName?: string;
      businessType?: string;
      preferredTime?: string;
      timezone?: string;
      subscriptionStatus?: 'free' | 'premium' | 'trial';
    };

    if (!body.name || !body.phoneNumber) {
      return reply.status(400).send({ message: 'Name and phone number are required.' });
    }

    try {
      const user = await db.user.create({
        data: {
          name: body.name,
          phoneNumber: body.phoneNumber,
          businessName: body.businessName ?? null,
          businessType: body.businessType ?? null,
          preferredTime: body.preferredTime ?? null,
          timezone: body.timezone ?? null,
          subscriptionStatus: body.subscriptionStatus ?? 'free'
        }
      });

      reply.status(201);
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A user with this phone number already exists.' });
      }
      fastify.log.error(error);
      return reply.status(500).send({ message: 'Unable to create user account. Please try again.' });
    }
  });

  fastify.get('/', async () => {
    return db.user.findMany({ orderBy: { createdAt: 'desc' } });
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }
    return user;
  });
};

export default userRoutes;
