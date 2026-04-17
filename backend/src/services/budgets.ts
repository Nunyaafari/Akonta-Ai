import type { Budget, BudgetTargetType, PeriodType, Transaction } from '@prisma/client';
import db from '../lib/db.js';

export interface BudgetStatus {
  budget: Budget;
  used: number;
  remaining: number;
  percentUsed: number;
  status: 'onTrack' | 'nearTarget' | 'overBudget';
}

const isBusinessExpense = (transaction: Transaction): boolean => {
  if (transaction.type !== 'expense') return false;
  if (transaction.eventType === 'owner_withdrawal' || transaction.eventType === 'loan_repayment') return false;
  const category = (transaction.category ?? '').toLowerCase();
  return !/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category);
};

const normalizeMonthPeriod = (year: number, month: number) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
};

export const getBudgetForPeriod = async (
  userId: string,
  periodType: PeriodType,
  periodStart: Date,
  targetType?: BudgetTargetType
): Promise<Budget | null> => {
  const where: Record<string, any> = {
    userId,
    periodType,
    periodStart
  };

  if (targetType) {
    where.targetType = targetType;
  }

  return db.budget.findFirst({ where });
};

export const getBudgetsForPeriod = async (
  userId: string,
  periodType: PeriodType,
  periodStart: Date
): Promise<Budget[]> => {
  return db.budget.findMany({
    where: { userId, periodType, periodStart }
  });
};

export const upsertBudget = async (
  userId: string,
  year: number,
  month: number,
  targetType: BudgetTargetType,
  amount: number,
  category?: string,
  notes?: string
): Promise<Budget> => {
  const { start, end } = normalizeMonthPeriod(year, month);

  const existing = await db.budget.findFirst({
    where: {
      userId,
      periodType: 'monthly',
      periodStart: start,
      targetType,
      category: category ?? null
    }
  });

  if (existing) {
    return db.budget.update({
      where: { id: existing.id },
      data: { amount, notes: notes ?? existing.notes }
    });
  }

  return db.budget.create({
    data: {
      userId,
      periodType: 'monthly',
      periodStart: start,
      periodEnd: end,
      targetType,
      amount,
      category: category ?? null,
      notes: notes ?? null
    }
  });
};

export const computeBudgetStatus = (
  budget: Budget,
  transactions: Transaction[]
): BudgetStatus => {
  const used = transactions
    .filter((tx) => {
      if (budget.targetType === 'revenue') return tx.type === 'revenue';
      return isBusinessExpense(tx);
    })
    .filter((tx) => tx.status === 'confirmed' && tx.correctionOfId === null)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const remaining = budget.amount - used;
  const percentUsed = budget.amount > 0 ? Math.min(100, (used / budget.amount) * 100) : 0;
  let status: BudgetStatus['status'] = 'onTrack';

  if (remaining < 0) {
    status = 'overBudget';
  } else if (percentUsed >= 80) {
    status = 'nearTarget';
  }

  return {
    budget,
    used,
    remaining,
    percentUsed,
    status
  };
};

export const normalizeMonthPeriodValues = normalizeMonthPeriod;
