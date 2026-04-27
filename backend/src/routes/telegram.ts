import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import db from '../lib/db.js';
import { config } from '../lib/env.js';
import { processConversationMessage } from '../services/conversation.js';
import { normalizePhoneDigits } from '../services/whatsappWebhook.js';

interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: {
      id?: number;
      type?: string;
    };
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    contact?: {
      phone_number?: string;
    };
  };
}

const telegramRoutes: FastifyPluginAsync = async (fastify) => {
  const resolveWebhookSecretFromHeader = (header: unknown): string | null => {
    if (typeof header !== 'string') return null;
    const trimmed = header.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const buildPhoneCandidates = (input: string): string[] => {
    const digits = normalizePhoneDigits(input);
    const candidates = new Set<string>();
    const canonical = input.trim();

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

  const sendTelegramMessage = async (chatId: string, message: string) => {
    if (!config.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
    }

    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => 'unknown error');
      throw new Error(`Telegram sendMessage failed with ${response.status}: ${payload}`);
    }

    return response.json().catch(() => ({}));
  };

  const reserveWebhookEvent = async (eventId: string, payload: unknown): Promise<{ duplicate: boolean; id?: string }> => {
    try {
      const created = await db.processedWebhookEvent.create({
        data: {
          provider: 'generic',
          eventId,
          payload: payload as Prisma.InputJsonValue
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

  const resolveBusinessIdForUser = async (userId: string): Promise<string | undefined> => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { activeBusinessId: true }
    });

    if (user?.activeBusinessId) return user.activeBusinessId;

    const membership = await db.businessMembership.findFirst({
      where: {
        userId,
        membershipStatus: 'active'
      },
      select: { businessId: true },
      orderBy: { createdAt: 'asc' }
    });

    return membership?.businessId;
  };

  const updateWebhookEvent = async (id: string | undefined, params: {
    userId?: string | null;
    businessId?: string | null;
    payload: unknown;
  }) => {
    if (!id) return;
    await db.processedWebhookEvent.update({
      where: { id },
      data: {
        userId: params.userId ?? null,
        businessId: params.businessId ?? null,
        payload: params.payload as Prisma.InputJsonValue
      }
    });
  };

  fastify.post('/webhook', async (request, reply) => {
    const secretHeader = resolveWebhookSecretFromHeader(request.headers['x-telegram-bot-api-secret-token']);

    if (config.TELEGRAM_WEBHOOK_SECRET && secretHeader !== config.TELEGRAM_WEBHOOK_SECRET) {
      return reply.status(401).send({ message: 'Invalid Telegram webhook secret.' });
    }

    const update = (request.body ?? {}) as TelegramWebhookUpdate;
    const message = update.message;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id ? String(message.chat.id) : null;

    const eventId = update.update_id !== undefined
      ? `telegram:${update.update_id}`
      : `telegram:${crypto.createHash('sha256').update(JSON.stringify(update)).digest('hex')}`;

    const reservation = await reserveWebhookEvent(eventId, update);

    if (reservation.duplicate) {
      return { success: true, duplicate: true, eventId };
    }

    if (!chatId || !text) {
      await updateWebhookEvent(reservation.id, { payload: update });
      return {
        success: true,
        skipped: true,
        eventId,
        reason: 'No text chat payload found in Telegram update.'
      };
    }

    const linkMatch = text.match(/^\/link(?:@\w+)?\s+(.+)$/i);
    if (linkMatch) {
      const provided = linkMatch[1].trim();
      const candidates = buildPhoneCandidates(provided);
      const matchedUser = candidates.length
        ? await db.user.findFirst({
          where: {
            OR: candidates.flatMap((candidate) => ([
              { phoneNumber: candidate },
              { whatsappNumber: candidate }
            ]))
          },
          select: {
            id: true,
            businessName: true,
            activeBusinessId: true
          }
        })
        : null;

      if (!matchedUser) {
        await sendTelegramMessage(chatId, 'I could not find that phone number. Send /link followed by the number you use on Akonta AI.');
        await updateWebhookEvent(reservation.id, { payload: update });
        return { success: true, linked: false, eventId };
      }

      const businessId = matchedUser.activeBusinessId ?? await resolveBusinessIdForUser(matchedUser.id) ?? null;

      try {
        await db.user.update({
          where: { id: matchedUser.id },
          data: {
            telegramChatId: chatId,
            telegramUsername: message?.from?.username ?? null
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          await sendTelegramMessage(chatId, 'This Telegram account is already linked to another user. Please contact support to reassign it.');
          await updateWebhookEvent(reservation.id, { payload: update });
          return { success: true, linked: false, eventId };
        }
        throw error;
      }

      const businessLabel = matchedUser.businessName ? ` (${matchedUser.businessName})` : '';
      await sendTelegramMessage(chatId, `Linked successfully${businessLabel}. You can now chat your inflow and expenses here.`);
      await updateWebhookEvent(reservation.id, {
        userId: matchedUser.id,
        businessId,
        payload: update
      });

      return {
        success: true,
        linked: true,
        eventId,
        userId: matchedUser.id,
        businessId
      };
    }

    const linkedUser = await db.user.findFirst({
      where: { telegramChatId: chatId },
      select: {
        id: true,
        activeBusinessId: true
      }
    });

    if (!linkedUser) {
      await sendTelegramMessage(chatId, 'To connect this Telegram account, send: /link +233XXXXXXXXX (or your registered Akonta phone).');
      await updateWebhookEvent(reservation.id, { payload: update });
      return {
        success: true,
        linked: false,
        eventId,
        reason: 'Telegram chat is not linked yet.'
      };
    }

    const businessId = linkedUser.activeBusinessId ?? await resolveBusinessIdForUser(linkedUser.id);
    const result = await processConversationMessage({
      userId: linkedUser.id,
      businessId,
      message: text,
      channel: 'telegram'
    });

    await sendTelegramMessage(chatId, result.botReply);
    await updateWebhookEvent(reservation.id, {
      userId: linkedUser.id,
      businessId: businessId ?? null,
      payload: update
    });

    return {
      success: true,
      eventId,
      userId: linkedUser.id,
      businessId,
      botReply: result.botReply,
      conversation: result.conversation
    };
  });

  fastify.post('/send', async (request, reply) => {
    const body = request.body as {
      chatId?: string;
      message?: string;
    };

    if (!body.chatId || !body.message) {
      return reply.status(400).send({ message: 'chatId and message are required.' });
    }

    try {
      const result = await sendTelegramMessage(body.chatId, body.message);
      return { success: true, result };
    } catch (error) {
      return reply.status(500).send({ message: (error as Error).message });
    }
  });

  fastify.get('/status', async () => ({
    enabled: Boolean(config.TELEGRAM_BOT_TOKEN),
    webhookSecretConfigured: Boolean(config.TELEGRAM_WEBHOOK_SECRET)
  }));
};

export default telegramRoutes;
