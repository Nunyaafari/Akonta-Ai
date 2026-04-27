-- Pricing tiers backfill:
-- 1) Existing paid users/workspaces move from legacy premium -> basic
-- 2) New list prices are normalized to Basic=60 and Premium=200

UPDATE "User"
SET "subscriptionStatus" = 'basic'
WHERE "subscriptionStatus" = 'premium';

UPDATE "Business"
SET "subscriptionStatus" = 'basic'
WHERE "subscriptionStatus" = 'premium';

UPDATE "SubscriptionGrant"
SET "status" = 'basic'
WHERE "status" = 'premium';

UPDATE "AppConfig"
SET "paystackBasicAmount" = 60,
    "paystackPremiumAmount" = 200;
