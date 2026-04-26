import type { Budget, Transaction } from '@prisma/client';
import db from '../lib/db.js';

export interface TargetStatusInsight {
  revenueTarget?: number;
  expenseTarget?: number;
  profitTarget?: number;
  actualRevenue: number;
  actualExpenses: number;
  actualProfit: number;
  expectedRevenueToDate?: number;
  expectedExpensesToDate?: number;
  revenueGapToDate?: number;
  expenseVarianceToDate?: number;
  profitGap?: number;
  revenueStatus?: 'ahead' | 'behind' | 'onTrack';
  expenseStatus?: 'over' | 'within' | 'onTrack';
  profitStatus?: 'above' | 'below' | 'onTrack';
}

export interface ExpenseOverrunInsight {
  isOverrun: boolean;
  expectedByNow?: number;
  actualByNow: number;
  varianceByNow?: number;
  overrunCategories: Array<{
    category: string;
    target: number;
    actual: number;
    variance: number;
  }>;
  topExpenseCategories: Array<{
    category: string;
    amount: number;
  }>;
}

export interface CreditReadinessInsight {
  score: number;
  level: 'poor' | 'fair' | 'good' | 'strong';
  consistencyRatio: number;
  classificationRatio: number;
  personalSeparationRatio: number;
  creditTrackingRatio: number;
  daysWithRecords: number;
  expectedRecordDays: number;
}

export interface MonthlyInsights {
  period: {
    year: number;
    month: number;
    periodStart: string;
    periodEnd: string;
    daysElapsed: number;
    daysInMonth: number;
  };
  targetStatus: TargetStatusInsight;
  expenseOverrun: ExpenseOverrunInsight;
  creditReadiness: CreditReadinessInsight;
  highlights: string[];
}

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const startOfUtcMonth = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));
const endOfUtcMonth = (year: number, month: number) => {
  const next = new Date(Date.UTC(year, month, 1));
  next.setMilliseconds(next.getMilliseconds() - 1);
  return next;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  GHS: 'en-GH',
  NGN: 'en-NG',
  KES: 'en-KE',
  UGX: 'en-UG',
  TZS: 'sw-TZ',
  XOF: 'fr-CI',
  XAF: 'fr-CM',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB'
};
const formatCurrency = (amount: number, currencyCode?: string): string => {
  const normalized = currencyCode?.trim().toUpperCase() || 'GHS';
  const locale = CURRENCY_LOCALE_MAP[normalized] ?? 'en-GH';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${normalized} ${amount.toFixed(2)}`;
  }
};

const sumAmount = (rows: Transaction[]) => rows.reduce((sum, row) => sum + row.amount, 0);

const isBusinessExpense = (transaction: Transaction): boolean => {
  if (transaction.type !== 'expense') return false;
  if (transaction.eventType === 'owner_withdrawal' || transaction.eventType === 'loan_repayment') return false;
  const category = (transaction.category ?? '').toLowerCase();
  return !/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category);
};

const groupExpenseCategories = (transactions: Transaction[]) => {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (!isBusinessExpense(tx)) continue;
    const key = tx.category?.trim() || 'Uncategorized';
    map.set(key, (map.get(key) ?? 0) + tx.amount);
  }
  return map;
};

const resolvePrimaryTarget = (budgets: Budget[], targetType: 'revenue' | 'expense'): number | undefined => {
  const sameType = budgets.filter((budget) => budget.targetType === targetType);
  if (sameType.length === 0) return undefined;
  const global = sameType.find((budget) => !budget.category);
  if (global) return global.amount;
  return sameType.reduce((sum, budget) => sum + budget.amount, 0);
};

const computeTargetStatus = (params: {
  transactions: Transaction[];
  budgets: Budget[];
  daysElapsed: number;
  daysInMonth: number;
}): TargetStatusInsight => {
  const revenueTx = params.transactions.filter((tx) => tx.type === 'revenue');
  const expenseTx = params.transactions.filter((tx) => isBusinessExpense(tx));
  const actualRevenue = sumAmount(revenueTx);
  const actualExpenses = sumAmount(expenseTx);
  const actualProfit = actualRevenue - actualExpenses;

  const revenueTarget = resolvePrimaryTarget(params.budgets, 'revenue');
  const expenseTarget = resolvePrimaryTarget(params.budgets, 'expense');
  const profitTarget =
    revenueTarget !== undefined && expenseTarget !== undefined
      ? revenueTarget - expenseTarget
      : undefined;

  const expectedRevenueToDate =
    revenueTarget !== undefined ? (revenueTarget * params.daysElapsed) / params.daysInMonth : undefined;
  const expectedExpensesToDate =
    expenseTarget !== undefined ? (expenseTarget * params.daysElapsed) / params.daysInMonth : undefined;

  const revenueGapToDate =
    expectedRevenueToDate !== undefined ? actualRevenue - expectedRevenueToDate : undefined;
  const expenseVarianceToDate =
    expectedExpensesToDate !== undefined ? actualExpenses - expectedExpensesToDate : undefined;
  const profitGap = profitTarget !== undefined ? actualProfit - profitTarget : undefined;

  const revenueStatus =
    revenueGapToDate === undefined
      ? undefined
      : revenueGapToDate < -0.5
        ? 'behind'
        : revenueGapToDate > 0.5
          ? 'ahead'
          : 'onTrack';

  const expenseStatus =
    expenseVarianceToDate === undefined
      ? undefined
      : expenseVarianceToDate > 0.5
        ? 'over'
        : expenseVarianceToDate < -0.5
          ? 'within'
          : 'onTrack';

  const profitStatus =
    profitGap === undefined
      ? undefined
      : profitGap < -0.5
        ? 'below'
        : profitGap > 0.5
          ? 'above'
          : 'onTrack';

  return {
    revenueTarget,
    expenseTarget,
    profitTarget,
    actualRevenue,
    actualExpenses,
    actualProfit,
    expectedRevenueToDate,
    expectedExpensesToDate,
    revenueGapToDate,
    expenseVarianceToDate,
    profitGap,
    revenueStatus,
    expenseStatus,
    profitStatus
  };
};

const computeExpenseOverrun = (params: {
  transactions: Transaction[];
  budgets: Budget[];
  targetStatus: TargetStatusInsight;
}): ExpenseOverrunInsight => {
  const expenseTx = params.transactions.filter((tx) => isBusinessExpense(tx));
  const categoryTotals = groupExpenseCategories(expenseTx);
  const topExpenseCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));

  const expenseBudgetsByCategory = params.budgets.filter(
    (budget) => budget.targetType === 'expense' && budget.category
  );

  const overrunCategories = expenseBudgetsByCategory
    .map((budget) => {
      const category = budget.category as string;
      const actual = categoryTotals.get(category) ?? 0;
      const variance = actual - budget.amount;
      return {
        category,
        target: budget.amount,
        actual,
        variance
      };
    })
    .filter((entry) => entry.variance > 0.5)
    .sort((a, b) => b.variance - a.variance);

  const varianceByNow = params.targetStatus.expenseVarianceToDate;

  return {
    isOverrun: (varianceByNow ?? 0) > 0.5 || overrunCategories.length > 0,
    expectedByNow: params.targetStatus.expectedExpensesToDate,
    actualByNow: params.targetStatus.actualExpenses,
    varianceByNow,
    overrunCategories,
    topExpenseCategories
  };
};

const countDaysWithRecords = (transactions: Transaction[]) => {
  const days = new Set<string>();
  for (const tx of transactions) {
    days.add(toIsoDate(tx.date));
  }
  return days.size;
};

const computeCreditReadiness = (params: {
  transactions: Transaction[];
  daysElapsed: number;
}): CreditReadinessInsight => {
  const txs = params.transactions;
  const daysWithRecords = countDaysWithRecords(txs);
  const expectedRecordDays = Math.max(1, params.daysElapsed);
  const consistencyRatio = clamp(daysWithRecords / expectedRecordDays, 0, 1);

  const classifiedCount = txs.filter((tx) => Boolean(tx.category && tx.category.trim())).length;
  const classificationRatio = txs.length === 0 ? 0 : clamp(classifiedCount / txs.length, 0, 1);

  const personalExpenseTx = txs.filter((tx) => tx.type === 'expense');
  const wellSeparated = personalExpenseTx.filter((tx) => {
    const category = (tx.category ?? '').toLowerCase();
    const hasPersonalWord = /(personal|owner|family|home|private|withdraw)/i.test(category);
    return !hasPersonalWord || tx.eventType === 'owner_withdrawal';
  }).length;
  const personalSeparationRatio =
    personalExpenseTx.length === 0 ? 1 : clamp(wellSeparated / personalExpenseTx.length, 0, 1);

  const creditSalesCount = txs.filter((tx) => tx.eventType === 'credit_sale').length;
  const debtRecoveryCount = txs.filter((tx) => tx.eventType === 'debtor_recovery').length;
  const creditTrackingRatio =
    creditSalesCount === 0 ? 1 : clamp(debtRecoveryCount / creditSalesCount, 0, 1);

  const weighted =
    consistencyRatio * 35 +
    classificationRatio * 25 +
    personalSeparationRatio * 20 +
    creditTrackingRatio * 20;
  const score = Math.round(clamp(weighted, 0, 100));
  const level: CreditReadinessInsight['level'] =
    score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';

  return {
    score,
    level,
    consistencyRatio,
    classificationRatio,
    personalSeparationRatio,
    creditTrackingRatio,
    daysWithRecords,
    expectedRecordDays
  };
};

const buildHighlights = (insights: {
  targetStatus: TargetStatusInsight;
  expenseOverrun: ExpenseOverrunInsight;
  creditReadiness: CreditReadinessInsight;
}, currencyCode?: string): string[] => {
  const lines: string[] = [];

  if (insights.targetStatus.revenueStatus === 'behind' && insights.targetStatus.revenueGapToDate !== undefined) {
    lines.push(`Sales are below month-to-date target by ${formatCurrency(Math.abs(insights.targetStatus.revenueGapToDate), currencyCode)}.`);
  }

  if (insights.expenseOverrun.isOverrun && insights.expenseOverrun.varianceByNow !== undefined) {
    lines.push(`Expenses are above expected pace by ${formatCurrency(insights.expenseOverrun.varianceByNow, currencyCode)}.`);
  }

  if (insights.expenseOverrun.overrunCategories.length > 0) {
    const top = insights.expenseOverrun.overrunCategories[0];
    lines.push(`${top.category} is over budget by ${formatCurrency(top.variance, currencyCode)}.`);
  }

  if (insights.creditReadiness.level === 'strong') {
    lines.push('Credit-readiness is strong based on record consistency and classification quality.');
  } else if (insights.creditReadiness.level === 'poor' || insights.creditReadiness.level === 'fair') {
    lines.push('Credit-readiness needs improvement. Focus on daily record completion and clean categorization.');
  }

  if (lines.length === 0) {
    lines.push('Your records are on track this month. Keep logging consistently.');
  }

  return lines;
};

export const getMonthlyInsights = async (params: {
  businessId: string;
  userId?: string;
  year: number;
  month: number;
  now?: Date;
}): Promise<MonthlyInsights> => {
  const periodStart = startOfUtcMonth(params.year, params.month);
  const periodEnd = endOfUtcMonth(params.year, params.month);

  const now = params.now ?? new Date();
  const isCurrentPeriod = now >= periodStart && now <= periodEnd;
  const effectivePeriodEnd = isCurrentPeriod ? now : periodEnd;
  const daysInMonth = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate();
  const elapsedDate = isCurrentPeriod ? now : periodEnd;
  const daysElapsed = clamp(elapsedDate.getUTCDate(), 1, daysInMonth);

  const [transactions, budgets, user] = await Promise.all([
    db.transaction.findMany({
      where: {
        businessId: params.businessId,
        status: 'confirmed',
        correctionOfId: null,
        isDeleted: false,
        date: {
          gte: periodStart,
          lte: effectivePeriodEnd
        }
      }
    }),
    db.budget.findMany({
      where: {
        businessId: params.businessId,
        periodType: 'monthly',
        periodStart
      }
    }),
    params.userId
      ? db.user.findUnique({
        where: { id: params.userId },
        select: { currencyCode: true }
      })
      : Promise.resolve(null)
  ]);

  const targetStatus = computeTargetStatus({
    transactions,
    budgets,
    daysElapsed,
    daysInMonth
  });

  const expenseOverrun = computeExpenseOverrun({
    transactions,
    budgets,
    targetStatus
  });

  const creditReadiness = computeCreditReadiness({
    transactions,
    daysElapsed
  });

  const highlights = buildHighlights({
    targetStatus,
    expenseOverrun,
    creditReadiness
  }, user?.currencyCode);

  return {
    period: {
      year: params.year,
      month: params.month,
      periodStart: periodStart.toISOString(),
      periodEnd: effectivePeriodEnd.toISOString(),
      daysElapsed,
      daysInMonth
    },
    targetStatus,
    expenseOverrun,
    creditReadiness,
    highlights
  };
};
