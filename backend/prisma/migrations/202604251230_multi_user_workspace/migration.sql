-- Multi-user workspace migration
-- Safety notes:
-- 1) Take full DB backup before applying in production.
-- 2) Run during maintenance window.
-- 3) Validate row counts and ownership invariants after apply.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
    CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'inactive', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipRole') THEN
    CREATE TYPE "MembershipRole" AS ENUM ('owner', 'cashier', 'manager', 'bookkeeper', 'viewer', 'accountant');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipStatus') THEN
    CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'inactive', 'revoked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalStatus') THEN
    CREATE TYPE "ApprovalStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransactionSourceChannel') THEN
    CREATE TYPE "TransactionSourceChannel" AS ENUM ('whatsapp', 'app', 'system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentType') THEN
    CREATE TYPE "DocumentType" AS ENUM (
      'receipt', 'invoice', 'payment_confirmation', 'momo_screenshot',
      'bank_transfer', 'utility_bill', 'rent_receipt', 'other'
    );
  END IF;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "fullName" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "activeBusinessId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Business" (
  "id" TEXT PRIMARY KEY,
  "businessName" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "primaryWhatsappUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Accra',
  "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'free',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "BusinessMembership" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" "MembershipRole" NOT NULL,
  "membershipStatus" "MembershipStatus" NOT NULL DEFAULT 'invited',
  "invitedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "joinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessMembership_businessId_userId_key" ON "BusinessMembership"("businessId", "userId");
CREATE INDEX IF NOT EXISTS "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");
CREATE INDEX IF NOT EXISTS "BusinessMembership_businessId_role_idx" ON "BusinessMembership"("businessId", "role");

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "businessId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceChannel" "TransactionSourceChannel" NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Summary" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "ConversationSession" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "CustomLineItem" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "ProcessedWebhookEvent" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "SubscriptionGrant" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "businessId" TEXT;

CREATE TABLE IF NOT EXISTS "TransactionApproval" (
  "id" TEXT PRIMARY KEY,
  "transactionId" TEXT NOT NULL REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "reviewNote" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "TransactionApproval_transactionId_idx" ON "TransactionApproval"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionApproval_status_idx" ON "TransactionApproval"("status");

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "transactionId" TEXT NOT NULL REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "fileSizeBytes" BIGINT,
  "documentType" "DocumentType" NOT NULL DEFAULT 'other',
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Document_businessId_idx" ON "Document"("businessId");
CREATE INDEX IF NOT EXISTS "Document_transactionId_idx" ON "Document"("transactionId");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "performedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AuditLog_businessId_performedAt_idx" ON "AuditLog"("businessId", "performedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "OtpCode" (
  "id" TEXT PRIMARY KEY,
  "phoneNumber" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "requestedByIp" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "OtpCode_phoneNumber_createdAt_idx" ON "OtpCode"("phoneNumber", "createdAt");

CREATE TABLE IF NOT EXISTS "UserSession" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "UserSession_userId_businessId_idx" ON "UserSession"("userId", "businessId");

-- Backfill: one business + owner membership per legacy user.
INSERT INTO "Business" ("id", "businessName", "ownerUserId", "primaryWhatsappUserId", "timezone", "subscriptionStatus", "createdAt", "updatedAt")
SELECT
  CONCAT('biz_', u."id"),
  COALESCE(NULLIF(u."businessName", ''), CONCAT(u."name", '''s Business')),
  u."id",
  u."id",
  COALESCE(NULLIF(u."timezone", ''), 'Africa/Accra'),
  u."subscriptionStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Business" b WHERE b."ownerUserId" = u."id"
);

INSERT INTO "BusinessMembership" ("id", "businessId", "userId", "role", "membershipStatus", "joinedAt", "createdAt", "updatedAt")
SELECT
  CONCAT('mem_', u."id"),
  CONCAT('biz_', u."id"),
  u."id",
  'owner',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "BusinessMembership" bm WHERE bm."businessId" = CONCAT('biz_', u."id") AND bm."userId" = u."id"
);

UPDATE "User" u
SET "activeBusinessId" = CONCAT('biz_', u."id")
WHERE "activeBusinessId" IS NULL;

UPDATE "Transaction" t
SET "businessId" = COALESCE(t."businessId", CONCAT('biz_', t."userId")),
    "createdByUserId" = COALESCE(t."createdByUserId", t."userId")
WHERE t."businessId" IS NULL OR t."createdByUserId" IS NULL;

UPDATE "Summary" s
SET "businessId" = COALESCE(s."businessId", CONCAT('biz_', s."userId"))
WHERE s."businessId" IS NULL;

UPDATE "Budget" b
SET "businessId" = COALESCE(b."businessId", CONCAT('biz_', b."userId"))
WHERE b."businessId" IS NULL;

UPDATE "ConversationSession" c
SET "businessId" = COALESCE(c."businessId", CONCAT('biz_', c."userId"))
WHERE c."businessId" IS NULL;

UPDATE "CustomLineItem" c
SET "businessId" = COALESCE(c."businessId", CONCAT('biz_', c."userId"))
WHERE c."businessId" IS NULL;

UPDATE "SubscriptionGrant" sg
SET "businessId" = COALESCE(sg."businessId", CONCAT('biz_', sg."userId"))
WHERE sg."businessId" IS NULL;

UPDATE "SubscriptionPayment" sp
SET "businessId" = COALESCE(sp."businessId", CONCAT('biz_', sp."userId"))
WHERE sp."businessId" IS NULL;

-- Foreign keys added last to keep migration resilient on existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Transaction' AND constraint_name = 'Transaction_businessId_fkey'
  ) THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
