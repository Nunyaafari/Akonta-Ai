import type { PrismaClient, Prisma, Transaction, TransactionEventType, LedgerPostingStatus } from '@prisma/client';

type DbLike = PrismaClient | Prisma.TransactionClient;

const CASH_ACCOUNT_CODE = '1000';
const MOMO_ACCOUNT_CODE = '1010';
const ACCOUNTS_RECEIVABLE_CODE = '1100';
const INVENTORY_CODE = '1200';
const ACCOUNTS_PAYABLE_CODE = '2000';
const LOAN_PAYABLE_CODE = '2200';
const OWNER_CAPITAL_CODE = '3000';
const OWNER_DRAWINGS_CODE = '3100';
const SALES_REVENUE_CODE = '4000';
const OPERATING_EXPENSES_CODE = '6000';

interface PostingLineBlueprint {
  accountCode: string;
  debitAmount: number;
  creditAmount: number;
  memo?: string;
}

interface PostingBlueprint {
  description: string;
  lines: PostingLineBlueprint[];
}

const formatEventLabel = (eventType: TransactionEventType): string => (
  eventType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
);

const roundAmount = (value: number): number => Math.round(value * 100) / 100;

const buildPostingBlueprint = (transaction: Transaction): PostingBlueprint | null => {
  const amount = roundAmount(transaction.amount);
  if (amount <= 0) return null;

  const baseDescription = formatEventLabel(transaction.eventType);
  const description = transaction.notes?.trim()
    ? `${baseDescription}: ${transaction.notes.trim()}`
    : baseDescription;

  switch (transaction.eventType) {
    case 'cash_sale':
      return {
        description,
        lines: [
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: SALES_REVENUE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'momo_sale':
      return {
        description,
        lines: [
          { accountCode: MOMO_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: SALES_REVENUE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'credit_sale':
      return {
        description,
        lines: [
          { accountCode: ACCOUNTS_RECEIVABLE_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: SALES_REVENUE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'debtor_recovery':
      return {
        description,
        lines: [
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: ACCOUNTS_RECEIVABLE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'stock_purchase':
      return {
        description,
        lines: [
          { accountCode: INVENTORY_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'operating_expense':
      return {
        description,
        lines: [
          { accountCode: OPERATING_EXPENSES_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'owner_withdrawal':
      return {
        description,
        lines: [
          { accountCode: OWNER_DRAWINGS_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'loan_received':
      return {
        description,
        lines: [
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: LOAN_PAYABLE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'loan_repayment':
      return {
        description,
        lines: [
          { accountCode: LOAN_PAYABLE_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'supplier_credit':
      return {
        description,
        lines: [
          { accountCode: INVENTORY_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: ACCOUNTS_PAYABLE_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'capital_introduced':
      return {
        description,
        lines: [
          { accountCode: CASH_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
          { accountCode: OWNER_CAPITAL_CODE, debitAmount: 0, creditAmount: amount }
        ]
      };
    case 'other':
    default:
      return transaction.type === 'revenue'
        ? {
            description,
            lines: [
              { accountCode: CASH_ACCOUNT_CODE, debitAmount: amount, creditAmount: 0 },
              { accountCode: SALES_REVENUE_CODE, debitAmount: 0, creditAmount: amount }
            ]
          }
        : {
            description,
            lines: [
              { accountCode: OPERATING_EXPENSES_CODE, debitAmount: amount, creditAmount: 0 },
              { accountCode: CASH_ACCOUNT_CODE, debitAmount: 0, creditAmount: amount }
            ]
          };
  }
};

const clearJournalEntriesForTransaction = async (
  tx: DbLike,
  params: { transactionId: string; postingStatus: LedgerPostingStatus }
) => {
  await tx.ledgerJournalEntry.deleteMany({
    where: { transactionId: params.transactionId }
  });

  await tx.transaction.update({
    where: { id: params.transactionId },
    data: { ledgerPostingStatus: params.postingStatus }
  });
};

export const syncTransactionLedgerState = async (
  tx: DbLike,
  params: { transactionId: string }
) => {
  const transaction = await tx.transaction.findUnique({
    where: { id: params.transactionId }
  });

  if (!transaction) return null;

  if (!transaction.businessId) {
    await clearJournalEntriesForTransaction(tx, {
      transactionId: transaction.id,
      postingStatus: 'not_configured'
    });
    return null;
  }

  if (transaction.status !== 'confirmed' || transaction.isDeleted) {
    await clearJournalEntriesForTransaction(tx, {
      transactionId: transaction.id,
      postingStatus: 'skipped'
    });
    return null;
  }

  const blueprint = buildPostingBlueprint(transaction);
  if (!blueprint) {
    await clearJournalEntriesForTransaction(tx, {
      transactionId: transaction.id,
      postingStatus: 'failed'
    });
    return null;
  }

  const requiredCodes = Array.from(new Set(blueprint.lines.map((line) => line.accountCode)));
  const accounts = await tx.ledgerAccount.findMany({
    where: {
      businessId: transaction.businessId,
      isActive: true,
      code: { in: requiredCodes }
    }
  });

  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const hasAllAccounts = requiredCodes.every((code) => accountByCode.has(code));
  if (!hasAllAccounts) {
    await clearJournalEntriesForTransaction(tx, {
      transactionId: transaction.id,
      postingStatus: 'not_configured'
    });
    return null;
  }

  await tx.ledgerJournalEntry.deleteMany({
    where: { transactionId: transaction.id }
  });

  const debitTotal = roundAmount(blueprint.lines.reduce((sum, line) => sum + line.debitAmount, 0));
  const creditTotal = roundAmount(blueprint.lines.reduce((sum, line) => sum + line.creditAmount, 0));
  if (debitTotal !== creditTotal) {
    await tx.transaction.update({
      where: { id: transaction.id },
      data: { ledgerPostingStatus: 'failed' }
    });
    return null;
  }

  const entry = await tx.ledgerJournalEntry.create({
    data: {
      businessId: transaction.businessId,
      transactionId: transaction.id,
      entryDate: transaction.date,
      description: blueprint.description,
      status: transaction.requiresReview ? 'needs_review' : 'posted',
      source: `transaction:${transaction.eventType}`,
      createdByUserId: transaction.createdByUserId,
      approvedByUserId: transaction.approvedByUserId,
      lines: {
        create: blueprint.lines.map((line) => ({
          accountId: accountByCode.get(line.accountCode)!.id,
          debitAmount: roundAmount(line.debitAmount),
          creditAmount: roundAmount(line.creditAmount),
          memo: line.memo ?? transaction.notes ?? null
        }))
      }
    },
    include: {
      lines: true
    }
  });

  await tx.transaction.update({
    where: { id: transaction.id },
    data: { ledgerPostingStatus: 'posted' }
  });

  return entry;
};
