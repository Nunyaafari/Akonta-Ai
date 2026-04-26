\pset format unaligned
\pset tuples_only on
\pset pager off

SELECT 'invariant_users_missing_active_business|' || COUNT(*)
FROM "User"
WHERE "activeBusinessId" IS NULL;

SELECT 'invariant_business_missing_owner_membership|' || COUNT(*)
FROM "Business" b
LEFT JOIN "BusinessMembership" bm
  ON bm."businessId" = b."id"
  AND bm."userId" = b."ownerUserId"
  AND bm."role" = 'owner'
  AND bm."membershipStatus" = 'active'
WHERE bm."id" IS NULL;

SELECT 'invariant_business_missing_primary_whatsapp_owner|' || COUNT(*)
FROM "Business"
WHERE "primaryWhatsappUserId" IS NULL;

SELECT 'invariant_transactions_missing_business_id|' || COUNT(*)
FROM "Transaction"
WHERE "businessId" IS NULL;

SELECT 'invariant_transactions_missing_creator_id|' || COUNT(*)
FROM "Transaction"
WHERE "createdByUserId" IS NULL;

SELECT 'invariant_transactions_orphan_business|' || COUNT(*)
FROM "Transaction" t
LEFT JOIN "Business" b ON b."id" = t."businessId"
WHERE t."businessId" IS NOT NULL
  AND b."id" IS NULL;

SELECT 'invariant_summaries_missing_business_id|' || COUNT(*)
FROM "Summary"
WHERE "businessId" IS NULL;

SELECT 'invariant_budgets_missing_business_id|' || COUNT(*)
FROM "Budget"
WHERE "businessId" IS NULL;

SELECT 'invariant_sessions_missing_business_id|' || COUNT(*)
FROM "ConversationSession"
WHERE "businessId" IS NULL;

SELECT 'invariant_custom_line_items_missing_business_id|' || COUNT(*)
FROM "CustomLineItem"
WHERE "businessId" IS NULL;

SELECT 'invariant_subscription_grants_missing_business_id|' || COUNT(*)
FROM "SubscriptionGrant"
WHERE "businessId" IS NULL;

SELECT 'invariant_subscription_payments_missing_business_id|' || COUNT(*)
FROM "SubscriptionPayment"
WHERE "businessId" IS NULL;
