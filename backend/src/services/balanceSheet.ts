import type { LedgerAccountType, PrismaClient, Prisma } from '@prisma/client';

type DbLike = PrismaClient | Prisma.TransactionClient;

type SectionType = 'asset' | 'liability' | 'equity';

interface BalanceSheetLine {
  accountId: string;
  code: string;
  name: string;
  accountType: LedgerAccountType;
  balance: number;
}

interface BalanceSheetSection {
  lines: BalanceSheetLine[];
  total: number;
}

export interface BalanceSheetSnapshot {
  asOf: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  currentEarnings: {
    balance: number;
  };
  totals: {
    assets: number;
    liabilities: number;
    equityBeforeEarnings: number;
    equityAfterEarnings: number;
    liabilitiesAndEquity: number;
  };
}

const roundAmount = (value: number): number => Math.round(value * 100) / 100;

const toSignedBalance = (accountType: LedgerAccountType, debitAmount: number, creditAmount: number): number => {
  if (accountType === 'asset' || accountType === 'expense') {
    return roundAmount(debitAmount - creditAmount);
  }
  return roundAmount(creditAmount - debitAmount);
};

export const computeBalanceSheetSnapshot = async (
  tx: DbLike,
  params: { businessId: string; asOf?: Date }
): Promise<BalanceSheetSnapshot> => {
  const asOf = params.asOf ?? new Date();

  const rows = await tx.ledgerJournalLine.findMany({
    where: {
      entry: {
        businessId: params.businessId,
        status: 'posted',
        entryDate: {
          lte: asOf
        }
      }
    },
    include: {
      account: true
    }
  });

  const grouped = new Map<string, BalanceSheetLine & { debitTotal: number; creditTotal: number }>();

  rows.forEach((row) => {
    const existing = grouped.get(row.accountId);
    if (existing) {
      existing.debitTotal += row.debitAmount;
      existing.creditTotal += row.creditAmount;
      existing.balance = toSignedBalance(existing.accountType, existing.debitTotal, existing.creditTotal);
      return;
    }

    grouped.set(row.accountId, {
      accountId: row.account.id,
      code: row.account.code,
      name: row.account.name,
      accountType: row.account.accountType,
      debitTotal: row.debitAmount,
      creditTotal: row.creditAmount,
      balance: toSignedBalance(row.account.accountType, row.debitAmount, row.creditAmount)
    });
  });

  const values = Array.from(grouped.values());
  const sectionOrder: SectionType[] = ['asset', 'liability', 'equity'];
  const sections: Record<SectionType, BalanceSheetSection> = {
    asset: { lines: [], total: 0 },
    liability: { lines: [], total: 0 },
    equity: { lines: [], total: 0 }
  };

  let incomeTotal = 0;
  let expenseTotal = 0;

  values.forEach((entry) => {
    if (entry.accountType === 'income') {
      incomeTotal += entry.balance;
      return;
    }
    if (entry.accountType === 'expense') {
      expenseTotal += entry.balance;
      return;
    }
    if (entry.balance === 0) return;

    const section = sections[entry.accountType as SectionType];
    section.lines.push({
      accountId: entry.accountId,
      code: entry.code,
      name: entry.name,
      accountType: entry.accountType,
      balance: roundAmount(entry.balance)
    });
    section.total = roundAmount(section.total + entry.balance);
  });

  sectionOrder.forEach((type) => {
    sections[type].lines.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
    sections[type].total = roundAmount(sections[type].lines.reduce((sum, line) => sum + line.balance, 0));
  });

  const currentEarnings = roundAmount(incomeTotal - expenseTotal);
  const liabilitiesAndEquity = roundAmount(sections.liability.total + sections.equity.total + currentEarnings);

  return {
    asOf: asOf.toISOString(),
    assets: sections.asset,
    liabilities: sections.liability,
    equity: sections.equity,
    currentEarnings: {
      balance: currentEarnings
    },
    totals: {
      assets: roundAmount(sections.asset.total),
      liabilities: roundAmount(sections.liability.total),
      equityBeforeEarnings: roundAmount(sections.equity.total),
      equityAfterEarnings: roundAmount(sections.equity.total + currentEarnings),
      liabilitiesAndEquity
    }
  };
};
