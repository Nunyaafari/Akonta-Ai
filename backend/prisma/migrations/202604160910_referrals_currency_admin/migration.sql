-- CreateEnum
CREATE TYPE "WhatsAppProvider" AS ENUM ('twilio', 'infobip');

-- CreateEnum
CREATE TYPE "SubscriptionGrantSource" AS ENUM ('trial', 'paid', 'referral_bonus', 'admin_adjustment');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'GHS',
ADD COLUMN     "freeSubscriptionMonthsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByUserId" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReferralConversion" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "referralCode" TEXT,
    "qualifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "milestone" INTEGER NOT NULL,
    "qualifiedReferralsAtGrant" INTEGER NOT NULL,
    "grantedMonths" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "SubscriptionGrantSource" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "monthsGranted" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "whatsappProvider" "WhatsAppProvider" NOT NULL DEFAULT 'twilio',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "ReferralConversion_referrerId_idx" ON "ReferralConversion"("referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralConversion_referredUserId_key" ON "ReferralConversion"("referredUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_referrerId_milestone_key" ON "ReferralReward"("referrerId", "milestone");

-- CreateIndex
CREATE INDEX "ReferralReward_referrerId_createdAt_idx" ON "ReferralReward"("referrerId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionGrant_userId_createdAt_idx" ON "SubscriptionGrant"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralConversion" ADD CONSTRAINT "ReferralConversion_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralConversion" ADD CONSTRAINT "ReferralConversion_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed singleton config row
INSERT INTO "AppConfig" ("id", "whatsappProvider", "createdAt", "updatedAt")
VALUES ('global', 'twilio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
