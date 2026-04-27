import type { FastifyBaseLogger } from 'fastify';
import { config } from '../lib/env.js';
import { runDueAutoRenewals } from './subscriptions.js';

const MS_PER_HOUR = 60 * 60 * 1000;

const clampHour = (value: number): number => {
  if (!Number.isFinite(value)) return 2;
  const normalized = Math.floor(value);
  if (normalized < 0) return 0;
  if (normalized > 23) return 23;
  return normalized;
};

const nextRunDelayMs = (hourUtc: number): number => {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hourUtc,
    0,
    0,
    0
  ));

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return Math.max(MS_PER_HOUR, next.getTime() - now.getTime());
};

export const startSubscriptionRenewalScheduler = (logger: FastifyBaseLogger): (() => void) => {
  if (!config.SUBSCRIPTION_RENEWALS_ENABLED) {
    logger.info('Subscription renewal scheduler disabled via SUBSCRIPTION_RENEWALS_ENABLED=false');
    return () => undefined;
  }

  const renewalHourUtc = clampHour(config.SUBSCRIPTION_RENEWALS_HOUR_UTC);
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const runRenewals = async () => {
    if (stopped) return;
    try {
      const result = await runDueAutoRenewals({
        dryRun: false,
        lookaheadDays: 0,
        maxBusinesses: config.SUBSCRIPTION_RENEWALS_MAX_BUSINESSES,
        graceDays: config.SUBSCRIPTION_RENEWAL_GRACE_DAYS
      });
      logger.info({
        renewalScheduler: {
          asOf: result.asOf,
          summary: result.summary
        }
      }, 'Subscription renewal scheduler run completed');
    } catch (error) {
      logger.error({ err: error }, 'Subscription renewal scheduler run failed');
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    const delay = nextRunDelayMs(renewalHourUtc);
    timer = setTimeout(async () => {
      await runRenewals();
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  logger.info({
    subscriptionRenewals: {
      enabled: true,
      renewalHourUtc,
      graceDays: config.SUBSCRIPTION_RENEWAL_GRACE_DAYS,
      maxBusinesses: config.SUBSCRIPTION_RENEWALS_MAX_BUSINESSES
    }
  }, 'Subscription renewal scheduler initialized');

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};
