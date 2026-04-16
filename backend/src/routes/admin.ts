import type { FastifyPluginAsync } from 'fastify';
import db from '../lib/db.js';
import {
  availableProviders,
  getConfiguredProvider,
  resolveProvider,
  setConfiguredProvider,
  type WhatsAppProvider
} from '../services/whatsapp.js';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/analytics', async () => {
    const [
      totalUsers,
      freeUsers,
      trialUsers,
      paidUsers,
      businessTypes,
      subscriptionStarts,
      referralConversions,
      referralRewards
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { subscriptionStatus: 'free' } }),
      db.user.count({ where: { subscriptionStatus: 'trial' } }),
      db.user.count({ where: { subscriptionStatus: 'premium' } }),
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

    return {
      users: {
        total: totalUsers,
        subscribed: paidUsers + trialUsers,
        paid: paidUsers,
        trial: trialUsers,
        free: freeUsers
      },
      subscriptions: {
        paidStarts: subscriptionStarts
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
    return {
      provider: current,
      available: availableProviders
    };
  });

  fastify.patch('/settings/whatsapp-provider', async (request, reply) => {
    const body = request.body as { provider?: string };
    if (!body.provider) {
      return reply.status(400).send({ message: 'provider is required.' });
    }
    const normalized = body.provider.toLowerCase() as WhatsAppProvider;
    if (!availableProviders.includes(normalized)) {
      return reply.status(400).send({ message: `provider must be one of: ${availableProviders.join(', ')}` });
    }
    const selected = resolveProvider(normalized);
    const updated = await setConfiguredProvider(selected as WhatsAppProvider);
    return {
      provider: updated,
      available: availableProviders
    };
  });
};

export default adminRoutes;
