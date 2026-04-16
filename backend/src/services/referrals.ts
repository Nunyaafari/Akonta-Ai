import { Prisma } from '@prisma/client';
import db from '../lib/db.js';

export const REFERRAL_MILESTONE_SIZE = 5;
export const REFERRAL_REWARD_MONTHS = 3;

const addMonthsUtc = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const createCodeSeed = (value?: string): string => {
  if (!value) return 'AKONTA';
  const normalized = normalizeCode(value);
  return normalized.slice(0, 6) || 'AKONTA';
};

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

const buildReferralCodeCandidate = (seed?: string): string => `${createCodeSeed(seed)}${randomSuffix()}`;

export const normalizeReferralCodeInput = (value?: string): string | null => {
  if (!value) return null;
  const normalized = normalizeCode(value);
  return normalized.length === 0 ? null : normalized;
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const createUniqueReferralCode = async (seed?: string): Promise<string> => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = buildReferralCodeCandidate(seed);
    const existing = await db.user.findUnique({
      where: { referralCode: candidate },
      select: { id: true }
    });
    if (!existing) return candidate;
  }
  return `AKONTA${Date.now().toString(36).toUpperCase()}`;
};

export const ensureUserReferralCode = async (userId: string): Promise<string> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, referralCode: true, name: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.referralCode) {
    return user.referralCode;
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = await createUniqueReferralCode(user.name);
    try {
      const updated = await db.user.update({
        where: { id: user.id },
        data: { referralCode: candidate },
        select: { referralCode: true }
      });
      if (updated.referralCode) return updated.referralCode;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new Error('Unable to allocate referral code');
};

export const qualifyReferralFromSubscription = async (referredUserId: string): Promise<void> => {
  await db.$transaction(async (tx) => {
    const referred = await tx.user.findUnique({
      where: { id: referredUserId },
      select: {
        id: true,
        referredByUserId: true,
        subscriptionStatus: true
      }
    });

    if (!referred?.referredByUserId || referred.subscriptionStatus !== 'premium') {
      return;
    }

    const referrerIdentity = await tx.user.findUnique({
      where: { id: referred.referredByUserId },
      select: { id: true, referralCode: true }
    });
    if (!referrerIdentity) return;

    try {
      await tx.referralConversion.create({
        data: {
          referrerId: referrerIdentity.id,
          referredUserId: referred.id,
          referralCode: referrerIdentity.referralCode ?? undefined
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return;
      }
      throw error;
    }

    const qualifiedCount = await tx.referralConversion.count({
      where: { referrerId: referred.referredByUserId }
    });
    const earnedMilestones = Math.floor(qualifiedCount / REFERRAL_MILESTONE_SIZE);
    if (earnedMilestones <= 0) return;

    const existingMilestones = await tx.referralReward.count({
      where: { referrerId: referred.referredByUserId }
    });

    if (existingMilestones >= earnedMilestones) return;

    let referrer = await tx.user.findUnique({
      where: { id: referred.referredByUserId },
      select: {
        id: true,
        subscriptionEndsAt: true
      }
    });

    if (!referrer) return;

    const now = new Date();

    for (let milestone = existingMilestones + 1; milestone <= earnedMilestones; milestone += 1) {
      const extensionStart = referrer.subscriptionEndsAt && referrer.subscriptionEndsAt > now
        ? referrer.subscriptionEndsAt
        : now;
      const extensionEnd = addMonthsUtc(extensionStart, REFERRAL_REWARD_MONTHS);

      await tx.referralReward.create({
        data: {
          referrerId: referrer.id,
          milestone,
          qualifiedReferralsAtGrant: milestone * REFERRAL_MILESTONE_SIZE,
          grantedMonths: REFERRAL_REWARD_MONTHS
        }
      });

      await tx.subscriptionGrant.create({
        data: {
          userId: referrer.id,
          source: 'referral_bonus',
          status: 'premium',
          monthsGranted: REFERRAL_REWARD_MONTHS,
          startsAt: extensionStart,
          endsAt: extensionEnd,
          note: `Referral reward milestone ${milestone}`,
          metadata: { milestone } as Prisma.InputJsonValue
        }
      });

      referrer = await tx.user.update({
        where: { id: referrer.id },
        data: {
          subscriptionStatus: 'premium',
          subscriptionEndsAt: extensionEnd,
          freeSubscriptionMonthsEarned: { increment: REFERRAL_REWARD_MONTHS }
        },
        select: { id: true, subscriptionEndsAt: true }
      });
    }
  });
};
