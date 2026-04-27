import { Prisma, SubscriptionPaymentStatus } from '@prisma/client';
import crypto from 'node:crypto';
import db from '../lib/db.js';
import { config } from '../lib/env.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackEnvelope<TData = unknown> {
  status?: boolean;
  message?: string;
  data?: TData;
}

type SubscriptionPlan = 'basic' | 'premium';

const addMonthsUtc = (value: Date, months: number): Date => {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const parsePositiveInt = (value: unknown, fallback = 1): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const asTrimmedString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const randomReference = (): string => {
  const suffix = crypto.randomBytes(6).toString('hex');
  return `akonta_${Date.now()}_${suffix}`;
};

const normalizeSubscriptionPlan = (value: unknown, fallback: SubscriptionPlan = 'basic'): SubscriptionPlan => {
  if (value === 'premium') return 'premium';
  if (value === 'basic') return 'basic';
  return fallback;
};

const resolveStatusAfterPlanPurchase = (currentStatus: string, purchasedPlan: SubscriptionPlan): SubscriptionPlan => {
  if (purchasedPlan === 'premium') return 'premium';
  return currentStatus === 'premium' ? 'premium' : 'basic';
};

const getPaystackConfig = async () => {
  try {
    const settings = await db.appConfig.findUnique({
      where: { id: 'global' },
      select: {
        paystackPublicKey: true,
        paystackSecretKey: true,
        paystackWebhookSecret: true,
        paystackBasicAmount: true,
        paystackPremiumAmount: true,
        paystackCurrencyCode: true
      }
    });

    return {
      publicKey: asTrimmedString(settings?.paystackPublicKey) || config.PAYSTACK_PUBLIC_KEY,
      secretKey: asTrimmedString(settings?.paystackSecretKey) || config.PAYSTACK_SECRET_KEY,
      webhookSecret: asTrimmedString(settings?.paystackWebhookSecret) || config.PAYSTACK_WEBHOOK_SECRET,
      basicAmountMajor: settings?.paystackBasicAmount && settings.paystackBasicAmount > 0
        ? settings.paystackBasicAmount
        : parsePositiveInt(config.PAYSTACK_BASIC_AMOUNT, 60),
      premiumAmountMajor: settings?.paystackPremiumAmount && settings.paystackPremiumAmount > 0
        ? settings.paystackPremiumAmount
        : parsePositiveInt(config.PAYSTACK_PREMIUM_AMOUNT, 200),
      currencyCode: asTrimmedString(settings?.paystackCurrencyCode) || config.PAYSTACK_CURRENCY_CODE || 'GHS'
    };
  } catch {
    return {
      publicKey: config.PAYSTACK_PUBLIC_KEY,
      secretKey: config.PAYSTACK_SECRET_KEY,
      webhookSecret: config.PAYSTACK_WEBHOOK_SECRET,
      basicAmountMajor: parsePositiveInt(config.PAYSTACK_BASIC_AMOUNT, 60),
      premiumAmountMajor: parsePositiveInt(config.PAYSTACK_PREMIUM_AMOUNT, 200),
      currencyCode: config.PAYSTACK_CURRENCY_CODE || 'GHS'
    };
  }
};

const verifyPaystackReference = async (reference: string, secretKey: string): Promise<any> => {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    }
  });

  const body = (await response.json().catch(() => null)) as PaystackEnvelope<Record<string, unknown>> | null;
  if (!response.ok || !body?.status || !body?.data) {
    const errorMessage = body?.message || `Paystack verification failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return body.data;
};

export const initializeSubscriptionPayment = async (params: {
  userId: string;
  plan?: SubscriptionPlan;
  months?: number;
  callbackUrl?: string;
  customerEmail?: string;
}) => {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      currencyCode: true,
      activeBusinessId: true
    }
  });

  if (!user) {
    throw new Error('User not found.');
  }

  const settings = await getPaystackConfig();
  if (!settings.secretKey) {
    throw new Error('Paystack secret key is not configured.');
  }

  const months = parsePositiveInt(params.months, 1);
  const plan = normalizeSubscriptionPlan(params.plan);
  const planAmountMajor = plan === 'premium' ? settings.premiumAmountMajor : settings.basicAmountMajor;
  const amountMajor = planAmountMajor * months;
  const amountMinor = amountMajor * 100;
  const currencyCode = asTrimmedString(settings.currencyCode || user.currencyCode || 'GHS').toUpperCase();
  const reference = randomReference();
  const customerEmail = asTrimmedString(params.customerEmail)
    || `${user.id}@akonta.local`;

  const initializeResponse = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: customerEmail,
      amount: amountMinor,
      currency: currencyCode,
      reference,
      callback_url: asTrimmedString(params.callbackUrl) || undefined,
      channels: ['card', 'mobile_money'],
      metadata: {
        userId: user.id,
        businessId: user.activeBusinessId,
        months,
        plan,
        userName: user.name,
        phoneNumber: user.phoneNumber,
        source: 'akonta-subscription'
      }
    })
  });

  const initializeBody = (await initializeResponse.json().catch(() => null)) as PaystackEnvelope<{
    authorization_url?: string;
    access_code?: string;
    [key: string]: unknown;
  }> | null;
  if (!initializeResponse.ok || !initializeBody?.status || !initializeBody?.data?.authorization_url) {
    const errorMessage = initializeBody?.message || `Paystack initialize failed with status ${initializeResponse.status}`;
    throw new Error(errorMessage);
  }

  await db.subscriptionPayment.create({
    data: {
      businessId: user.activeBusinessId,
      userId: user.id,
      provider: 'paystack',
      reference,
      amountMinor,
      currencyCode,
      monthsPurchased: months,
      status: 'pending',
      customerEmail,
      metadata: {
        initializeResponse: initializeBody.data,
        source: 'initialize',
        plan
      } as Prisma.InputJsonValue
    }
  });

  return {
    reference,
    authorizationUrl: initializeBody.data.authorization_url as string,
    accessCode: initializeBody.data.access_code as string,
    amountMinor,
    amountMajor,
    currencyCode,
    plan,
    months,
    publicKey: settings.publicKey || null
  };
};

const markPaymentFailedIfPresent = async (reference: string, metadata?: Prisma.InputJsonValue) => {
  const existing = await db.subscriptionPayment.findUnique({ where: { reference } });
  if (!existing) return null;
  return db.subscriptionPayment.update({
    where: { id: existing.id },
    data: {
      status: 'failed',
      metadata
    }
  });
};

const parseMonthsFromVerification = (verificationData: any, fallback = 1): number => {
  const metadataMonths = verificationData?.metadata?.months;
  return parsePositiveInt(metadataMonths, fallback);
};

const parsePlanFromPaymentMetadata = (metadata: Prisma.JsonValue | null | undefined): SubscriptionPlan | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const maybePlan = (metadata as Record<string, unknown>).plan;
  if (maybePlan === 'basic' || maybePlan === 'premium') return maybePlan;
  return null;
};

const isSuccessfulPaystackStatus = (status: unknown): boolean => {
  return typeof status === 'string' && status.toLowerCase() === 'success';
};

export const applySuccessfulSubscriptionPayment = async (params: {
  reference: string;
  source: 'webhook' | 'client_verify';
  payload?: unknown;
}) => {
  const reference = asTrimmedString(params.reference);
  if (!reference) {
    throw new Error('reference is required.');
  }

  const settings = await getPaystackConfig();
  if (!settings.secretKey) {
    throw new Error('Paystack secret key is not configured.');
  }

  const verificationData = await verifyPaystackReference(reference, settings.secretKey);
  if (!isSuccessfulPaystackStatus(verificationData?.status)) {
    await markPaymentFailedIfPresent(reference, {
      verificationData,
      source: params.source,
      payload: params.payload
    } as Prisma.InputJsonValue);

    return {
      status: verificationData?.status || 'failed',
      applied: false,
      user: null
    };
  }

  const result = await db.$transaction(async (tx) => {
    const existingPayment = await tx.subscriptionPayment.findUnique({
      where: { reference },
      select: {
        id: true,
        businessId: true,
        userId: true,
        status: true,
        monthsPurchased: true,
        amountMinor: true,
        currencyCode: true,
        paidAt: true,
        channel: true,
        customerEmail: true,
        metadata: true
      }
    });

    const metadataUserId = asTrimmedString(verificationData?.metadata?.userId);
    const metadataBusinessId = asTrimmedString(verificationData?.metadata?.businessId);
    const resolvedUserId = existingPayment?.userId || metadataUserId;
    if (!resolvedUserId) {
      throw new Error('Unable to map payment to a user. Add metadata.userId in Paystack payload.');
    }

    const user = await tx.user.findUnique({
      where: { id: resolvedUserId },
      select: {
        id: true,
        subscriptionEndsAt: true,
        subscriptionStatus: true,
        activeBusinessId: true
      }
    });

    if (!user) {
      throw new Error('Payment user not found.');
    }

    const monthsPurchased = parseMonthsFromVerification(verificationData, existingPayment?.monthsPurchased ?? 1);
    const planFromVerification = normalizeSubscriptionPlan(verificationData?.metadata?.plan, 'basic');
    const planFromExistingPayment = parsePlanFromPaymentMetadata(existingPayment?.metadata);
    const purchasedPlan = planFromExistingPayment ?? planFromVerification;
    const amountMinor = parsePositiveInt(verificationData?.amount, existingPayment?.amountMinor ?? 0);
    const currencyCode = asTrimmedString(verificationData?.currency || existingPayment?.currencyCode || settings.currencyCode).toUpperCase();
    const paidAt = verificationData?.paid_at ? new Date(verificationData.paid_at) : new Date();
    const channel = asTrimmedString(verificationData?.channel || existingPayment?.channel);
    const customerEmail = asTrimmedString(verificationData?.customer?.email || existingPayment?.customerEmail);

    const metadata = {
      verificationData,
      source: params.source,
      payload: params.payload,
      plan: purchasedPlan
    } as Prisma.InputJsonValue;

    const resolvedBusinessId = existingPayment?.businessId || metadataBusinessId || user.activeBusinessId || null;

    const payment = existingPayment
      ? await tx.subscriptionPayment.update({
          where: { id: existingPayment.id },
          data: {
            businessId: resolvedBusinessId,
            status: 'successful',
            amountMinor,
            currencyCode,
            monthsPurchased,
            paidAt,
            channel: channel || null,
            customerEmail: customerEmail || null,
            metadata
          }
        })
      : await tx.subscriptionPayment.create({
          data: {
            businessId: resolvedBusinessId,
            userId: user.id,
            provider: 'paystack',
            reference,
            amountMinor,
            currencyCode,
            monthsPurchased,
            status: 'successful',
            paidAt,
            channel: channel || null,
            customerEmail: customerEmail || null,
            metadata
          }
        });

    if (existingPayment?.status === 'successful') {
      const unchangedUser = await tx.user.findUnique({ where: { id: user.id } });
      return {
        payment,
        user: unchangedUser,
        grantApplied: false
      };
    }

    const now = new Date();
    const anchor = user.subscriptionEndsAt && user.subscriptionEndsAt > now ? user.subscriptionEndsAt : now;
    const endsAt = addMonthsUtc(anchor, monthsPurchased);

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        subscriptionStatus: resolveStatusAfterPlanPurchase(user.subscriptionStatus, purchasedPlan),
        trialEndsAt: null,
        subscriptionEndsAt: endsAt
      }
    });

    await tx.subscriptionGrant.create({
      data: {
        businessId: resolvedBusinessId,
        userId: user.id,
        source: 'paid',
        status: resolveStatusAfterPlanPurchase(user.subscriptionStatus, purchasedPlan),
        monthsGranted: monthsPurchased,
        startsAt: anchor,
        endsAt,
        note: `Paystack subscription payment (${purchasedPlan})`,
        metadata: {
          reference,
          amountMinor,
          currencyCode,
          channel: channel || null,
          plan: purchasedPlan
        } as Prisma.InputJsonValue
      }
    });

    if (resolvedBusinessId) {
      const business = await tx.business.findUnique({
        where: { id: resolvedBusinessId },
        select: { subscriptionStatus: true }
      });
      await tx.business.update({
        where: { id: resolvedBusinessId },
        data: {
          subscriptionStatus: resolveStatusAfterPlanPurchase(business?.subscriptionStatus ?? 'free', purchasedPlan)
        }
      });
    }

    return {
      payment,
      user: updatedUser,
      grantApplied: true
    };
  });

  return {
    status: 'success',
    applied: result.grantApplied,
    user: result.user,
    payment: result.payment
  };
};

export const getPaymentStatusFromReference = async (reference: string): Promise<SubscriptionPaymentStatus | null> => {
  const payment = await db.subscriptionPayment.findUnique({
    where: { reference },
    select: { status: true }
  });
  return payment?.status ?? null;
};

export const verifyPaystackWebhookSignature = async (params: {
  signatureHeader: string | null;
  rawBody: string;
}): Promise<boolean> => {
  const settings = await getPaystackConfig();
  const provided = asTrimmedString(params.signatureHeader);
  if (!provided) return false;

  const secret = asTrimmedString(settings.webhookSecret || settings.secretKey);
  if (!secret) return false;

  const expected = crypto
    .createHmac('sha512', secret)
    .update(params.rawBody)
    .digest('hex');

  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

export const getResolvedPaystackAdminSettings = async () => {
  return getPaystackConfig();
};
