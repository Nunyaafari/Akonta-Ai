import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { isPaidSubscriptionStatus } from '../lib/subscriptionAccess.js';
import { processConversationMessage } from '../services/conversation.js';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'chat:use');
    if (!auth) return;

    const body = request.body as {
      message?: string;
      channel?: 'web' | 'whatsapp' | 'telegram';
    };

    if (!body.message) {
      return reply.status(400).send({ message: 'message is required.' });
    }

    if (body.channel && body.channel !== 'web' && body.channel !== 'whatsapp' && body.channel !== 'telegram') {
      return reply.status(400).send({ message: 'channel must be web, whatsapp, or telegram.' });
    }

    if (body.channel === 'whatsapp') {
      const business = await db.business.findUnique({
        where: { id: auth.businessId },
        select: { subscriptionStatus: true }
      });
      if (!isPaidSubscriptionStatus(business?.subscriptionStatus)) {
        return reply.status(403).send({
          message: 'WhatsApp channel is available on paid plans only (Basic or Premium).'
        });
      }
    }

    return processConversationMessage({
      userId: auth.userId,
      businessId: auth.businessId,
      message: body.message,
      channel: body.channel ?? 'web'
    });
  });
};

export default chatRoutes;
