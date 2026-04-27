import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import { config } from '../lib/env.js';
import {
  availableProviders,
  getConfiguredProvider,
  resolveProvider,
  type WhatsAppProvider
} from '../services/whatsapp.js';
import { getResolvedPaystackAdminSettings } from '../services/subscriptions.js';

const toDateKeyUtc = (value: Date): string => value.toISOString().slice(0, 10);
const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const addDaysUtc = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizedCurrencyCode = (value: unknown): string | null => {
  const text = asTrimmedString(value).toUpperCase();
  if (!text) return null;
  return /^[A-Z]{3}$/.test(text) ? text : null;
};

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/analytics', async () => {
    const [
      totalUsers,
      freeUsers,
      basicUsers,
      trialUsers,
      premiumUsers,
      totalBusinesses,
      freeBusinesses,
      basicBusinesses,
      trialBusinesses,
      premiumBusinesses,
      businessLocationGroups,
      businessTypes,
      subscriptionStarts,
      referralConversions,
      referralRewards
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { subscriptionStatus: 'free' } }),
      db.user.count({ where: { subscriptionStatus: 'basic' } }),
      db.user.count({ where: { subscriptionStatus: 'trial' } }),
      db.user.count({ where: { subscriptionStatus: 'premium' } }),
      db.business.count(),
      db.business.count({ where: { subscriptionStatus: 'free' } }),
      db.business.count({ where: { subscriptionStatus: 'basic' } }),
      db.business.count({ where: { subscriptionStatus: 'trial' } }),
      db.business.count({ where: { subscriptionStatus: 'premium' } }),
      db.business.groupBy({
        by: ['timezone'],
        _count: { _all: true }
      }),
      db.user.groupBy({
        by: ['businessType'],
        _count: { _all: true }
      }),
      db.subscriptionGrant.count({ where: { source: 'paid' } }),
      db.referralConversion.count(),
      db.referralReward.aggregate({
        _count: { _all: true },
        _sum: { grantedMonths: true }
      })
    ]);

    const configuredProvider = await getConfiguredProvider();

    const now = new Date();
    const days = 14;
    const startDate = addDaysUtc(startOfUtcDay(now), -(days - 1));
    const activityWindowStart = addDaysUtc(startOfUtcDay(now), -29);

    const [
      dailyGrants,
      dailyPayments,
      recentAuditLogs,
      recentTransactions,
      recentSuccessfulPayments,
      recentRevenueAggregate,
      recentExpenseAggregate,
      recentChannelMix
    ] = await Promise.all([
      db.subscriptionGrant.findMany({
        where: {
          source: 'paid',
          createdAt: { gte: startDate }
        },
        select: { createdAt: true }
      }),
      db.subscriptionPayment.findMany({
        where: {
          status: 'successful',
          createdAt: { gte: startDate }
        },
        select: {
          createdAt: true,
          amountMinor: true
        }
      }),
      db.auditLog.findMany({
        orderBy: { performedAt: 'desc' },
        take: 30,
        include: {
          business: {
            select: { businessName: true }
          },
          performedByUser: {
            select: { name: true, fullName: true }
          }
        }
      }),
      db.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        where: {
          createdAt: { gte: activityWindowStart },
          isDeleted: false
        },
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          createdAt: true,
          business: {
            select: { businessName: true }
          },
          createdByUser: {
            select: { name: true, fullName: true }
          }
        }
      }),
      db.subscriptionPayment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        where: {
          status: 'successful',
          createdAt: { gte: activityWindowStart }
        },
        select: {
          id: true,
          amountMinor: true,
          currencyCode: true,
          createdAt: true,
          business: {
            select: { businessName: true }
          },
          user: {
            select: { name: true, fullName: true }
          }
        }
      }),
      db.transaction.aggregate({
        where: {
          createdAt: { gte: activityWindowStart },
          isDeleted: false,
          status: 'confirmed',
          type: 'revenue'
        },
        _count: { _all: true },
        _sum: { amount: true }
      }),
      db.transaction.aggregate({
        where: {
          createdAt: { gte: activityWindowStart },
          isDeleted: false,
          status: 'confirmed',
          type: 'expense'
        },
        _count: { _all: true },
        _sum: { amount: true }
      }),
      db.transaction.groupBy({
        by: ['sourceChannel'],
        where: {
          createdAt: { gte: activityWindowStart },
          isDeleted: false
        },
        _count: { _all: true }
      })
    ]);

    const grantCountByDate = new Map<string, number>();
    const revenueByDate = new Map<string, number>();

    for (const grant of dailyGrants) {
      const key = toDateKeyUtc(grant.createdAt);
      grantCountByDate.set(key, (grantCountByDate.get(key) ?? 0) + 1);
    }

    for (const payment of dailyPayments) {
      const key = toDateKeyUtc(payment.createdAt);
      const revenue = payment.amountMinor / 100;
      revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + revenue);
    }

    const daily = Array.from({ length: days }, (_, index) => {
      const date = addDaysUtc(startDate, index);
      const key = toDateKeyUtc(date);
      return {
        date: key,
        count: grantCountByDate.get(key) ?? 0,
        revenue: revenueByDate.get(key) ?? 0
      };
    });

    const recentActivity = [
      ...recentAuditLogs.map((log) => ({
        id: `audit-${log.id}`,
        type: 'audit' as const,
        title: log.action.replace(/_/g, ' '),
        description: `${log.entityType} ${log.entityId}`,
        businessName: log.business.businessName,
        actorName: log.performedByUser?.fullName || log.performedByUser?.name || 'System',
        occurredAt: log.performedAt.toISOString()
      })),
      ...recentTransactions.map((tx) => ({
        id: `transaction-${tx.id}`,
        type: 'transaction' as const,
        title: tx.type === 'revenue' ? 'Revenue entry created' : 'Expense entry created',
        description: `${tx.status} • ${tx.amount.toFixed(2)}`,
        businessName: tx.business?.businessName ?? 'Unknown workspace',
        actorName: tx.createdByUser.fullName || tx.createdByUser.name,
        occurredAt: tx.createdAt.toISOString()
      })),
      ...recentSuccessfulPayments.map((payment) => ({
        id: `subscription-${payment.id}`,
        type: 'subscription' as const,
        title: 'Subscription payment succeeded',
        description: `${payment.currencyCode} ${(payment.amountMinor / 100).toFixed(2)}`,
        businessName: payment.business?.businessName ?? 'Unknown workspace',
        actorName: payment.user.fullName || payment.user.name,
        occurredAt: payment.createdAt.toISOString()
      }))
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 40);

    const revenueLast30 = recentRevenueAggregate._sum.amount ?? 0;
    const expenseLast30 = recentExpenseAggregate._sum.amount ?? 0;
    const transactionsLast30 = (recentRevenueAggregate._count._all ?? 0) + (recentExpenseAggregate._count._all ?? 0);
    const channelCountMap = new Map(recentChannelMix.map((entry) => [entry.sourceChannel, entry._count._all]));

    return {
      users: {
        total: totalUsers,
        subscribed: basicUsers + premiumUsers + trialUsers,
        paid: basicUsers + premiumUsers,
        basic: basicUsers,
        premium: premiumUsers,
        trial: trialUsers,
        free: freeUsers
      },
      tiers: {
        free: freeUsers,
        basic: basicUsers,
        premium: premiumUsers,
        trial: trialUsers
      },
      businesses: {
        total: totalBusinesses,
        free: freeBusinesses,
        basic: basicBusinesses,
        premium: premiumBusinesses,
        trial: trialBusinesses
      },
      subscriptions: {
        paidStarts: subscriptionStarts,
        daily
      },
      locations: businessLocationGroups
        .map((row) => ({
          location: row.timezone?.trim() || 'Unspecified',
          count: row._count._all
        }))
        .sort((a, b) => b.count - a.count),
      channels: {
        app: channelCountMap.get('app') ?? 0,
        whatsapp: channelCountMap.get('whatsapp') ?? 0,
        system: channelCountMap.get('system') ?? 0
      },
      activity: {
        last30Days: {
          transactions: transactionsLast30,
          revenue: revenueLast30,
          expenses: expenseLast30,
          net: revenueLast30 - expenseLast30
        },
        recent: recentActivity
      },
      referrals: {
        qualifiedConversions: referralConversions,
        rewardsGranted: referralRewards._count._all,
        freeMonthsGranted: referralRewards._sum.grantedMonths ?? 0
      },
      businessTypes: businessTypes
        .map((row) => ({
          type: row.businessType?.trim() || 'Unspecified',
          count: row._count._all
        }))
        .sort((a, b) => b.count - a.count),
      whatsapp: {
        provider: configuredProvider,
        availableProviders
      }
    };
  });

  fastify.get('/settings/whatsapp-provider', async () => {
    const current = await getConfiguredProvider();
    const configRow = await db.appConfig.findUnique({
      where: { id: 'global' },
      select: {
        whatchimpBaseUrl: true,
        whatchimpApiKey: true,
        whatchimpSenderId: true,
        whatchimpSendPath: true,
        whatchimpAuthScheme: true
      }
    });

    return {
      provider: current,
      available: availableProviders,
      whatchimp: {
        baseUrl: configRow?.whatchimpBaseUrl ?? config.WHATCHIMP_BASE_URL,
        apiKey: configRow?.whatchimpApiKey ?? config.WHATCHIMP_API_KEY,
        senderId: configRow?.whatchimpSenderId ?? config.WHATCHIMP_SENDER_ID,
        sendPath: configRow?.whatchimpSendPath ?? config.WHATCHIMP_SEND_PATH,
        authScheme: configRow?.whatchimpAuthScheme ?? config.WHATCHIMP_AUTH_SCHEME
      }
    };
  });

  fastify.patch('/settings/whatsapp-provider', async (request, reply) => {
    const body = request.body as {
      provider?: string;
      whatchimp?: {
        baseUrl?: string;
        apiKey?: string;
        senderId?: string;
        sendPath?: string;
        authScheme?: string;
      };
    };

    let provider: WhatsAppProvider | undefined;
    if (body.provider) {
      const normalized = body.provider.toLowerCase() as WhatsAppProvider;
      if (!availableProviders.includes(normalized)) {
        return reply.status(400).send({ message: `provider must be one of: ${availableProviders.join(', ')}` });
      }
      provider = resolveProvider(normalized);
    }

    const current = await db.appConfig.findUnique({ where: { id: 'global' } });

    const updated = await db.appConfig.upsert({
      where: { id: 'global' },
      update: {
        whatsappProvider: provider ?? current?.whatsappProvider ?? 'whatchimp',
        whatchimpBaseUrl: body.whatchimp?.baseUrl !== undefined ? asTrimmedString(body.whatchimp.baseUrl) || null : undefined,
        whatchimpApiKey: body.whatchimp?.apiKey !== undefined ? asTrimmedString(body.whatchimp.apiKey) || null : undefined,
        whatchimpSenderId: body.whatchimp?.senderId !== undefined ? asTrimmedString(body.whatchimp.senderId) || null : undefined,
        whatchimpSendPath: body.whatchimp?.sendPath !== undefined ? asTrimmedString(body.whatchimp.sendPath) || '/api/messages/whatsapp' : undefined,
        whatchimpAuthScheme: body.whatchimp?.authScheme !== undefined ? asTrimmedString(body.whatchimp.authScheme) || 'Bearer' : undefined
      },
      create: {
        id: 'global',
        whatsappProvider: provider ?? 'whatchimp',
        whatchimpBaseUrl: body.whatchimp?.baseUrl ? asTrimmedString(body.whatchimp.baseUrl) : null,
        whatchimpApiKey: body.whatchimp?.apiKey ? asTrimmedString(body.whatchimp.apiKey) : null,
        whatchimpSenderId: body.whatchimp?.senderId ? asTrimmedString(body.whatchimp.senderId) : null,
        whatchimpSendPath: asTrimmedString(body.whatchimp?.sendPath) || '/api/messages/whatsapp',
        whatchimpAuthScheme: asTrimmedString(body.whatchimp?.authScheme) || 'Bearer'
      },
      select: {
        whatsappProvider: true,
        whatchimpBaseUrl: true,
        whatchimpApiKey: true,
        whatchimpSenderId: true,
        whatchimpSendPath: true,
        whatchimpAuthScheme: true
      }
    });

    return {
      provider: updated.whatsappProvider,
      available: availableProviders,
      whatchimp: {
        baseUrl: updated.whatchimpBaseUrl,
        apiKey: updated.whatchimpApiKey,
        senderId: updated.whatchimpSenderId,
        sendPath: updated.whatchimpSendPath,
        authScheme: updated.whatchimpAuthScheme
      }
    };
  });

  fastify.get('/settings/payment', async () => {
    const settings = await getResolvedPaystackAdminSettings();
    return {
      paystackPublicKey: settings.publicKey,
      paystackSecretKey: settings.secretKey,
      paystackWebhookSecret: settings.webhookSecret,
      basicAmount: settings.basicAmountMajor,
      premiumAmount: settings.premiumAmountMajor,
      currencyCode: settings.currencyCode
    };
  });

  fastify.patch('/settings/payment', async (request, reply) => {
    const body = request.body as {
      paystackPublicKey?: string;
      paystackSecretKey?: string;
      paystackWebhookSecret?: string;
      basicAmount?: number;
      premiumAmount?: number;
      currencyCode?: string;
    };

    if (body.basicAmount !== undefined && (!Number.isFinite(body.basicAmount) || body.basicAmount < 1 || body.basicAmount > 100000)) {
      return reply.status(400).send({ message: 'basicAmount must be between 1 and 100000.' });
    }

    if (body.premiumAmount !== undefined && (!Number.isFinite(body.premiumAmount) || body.premiumAmount < 1 || body.premiumAmount > 100000)) {
      return reply.status(400).send({ message: 'premiumAmount must be between 1 and 100000.' });
    }

    if (
      body.basicAmount !== undefined
      && body.premiumAmount !== undefined
      && Math.floor(body.premiumAmount) < Math.floor(body.basicAmount)
    ) {
      return reply.status(400).send({ message: 'premiumAmount must be greater than or equal to basicAmount.' });
    }

    if (body.currencyCode !== undefined && !normalizedCurrencyCode(body.currencyCode)) {
      return reply.status(400).send({ message: 'currencyCode must be a valid 3-letter ISO code.' });
    }

    const updated = await db.appConfig.upsert({
      where: { id: 'global' },
      update: {
        paystackPublicKey: body.paystackPublicKey !== undefined ? asTrimmedString(body.paystackPublicKey) || null : undefined,
        paystackSecretKey: body.paystackSecretKey !== undefined ? asTrimmedString(body.paystackSecretKey) || null : undefined,
        paystackWebhookSecret: body.paystackWebhookSecret !== undefined ? asTrimmedString(body.paystackWebhookSecret) || null : undefined,
        paystackBasicAmount: body.basicAmount !== undefined ? Math.floor(body.basicAmount) : undefined,
        paystackPremiumAmount: body.premiumAmount !== undefined ? Math.floor(body.premiumAmount) : undefined,
        paystackCurrencyCode: body.currencyCode !== undefined ? normalizedCurrencyCode(body.currencyCode) ?? undefined : undefined
      },
      create: {
        id: 'global',
        whatsappProvider: 'whatchimp',
        paystackPublicKey: body.paystackPublicKey ? asTrimmedString(body.paystackPublicKey) : null,
        paystackSecretKey: body.paystackSecretKey ? asTrimmedString(body.paystackSecretKey) : null,
        paystackWebhookSecret: body.paystackWebhookSecret ? asTrimmedString(body.paystackWebhookSecret) : null,
        paystackBasicAmount: body.basicAmount !== undefined ? Math.floor(body.basicAmount) : 60,
        paystackPremiumAmount: body.premiumAmount !== undefined ? Math.floor(body.premiumAmount) : 200,
        paystackCurrencyCode: normalizedCurrencyCode(body.currencyCode) ?? 'GHS'
      },
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
      paystackPublicKey: updated.paystackPublicKey,
      paystackSecretKey: updated.paystackSecretKey,
      paystackWebhookSecret: updated.paystackWebhookSecret,
      basicAmount: updated.paystackBasicAmount,
      premiumAmount: updated.paystackPremiumAmount,
      currencyCode: updated.paystackCurrencyCode
    };
  });
};

export default adminRoutes;
