import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../lib/auth.js';
import { processConversationMessage } from '../services/conversation.js';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'chat:use');
    if (!auth) return;

    const body = request.body as {
      message?: string;
      channel?: 'web' | 'whatsapp';
    };

    if (!body.message) {
      return reply.status(400).send({ message: 'message is required.' });
    }

    if (body.channel && body.channel !== 'web' && body.channel !== 'whatsapp') {
      return reply.status(400).send({ message: 'channel must be either web or whatsapp.' });
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
