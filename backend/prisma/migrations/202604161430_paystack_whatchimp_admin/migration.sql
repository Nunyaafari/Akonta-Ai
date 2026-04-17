-- AlterEnum
ALTER TYPE "WhatsAppProvider" ADD VALUE IF NOT EXISTS 'whatchimp';

-- CreateEnum
CREATE TYPE "SubscriptionPaymentProvider" AS ENUM ('paystack');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('pending', 'successful', 'failed');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AppConfig"
ADD COLUMN IF NOT EXISTS "paystackPublicKey" TEXT,
ADD COLUMN IF NOT EXISTS "paystackSecretKey" TEXT,
ADD COLUMN IF NOT EXISTS "paystackWebhookSecret" TEXT,
ADD COLUMN IF NOT EXISTS "paystackPremiumAmount" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN IF NOT EXISTS "paystackCurrencyCode" TEXT NOT NULL DEFAULT 'GHS',
ADD COLUMN IF NOT EXISTS "whatchimpBaseUrl" TEXT,
ADD COLUMN IF NOT EXISTS "whatchimpApiKey" TEXT,
ADD COLUMN IF NOT EXISTS "whatchimpSenderId" TEXT,
ADD COLUMN IF NOT EXISTS "whatchimpSendPath" TEXT NOT NULL DEFAULT '/api/messages/whatsapp',
ADD COLUMN IF NOT EXISTS "whatchimpAuthScheme" TEXT NOT NULL DEFAULT 'Bearer';

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "SubscriptionPaymentProvider" NOT NULL DEFAULT 'paystack',
    "reference" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'GHS',
    "monthsPurchased" INTEGER NOT NULL DEFAULT 1,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "channel" TEXT,
    "customerEmail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_reference_key" ON "SubscriptionPayment"("reference");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_userId_createdAt_idx" ON "SubscriptionPayment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ensure singleton defaults exist
INSERT INTO "AppConfig" (
  "id",
  "whatsappProvider",
  "paystackPremiumAmount",
  "paystackCurrencyCode",
  "whatchimpSendPath",
  "whatchimpAuthScheme",
  "createdAt",
  "updatedAt"
)
VALUES (
  'global',
  'twilio',
  50,
  'GHS',
  '/api/messages/whatsapp',
  'Bearer',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE
SET "whatsappProvider" = COALESCE("AppConfig"."whatsappProvider", 'twilio');
