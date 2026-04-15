import type { Transaction } from '@prisma/client';

export interface SummaryPayload {
  totalRevenue: number;
  totalExpenses: number;
  profit: number;
  transactionCount: number;
  categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }>;
  dailyBreakdown: Array<{ date: string; revenue: number; expenses: number }>;
}

const normalizeDateKey = (date: Date): string => date.toISOString().slice(0, 10);

export function computeSummary(transactions: Transaction[]): SummaryPayload {
  const totalRevenue = transactions
    .filter((tx) => tx.type === 'revenue')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpenses = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const profit = totalRevenue - totalExpenses;
  const transactionCount = transactions.length;

  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};

  for (const transaction of transactions) {
    const category = transaction.category ?? 'Uncategorized';
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { revenue: 0, expense: 0, total: 0 };
    }

    if (transaction.type === 'revenue') {
      categoryBreakdown[category].revenue += transaction.amount;
      categoryBreakdown[category].total += transaction.amount;
    } else {
      categoryBreakdown[category].expense += transaction.amount;
      categoryBreakdown[category].total -= transaction.amount;
    }

    const key = normalizeDateKey(transaction.date);
    if (!dailyMap[key]) {
      dailyMap[key] = { revenue: 0, expenses: 0 };
    }

    if (transaction.type === 'revenue') {
      dailyMap[key].revenue += transaction.amount;
    } else {
      dailyMap[key].expenses += transaction.amount;
    }
  }

  const dailyBreakdown = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, revenue: values.revenue, expenses: values.expenses }));

  return {
    totalRevenue,
    totalExpenses,
    profit,
    transactionCount,
    categoryBreakdown,
    dailyBreakdown
  };
}
