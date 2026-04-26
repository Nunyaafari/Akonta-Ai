import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import db from '../lib/db.js';
import { processConversationMessage } from '../services/conversation.js';
import { availableProviders, getConfiguredProvider, resolveProvider, sendWhatsAppMessage } from '../services/whatsapp.js';
import {
  normalizePhoneDigits,
  parseInfobipWebhook,
  parseTwilioWebhook,
  validateInfobipSignature,
  validateTwilioSignature
} from '../services/whatsappWebhook.js';

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  const reserveWebhookEvent = async (params: {
    provider: 'twilio' | 'infobip' | 'generic';
    eventId: string;
    payload: unknown;
  }): Promise<{ duplicate: boolean; id?: string }> => {
    try {
      const created = await db.processedWebhookEvent.create({
        data: {
          provider: params.provider,
          eventId: params.eventId,
          payload: params.payload as Prisma.InputJsonValue
        }
      });
      return { duplicate: false, id: created.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { duplicate: true };
      }
      throw error;
    }
  };

  const releaseWebhookReservation = async (id?: string) => {
    if (!id) return;
    await db.processedWebhookEvent.delete({ where: { id } }).catch(() => undefined);
  };

  const buildPhoneCandidates = (input: string): string[] => {
    const digits = normalizePhoneDigits(input);
    const candidates = new Set<string>();
    const canonical = input.replace(/^whatsapp:/i, '').trim();

    if (canonical) candidates.add(canonical);
    if (digits) {
      candidates.add(digits);
      candidates.add(`+${digits}`);

      if (digits.length === 9) {
        candidates.add(`233${digits}`);
        candidates.add(`+233${digits}`);
      }

      if (digits.length === 10 && digits.startsWith('0')) {
        const normalized = `233${digits.slice(1)}`;
        candidates.add(normalized);
        candidates.add(`+${normalized}`);
      }

      if (digits.length === 12 && digits.startsWith('233')) {
        candidates.add(`0${digits.slice(3)}`);
      }
    }

    return Array.from(candidates);
  };

  const findOwnerBusinessByPhone = async (phone: string) => {
    const candidates = buildPhoneCandidates(phone);
    if (candidates.length > 0) {
      const business = await db.business.findFirst({
        where: {
          OR: candidates.flatMap((candidate) => ([
            { primaryWhatsappUser: { phoneNumber: candidate } },
            { primaryWhatsappUser: { whatsappNumber: candidate } }
          ]))
        },
        include: { primaryWhatsappUser: true }
      });
      if (business) return business;
    }

    const digits = normalizePhoneDigits(phone);
    if (digits.length >= 8) {
      const fallbackBusiness = await db.business.findFirst({
        where: {
          OR: [
            { primaryWhatsappUser: { phoneNumber: { endsWith: digits } } },
            { primaryWhatsappUser: { phoneNumber: { endsWith: digits.slice(-9) } } },
            { primaryWhatsappUser: { whatsappNumber: { endsWith: digits } } },
            { primaryWhatsappUser: { whatsappNumber: { endsWith: digits.slice(-9) } } }
          ]
        },
        include: { primaryWhatsappUser: true }
      });
      if (fallbackBusiness) return fallbackBusiness;
    }

    return null;
  };

  const processProviderWebhook = async (params: {
    provider: 'twilio' | 'infobip';
    eventId: string;
    from: string;
    message: string;
    payload: unknown;
  }) => {
    const reservation = await reserveWebhookEvent({
      provider: params.provider,
      eventId: params.eventId,
      payload: params.payload
    });

    if (reservation.duplicate) {
      return {
        success: true,
        duplicate: true,
        provider: params.provider,
        eventId: params.eventId
      };
    }

    const business = await findOwnerBusinessByPhone(params.from);
    if (!business) {
      await db.processedWebhookEvent.update({
        where: { id: reservation.id },
        data: { payload: params.payload as Prisma.InputJsonValue }
      });
      return {
        success: true,
        skipped: true,
        reason: 'No owner workspace mapped to sender phone number.',
        provider: params.provider,
        eventId: params.eventId
      };
    }

    try {
      const result = await processConversationMessage({
        userId: business.primaryWhatsappUserId,
        businessId: business.id,
        message: params.message,
        channel: 'whatsapp'
      });

      await db.processedWebhookEvent.update({
        where: { id: reservation.id },
        data: {
          userId: business.primaryWhatsappUserId,
          businessId: business.id,
          payload: params.payload as Prisma.InputJsonValue
        }
      });

      return {
        success: true,
        duplicate: false,
        provider: params.provider,
        eventId: params.eventId,
        userId: business.primaryWhatsappUserId,
        businessId: business.id,
        botReply: result.botReply,
        conversation: result.conversation,
        transactions: result.transactions
      };
    } catch (error) {
      await releaseWebhookReservation(reservation.id);
      throw error;
    }
  };

  fastify.post('/webhook/twilio', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const signature = typeof request.headers['x-twilio-signature'] === 'string'
      ? request.headers['x-twilio-signature']
      : null;

    if (!validateTwilioSignature({ request, body, providedSignature: signature })) {
      return reply.status(401).send({ message: 'Invalid Twilio signature.' });
    }

    const parsed = parseTwilioWebhook(body);
    if (!parsed) {
      return reply.status(400).send({ message: 'Unable to parse Twilio webhook payload.' });
    }

    return processProviderWebhook(parsed);
  });

  fastify.post('/webhook/infobip', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const authorizationHeader = typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : null;

    if (!validateInfobipSignature({ authorizationHeader })) {
      return reply.status(401).send({ message: 'Invalid Infobip webhook authorization.' });
    }

    const parsed = parseInfobipWebhook(body);
    if (!parsed) {
      return reply.status(400).send({ message: 'Unable to parse Infobip webhook payload.' });
    }

    return processProviderWebhook(parsed);
  });

  fastify.post('/webhook', async (request, reply) => {
    const body = request.body as {
      userId?: string;
      message?: string;
      eventId?: string;
      provider?: 'generic' | 'twilio' | 'infobip';
    };

    if (!body.userId || !body.message) {
      return reply.status(400).send({ message: 'userId and message are required.' });
    }

    const eventId = body.eventId
      ?? crypto.createHash('sha256').update(`${body.userId}:${body.message}`).digest('hex');
    const provider = body.provider ?? 'generic';
    const reservation = await reserveWebhookEvent({
      provider,
      eventId,
      payload: body
    });

    if (reservation.duplicate) {
      return {
        success: true,
        duplicate: true,
        provider,
        eventId
      };
    }

    try {
      const result = await processConversationMessage({
        userId: body.userId,
        message: body.message,
        channel: 'whatsapp'
      });

      await db.processedWebhookEvent.update({
        where: { id: reservation.id },
        data: {
          userId: body.userId,
          payload: body as Prisma.InputJsonValue
        }
      });

      return {
        success: true,
        duplicate: false,
        provider,
        eventId,
        ...result
      };
    } catch (error) {
      await releaseWebhookReservation(reservation.id);
      throw error;
    }
  });

  fastify.get('/webhook/events', async (request, reply) => {
    const query = request.query as {
      provider?: 'twilio' | 'infobip' | 'generic';
      limit?: string;
    };

    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    if (Number.isNaN(limit)) {
      return reply.status(400).send({ message: 'limit must be a number.' });
    }

    const where = query.provider ? { provider: query.provider } : undefined;
    return db.processedWebhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });
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
      const selectedProvider = body.provider ? resolveProvider(body.provider) : await getConfiguredProvider();
      const result = await sendWhatsAppMessage(body.to, body.message, selectedProvider);
      return { success: true, provider: selectedProvider, result };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ message: (error as Error).message });
    }
  });

  fastify.get('/providers', async () => {
    const configured = await getConfiguredProvider();
    return {
      default: configured,
      available: availableProviders
    };
  });
};

export default whatsappRoutes;
