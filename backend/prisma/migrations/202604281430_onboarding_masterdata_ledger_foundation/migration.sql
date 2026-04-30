-- Onboarding + master data + default ledger foundation.
-- Safe for pre-live and live cutover with idempotent guards.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductServiceType') THEN
    CREATE TYPE "ProductServiceType" AS ENUM ('product', 'service');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BusinessCategoryKind') THEN
    CREATE TYPE "BusinessCategoryKind" AS ENUM ('sales', 'expense');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerAccountType') THEN
    CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerPostingStatus') THEN
    CREATE TYPE "LedgerPostingStatus" AS ENUM ('not_configured', 'pending', 'posted', 'failed', 'skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ParseConfidence') THEN
    CREATE TYPE "ParseConfidence" AS ENUM ('high', 'medium', 'low');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerEntryStatus') THEN
    CREATE TYPE "LedgerEntryStatus" AS ENUM ('draft', 'posted', 'needs_review', 'void');
  END IF;
END $$;

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "businessType" TEXT,
  ADD COLUMN IF NOT EXISTS "currencyCode" TEXT NOT NULL DEFAULT 'GHS',
  ADD COLUMN IF NOT EXISTS "enabledPaymentMethods" JSONB,
  ADD COLUMN IF NOT EXISTS "onboardingVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "rawInputText" TEXT,
  ADD COLUMN IF NOT EXISTS "parseConfidence" "ParseConfidence" NOT NULL DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS "requiresReview" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "interpretedFields" JSONB,
  ADD COLUMN IF NOT EXISTS "ledgerPostingStatus" "LedgerPostingStatus" NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierId" TEXT,
  ADD COLUMN IF NOT EXISTS "productServiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "businessCategoryId" TEXT;

CREATE TABLE IF NOT EXISTS "BusinessCategory" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "BusinessCategoryKind" NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ProductService" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "categoryId" TEXT REFERENCES "BusinessCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "type" "ProductServiceType" NOT NULL DEFAULT 'product',
  "defaultPrice" DOUBLE PRECISION,
  "estimatedCost" DOUBLE PRECISION,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Customer" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "phoneNumber" TEXT,
  "notes" TEXT,
  "openingReceivable" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "phoneNumber" TEXT,
  "supplyType" TEXT,
  "notes" TEXT,
  "openingPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "LedgerAccount" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "accountType" "LedgerAccountType" NOT NULL,
  "isSystemDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "parentId" TEXT REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "LedgerJournalEntry" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "transactionId" TEXT REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "status" "LedgerEntryStatus" NOT NULL DEFAULT 'draft',
  "source" TEXT NOT NULL DEFAULT 'system',
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "LedgerJournalLine" (
  "id" TEXT PRIMARY KEY,
  "entryId" TEXT NOT NULL REFERENCES "LedgerJournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "debitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "creditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessCategory_businessId_kind_normalizedName_key"
  ON "BusinessCategory"("businessId", "kind", "normalizedName");
CREATE INDEX IF NOT EXISTS "BusinessCategory_businessId_kind_isActive_idx"
  ON "BusinessCategory"("businessId", "kind", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductService_businessId_normalizedName_key"
  ON "ProductService"("businessId", "normalizedName");
CREATE INDEX IF NOT EXISTS "ProductService_businessId_type_isActive_idx"
  ON "ProductService"("businessId", "type", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_businessId_normalizedName_key"
  ON "Customer"("businessId", "normalizedName");
CREATE INDEX IF NOT EXISTS "Customer_businessId_isActive_idx"
  ON "Customer"("businessId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_businessId_normalizedName_key"
  ON "Supplier"("businessId", "normalizedName");
CREATE INDEX IF NOT EXISTS "Supplier_businessId_isActive_idx"
  ON "Supplier"("businessId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "LedgerAccount_businessId_code_key"
  ON "LedgerAccount"("businessId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerAccount_businessId_normalizedName_key"
  ON "LedgerAccount"("businessId", "normalizedName");
CREATE INDEX IF NOT EXISTS "LedgerAccount_businessId_accountType_isActive_idx"
  ON "LedgerAccount"("businessId", "accountType", "isActive");

CREATE INDEX IF NOT EXISTS "LedgerJournalEntry_businessId_entryDate_idx"
  ON "LedgerJournalEntry"("businessId", "entryDate");
CREATE INDEX IF NOT EXISTS "LedgerJournalEntry_transactionId_idx"
  ON "LedgerJournalEntry"("transactionId");
CREATE INDEX IF NOT EXISTS "LedgerJournalLine_entryId_idx"
  ON "LedgerJournalLine"("entryId");
CREATE INDEX IF NOT EXISTS "LedgerJournalLine_accountId_idx"
  ON "LedgerJournalLine"("accountId");

CREATE INDEX IF NOT EXISTS "Transaction_businessId_customerId_idx"
  ON "Transaction"("businessId", "customerId");
CREATE INDEX IF NOT EXISTS "Transaction_businessId_supplierId_idx"
  ON "Transaction"("businessId", "supplierId");
CREATE INDEX IF NOT EXISTS "Transaction_businessId_productServiceId_idx"
  ON "Transaction"("businessId", "productServiceId");
CREATE INDEX IF NOT EXISTS "Transaction_businessId_businessCategoryId_idx"
  ON "Transaction"("businessId", "businessCategoryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Transaction' AND constraint_name = 'Transaction_customerId_fkey'
  ) THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Transaction' AND constraint_name = 'Transaction_supplierId_fkey'
  ) THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Transaction' AND constraint_name = 'Transaction_productServiceId_fkey'
  ) THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_productServiceId_fkey"
      FOREIGN KEY ("productServiceId") REFERENCES "ProductService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Transaction' AND constraint_name = 'Transaction_businessCategoryId_fkey'
  ) THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessCategoryId_fkey"
      FOREIGN KEY ("businessCategoryId") REFERENCES "BusinessCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill business-level profile metadata from owner user where possible.
UPDATE "Business" b
SET
  "businessType" = COALESCE(b."businessType", u."businessType"),
  "currencyCode" = COALESCE(NULLIF(b."currencyCode", ''), u."currencyCode", 'GHS')
FROM "User" u
WHERE u."id" = b."ownerUserId";

-- Ensure every business has at least baseline categories.
INSERT INTO "BusinessCategory" ("id", "businessId", "kind", "name", "normalizedName", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT
  concat('cat_sales_', b."id"),
  b."id",
  'sales',
  'General sales',
  'general sales',
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Business" b
ON CONFLICT ("businessId", "kind", "normalizedName") DO NOTHING;

INSERT INTO "BusinessCategory" ("id", "businessId", "kind", "name", "normalizedName", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT
  concat('cat_expense_', b."id"),
  b."id",
  'expense',
  'Operating expenses',
  'operating expenses',
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Business" b
ON CONFLICT ("businessId", "kind", "normalizedName") DO NOTHING;

-- Ensure every business has baseline ledger accounts.
WITH defaults AS (
  SELECT * FROM (
    VALUES
      ('1000', 'Cash', 'cash', 'asset'::"LedgerAccountType"),
      ('1010', 'Mobile Money', 'mobile money', 'asset'::"LedgerAccountType"),
      ('1020', 'Bank', 'bank', 'asset'::"LedgerAccountType"),
      ('1100', 'Accounts Receivable', 'accounts receivable', 'asset'::"LedgerAccountType"),
      ('1200', 'Inventory Supplies', 'inventory supplies', 'asset'::"LedgerAccountType"),
      ('2000', 'Accounts Payable', 'accounts payable', 'liability'::"LedgerAccountType"),
      ('2100', 'Customer Deposits', 'customer deposits', 'liability'::"LedgerAccountType"),
      ('2200', 'Loan Payable', 'loan payable', 'liability'::"LedgerAccountType"),
      ('3000', 'Owner Capital', 'owner capital', 'equity'::"LedgerAccountType"),
      ('3100', 'Owner Drawings', 'owner drawings', 'equity'::"LedgerAccountType"),
      ('4000', 'Sales Revenue', 'sales revenue', 'income'::"LedgerAccountType"),
      ('4010', 'Service Revenue', 'service revenue', 'income'::"LedgerAccountType"),
      ('5000', 'Cost of Sales', 'cost of sales', 'expense'::"LedgerAccountType"),
      ('6000', 'Operating Expenses', 'operating expenses', 'expense'::"LedgerAccountType")
  ) AS t("code", "name", "normalizedName", "accountType")
)
INSERT INTO "LedgerAccount" (
  "id",
  "businessId",
  "code",
  "name",
  "normalizedName",
  "accountType",
  "isSystemDefault",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  concat('acct_', b."id", '_', d."code"),
  b."id",
  d."code",
  d."name",
  d."normalizedName",
  d."accountType",
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Business" b
CROSS JOIN defaults d
ON CONFLICT ("businessId", "code") DO NOTHING;
