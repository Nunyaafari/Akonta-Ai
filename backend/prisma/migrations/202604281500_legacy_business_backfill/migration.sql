-- Backfill legacy rows that still have NULL businessId using user's active workspace
-- (or earliest membership fallback). Safe to run multiple times.

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "ConversationSession" s
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE s."businessId" IS NULL
  AND s."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "CustomLineItem" c
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE c."businessId" IS NULL
  AND c."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "Summary" s
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE s."businessId" IS NULL
  AND s."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "Budget" b
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE b."businessId" IS NULL
  AND b."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "SubscriptionGrant" g
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE g."businessId" IS NULL
  AND g."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;

WITH user_business AS (
  SELECT
    u."id" AS "userId",
    COALESCE(
      u."activeBusinessId",
      (
        SELECT bm."businessId"
        FROM "BusinessMembership" bm
        WHERE bm."userId" = u."id"
        ORDER BY bm."createdAt" ASC
        LIMIT 1
      )
    ) AS "businessId"
  FROM "User" u
)
UPDATE "SubscriptionPayment" p
SET "businessId" = ub."businessId"
FROM user_business ub
WHERE p."businessId" IS NULL
  AND p."userId" = ub."userId"
  AND ub."businessId" IS NOT NULL;
