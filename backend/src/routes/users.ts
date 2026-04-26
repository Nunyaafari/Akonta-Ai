import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import db from '../lib/db.js';
import { config } from '../lib/env.js';
import {
  createUniqueReferralCode,
  ensureUserReferralCode,
  normalizeReferralCodeInput,
  qualifyReferralFromSubscription,
  REFERRAL_MILESTONE_SIZE
} from '../services/referrals.js';

const subscriptionStatuses = ['free', 'premium', 'trial'] as const;
const subscriptionSources = ['trial', 'paid', 'referral_bonus', 'admin_adjustment'] as const;
const preferredTimeValues = ['morning', 'afternoon', 'evening'] as const;

type SubscriptionStatusInput = (typeof subscriptionStatuses)[number];
type SubscriptionSourceInput = (typeof subscriptionSources)[number];

const isSubscriptionStatus = (value: unknown): value is SubscriptionStatusInput =>
  typeof value === 'string' && subscriptionStatuses.includes(value as SubscriptionStatusInput);

const isSubscriptionSource = (value: unknown): value is SubscriptionSourceInput =>
  typeof value === 'string' && subscriptionSources.includes(value as SubscriptionSourceInput);

const isPreferredTime = (value: unknown): value is (typeof preferredTimeValues)[number] =>
  typeof value === 'string' && preferredTimeValues.includes(value as (typeof preferredTimeValues)[number]);

const normalizeCurrencyCode = (value?: string): string | null => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
};

const addMonthsUtc = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const resolveAppOrigin = (request: { headers: Record<string, unknown>; protocol?: string }): string => {
  const configured = config.APP_ORIGIN?.trim();
  if (configured && configured !== '*') {
    return configured.replace(/\/$/, '');
  }

  const headerOrigin = request.headers.origin;
  if (typeof headerOrigin === 'string' && headerOrigin.trim().length > 0) {
    return headerOrigin.trim().replace(/\/$/, '');
  }

  const forwardedProto = typeof request.headers['x-forwarded-proto'] === 'string'
    ? request.headers['x-forwarded-proto'].split(',')[0]?.trim()
    : undefined;
  const forwardedHost = typeof request.headers['x-forwarded-host'] === 'string'
    ? request.headers['x-forwarded-host'].split(',')[0]?.trim()
    : undefined;
  const host = typeof request.headers.host === 'string'
    ? request.headers.host.trim()
    : '';

  const resolvedHost = forwardedHost || host;
  if (resolvedHost) {
    const protocol = forwardedProto || request.protocol || 'https';
    return `${protocol}://${resolvedHost}`.replace(/\/$/, '');
  }

  return 'http://localhost:5173';
};
const INITIAL_TRIAL_MONTHS = 1;

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
      currencyCode?: string;
      referralCode?: string;
    };

    if (!body.name || !body.phoneNumber) {
      return reply.status(400).send({ message: 'Name and phone number are required.' });
    }

    if (body.preferredTime && !isPreferredTime(body.preferredTime)) {
      return reply.status(400).send({ message: 'preferredTime must be morning, afternoon, or evening.' });
    }

    const normalizedCurrency = body.currencyCode ? normalizeCurrencyCode(body.currencyCode) : null;
    if (body.currencyCode && !normalizedCurrency) {
      return reply.status(400).send({ message: 'currencyCode must be a valid 3-letter ISO code.' });
    }

    const normalizedReferralInput = normalizeReferralCodeInput(body.referralCode);
    let referredByUserId: string | null = null;
    if (normalizedReferralInput) {
      const referrer = await db.user.findUnique({
        where: { referralCode: normalizedReferralInput },
        select: { id: true }
      });
      if (!referrer) {
        return reply.status(400).send({ message: 'Referral code is invalid.' });
      }
      referredByUserId = referrer.id;
    }

    const now = new Date();
    const desiredSubscriptionStatus: SubscriptionStatusInput = isSubscriptionStatus(body.subscriptionStatus)
      ? body.subscriptionStatus
      : 'trial';
    const trialEndsAt = desiredSubscriptionStatus === 'trial'
      ? addMonthsUtc(now, INITIAL_TRIAL_MONTHS)
      : null;
    const referralCode = await createUniqueReferralCode(body.name);
    const userCount = await db.user.count();

    try {
      const user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: body.name,
            fullName: body.name,
            phoneNumber: body.phoneNumber,
            businessName: body.businessName ?? null,
            businessType: body.businessType ?? null,
            preferredTime: body.preferredTime ?? null,
            timezone: body.timezone ?? null,
            currencyCode: normalizedCurrency ?? 'GHS',
            subscriptionStatus: desiredSubscriptionStatus,
            trialEndsAt,
            subscriptionEndsAt: desiredSubscriptionStatus === 'trial' ? trialEndsAt : null,
            referredByUserId,
            referralCode,
            isSuperAdmin: userCount === 0
          }
        });

        const createdBusiness = await tx.business.create({
          data: {
            businessName: body.businessName ?? `${body.name}'s Business`,
            ownerUserId: created.id,
            primaryWhatsappUserId: created.id,
            timezone: body.timezone ?? 'Africa/Accra',
            subscriptionStatus: desiredSubscriptionStatus
          }
        });

        await tx.businessMembership.create({
          data: {
            businessId: createdBusiness.id,
            userId: created.id,
            role: 'owner',
            membershipStatus: 'active',
            joinedAt: now
          }
        });

        await tx.user.update({
          where: { id: created.id },
          data: { activeBusinessId: createdBusiness.id }
        });

        if (desiredSubscriptionStatus === 'trial') {
          await tx.subscriptionGrant.create({
            data: {
              businessId: createdBusiness.id,
              userId: created.id,
              source: 'trial',
              status: 'trial',
              monthsGranted: INITIAL_TRIAL_MONTHS,
              startsAt: now,
              endsAt: trialEndsAt ?? null,
              note: 'Initial trial period'
            }
          });
        } else if (desiredSubscriptionStatus === 'premium') {
          await tx.subscriptionGrant.create({
            data: {
              businessId: createdBusiness.id,
              userId: created.id,
              source: 'paid',
              status: 'premium',
              monthsGranted: 0,
              startsAt: now,
              note: 'Initial premium activation'
            }
          });
        }

        return created;
      });

      await qualifyReferralFromSubscription(user.id);

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

  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      businessName?: string | null;
      businessType?: string | null;
      preferredTime?: string | null;
      timezone?: string | null;
      currencyCode?: string;
    };

    if (body.preferredTime !== undefined && body.preferredTime !== null && !isPreferredTime(body.preferredTime)) {
      return reply.status(400).send({ message: 'preferredTime must be morning, afternoon, or evening.' });
    }

    const normalizedCurrency = body.currencyCode !== undefined ? normalizeCurrencyCode(body.currencyCode) : undefined;
    if (body.currencyCode !== undefined && !normalizedCurrency) {
      return reply.status(400).send({ message: 'currencyCode must be a valid 3-letter ISO code.' });
    }

    try {
      const updated = await db.user.update({
        where: { id },
        data: {
          name: body.name?.trim() || undefined,
          businessName: body.businessName === undefined ? undefined : body.businessName,
          businessType: body.businessType === undefined ? undefined : body.businessType,
          preferredTime: body.preferredTime === undefined ? undefined : body.preferredTime,
          timezone: body.timezone === undefined ? undefined : body.timezone,
          currencyCode: normalizedCurrency ?? undefined
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(404).send({ message: 'User not found' });
      }
      fastify.log.error(error);
      return reply.status(500).send({ message: 'Unable to update user.' });
    }
  });

  fastify.post('/:id/subscription', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: SubscriptionStatusInput;
      source?: SubscriptionSourceInput;
      months?: number;
      note?: string;
    };

    if (body.status && !isSubscriptionStatus(body.status)) {
      return reply.status(400).send({ message: 'status must be free, trial, or premium.' });
    }

    if (body.source && !isSubscriptionSource(body.source)) {
      return reply.status(400).send({ message: 'source must be trial, paid, referral_bonus, or admin_adjustment.' });
    }

    if (body.months !== undefined && (!Number.isFinite(body.months) || body.months < 0 || body.months > 60)) {
      return reply.status(400).send({ message: 'months must be between 0 and 60.' });
    }

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: 'User not found' });
    }

    const now = new Date();
    const nextStatus = body.status ?? existing.subscriptionStatus;
    const source = body.source ?? (nextStatus === 'premium' ? 'paid' : nextStatus === 'trial' ? 'trial' : 'admin_adjustment');
    const extensionMonths = Math.floor(body.months ?? (nextStatus === 'premium' ? 1 : 0));
    const trialEndsAt = nextStatus === 'trial'
      ? addMonthsUtc(now, INITIAL_TRIAL_MONTHS)
      : null;

    let startsAt: Date | null = null;
    let endsAt: Date | null = null;

    const updated = await db.$transaction(async (tx) => {
      let subscriptionEndsAt = existing.subscriptionEndsAt;
      if (nextStatus === 'premium') {
        const anchor = subscriptionEndsAt && subscriptionEndsAt > now ? subscriptionEndsAt : now;
        startsAt = anchor;
        endsAt = extensionMonths > 0 ? addMonthsUtc(anchor, extensionMonths) : subscriptionEndsAt;
        subscriptionEndsAt = endsAt;
      } else if (nextStatus === 'trial') {
        startsAt = now;
        endsAt = trialEndsAt;
        subscriptionEndsAt = trialEndsAt;
      } else {
        subscriptionEndsAt = null;
      }

      const nextUser = await tx.user.update({
        where: { id },
        data: {
          subscriptionStatus: nextStatus,
          subscriptionEndsAt,
          trialEndsAt
        }
      });

      await tx.subscriptionGrant.create({
        data: {
          userId: id,
          source,
          status: nextStatus,
          monthsGranted: extensionMonths,
          startsAt,
          endsAt,
          note: body.note ?? null
        }
      });

      return nextUser;
    });

    return updated;
  });

  fastify.get('/:id/referrals', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    const referralCode = await ensureUserReferralCode(id);
    const [qualifiedReferrals, rewards, recentConversions] = await Promise.all([
      db.referralConversion.count({ where: { referrerId: id } }),
      db.referralReward.findMany({
        where: { referrerId: id },
        orderBy: { createdAt: 'desc' },
        take: 12
      }),
      db.referralConversion.findMany({
        where: { referrerId: id },
        orderBy: { qualifiedAt: 'desc' },
        take: 8,
        include: {
          referredUser: {
            select: {
              id: true,
              name: true,
              businessName: true,
              subscriptionStatus: true
            }
          }
        }
      })
    ]);

    const totalRewardMonths = rewards.reduce((sum, reward) => sum + reward.grantedMonths, 0);
    const progressToNext = qualifiedReferrals % REFERRAL_MILESTONE_SIZE;
    const remainingForNextReward = progressToNext === 0 ? REFERRAL_MILESTONE_SIZE : REFERRAL_MILESTONE_SIZE - progressToNext;
    const appOrigin = resolveAppOrigin(request);
    const referralLink = `${appOrigin}/?ref=${encodeURIComponent(referralCode)}`;

    return {
      referralCode,
      referralLink,
      qualifiedReferrals,
      rewardMilestoneSize: REFERRAL_MILESTONE_SIZE,
      remainingForNextReward,
      totalRewardMonths,
      rewards: rewards.map((reward) => ({
        id: reward.id,
        milestone: reward.milestone,
        grantedMonths: reward.grantedMonths,
        qualifiedReferralsAtGrant: reward.qualifiedReferralsAtGrant,
        createdAt: reward.createdAt
      })),
      recentConversions: recentConversions.map((conversion) => ({
        id: conversion.id,
        qualifiedAt: conversion.qualifiedAt,
        referredUser: conversion.referredUser
      }))
    };
  });
};

export default userRoutes;
