import type { FastifyPluginAsync } from 'fastify';
import { processConversationMessage } from '../services/conversation.js';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      userId?: string;
      message?: string;
      channel?: 'web' | 'whatsapp';
    };

    if (!body.userId || !body.message) {
      return reply.status(400).send({ message: 'userId and message are required.' });
    }

    if (body.channel && body.channel !== 'web' && body.channel !== 'whatsapp') {
      return reply.status(400).send({ message: 'channel must be either web or whatsapp.' });
    }

    return processConversationMessage({
      userId: body.userId,
      message: body.message,
      channel: body.channel ?? 'web'
    });
  });
};

export default chatRoutes;
