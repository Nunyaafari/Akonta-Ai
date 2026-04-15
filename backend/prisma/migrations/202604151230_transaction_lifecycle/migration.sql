-- CreateEnum
CREATE TYPE "TransactionEventType" AS ENUM ('cash_sale', 'momo_sale', 'credit_sale', 'debtor_recovery', 'stock_purchase', 'operating_expense', 'owner_withdrawal', 'loan_received', 'loan_repayment', 'supplier_credit', 'capital_introduced', 'other');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('draft', 'confirmed');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "correctionOfId" TEXT,
ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "eventType" "TransactionEventType" NOT NULL DEFAULT 'other',
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'confirmed';

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

