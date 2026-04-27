import type { SubscriptionStatus } from '@prisma/client';

export const isPaidSubscriptionStatus = (status: SubscriptionStatus | null | undefined): boolean =>
  status === 'basic' || status === 'premium';
