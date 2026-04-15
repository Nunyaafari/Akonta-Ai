-- CreateEnum
CREATE TYPE "CustomLineItemKind" AS ENUM ('inflow', 'expense');

-- CreateTable
CREATE TABLE "CustomLineItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CustomLineItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomLineItem_userId_kind_idx" ON "CustomLineItem"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CustomLineItem_userId_kind_normalizedLabel_key" ON "CustomLineItem"("userId", "kind", "normalizedLabel");

-- AddForeignKey
ALTER TABLE "CustomLineItem" ADD CONSTRAINT "CustomLineItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
