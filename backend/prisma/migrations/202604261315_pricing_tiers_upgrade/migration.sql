-- Pricing tiers upgrade: introduce basic tier and reprice plans.

ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'basic';

ALTER TABLE "AppConfig"
ADD COLUMN IF NOT EXISTS "paystackBasicAmount" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "AppConfig"
ALTER COLUMN "paystackPremiumAmount" SET DEFAULT 200;
