import type { Transaction } from '@prisma/client';

export interface CashFlowSummary {
  operatingInflow: number;
  operatingOutflow: number;
  financingInflow: number;
  financingOutflow: number;
  totalCashInflow: number;
  totalCashOutflow: number;
  netCashFlow: number;
}

export interface SummaryPayload {
  totalRevenue: number;
  totalExpenses: number;
  directExpenses: number;
  indirectExpenses: number;
  nonBusinessExpenses: number;
  grossProfit: number;
  netProfit: number;
  profit: number;
  transactionCount: number;
  categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }>;
  directExpenseBreakdown: Record<string, number>;
  indirectExpenseBreakdown: Record<string, number>;
  dailyBreakdown: Array<{ date: string; revenue: number; expenses: number }>;
  cashFlow: CashFlowSummary;
}

const normalizeDateKey = (date: Date): string => date.toISOString().slice(0, 10);

type ExpenseClass = 'direct' | 'indirect' | 'non_business';

const resolveExpenseClass = (transaction: Transaction): ExpenseClass => {
  const category = (transaction.category ?? '').toLowerCase();
  if (transaction.eventType === 'stock_purchase' || transaction.eventType === 'supplier_credit') return 'direct';
  if (transaction.eventType === 'operating_expense') return 'indirect';
  if (transaction.eventType === 'owner_withdrawal' || transaction.eventType === 'loan_repayment') return 'non_business';

  if (/(stock|inventory|raw material|materials|cost of sales|cost of goods|purchase|purchases|supplier)/i.test(category)) {
    return 'direct';
  }
  if (/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category)) {
    return 'non_business';
  }
  return 'indirect';
};

const resolveRevenueCategory = (transaction: Transaction): string => {
  const fallback = transaction.category ?? 'Uncategorized';
  if (transaction.eventType === 'cash_sale') return transaction.category ?? 'Cash sale';
  if (transaction.eventType === 'momo_sale') return 'MoMo sale';
  if (transaction.eventType === 'credit_sale') return 'Credit sale';
  if (transaction.eventType === 'debtor_recovery') return 'Debtor recovery';
  if (transaction.eventType === 'capital_introduced') return 'Capital introduced';
  if (transaction.eventType === 'loan_received') return 'Loan received';
  return fallback;
};

export function computeSummary(transactions: Transaction[]): SummaryPayload {
  const totalRevenue = transactions
    .filter((tx) => tx.type === 'revenue')
    .reduce((sum, tx) => sum + tx.amount, 0);

  let directExpenses = 0;
  let indirectExpenses = 0;
  let nonBusinessExpenses = 0;
  const transactionCount = transactions.length;

  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const directExpenseBreakdown: Record<string, number> = {};
  const indirectExpenseBreakdown: Record<string, number> = {};
  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};
  const cashFlow: CashFlowSummary = {
    operatingInflow: 0,
    operatingOutflow: 0,
    financingInflow: 0,
    financingOutflow: 0,
    totalCashInflow: 0,
    totalCashOutflow: 0,
    netCashFlow: 0
  };

  for (const transaction of transactions) {
    const category = transaction.type === 'revenue'
      ? resolveRevenueCategory(transaction)
      : (transaction.category ?? 'Uncategorized');
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { revenue: 0, expense: 0, total: 0 };
    }

    if (transaction.type === 'revenue') {
      categoryBreakdown[category].revenue += transaction.amount;
      categoryBreakdown[category].total += transaction.amount;

      if (transaction.eventType === 'capital_introduced' || transaction.eventType === 'loan_received') {
        cashFlow.financingInflow += transaction.amount;
      } else if (transaction.eventType !== 'credit_sale') {
        cashFlow.operatingInflow += transaction.amount;
      }
    } else {
      categoryBreakdown[category].expense += transaction.amount;
      categoryBreakdown[category].total -= transaction.amount;

      const expenseClass = resolveExpenseClass(transaction);
      if (expenseClass === 'direct') {
        directExpenses += transaction.amount;
        directExpenseBreakdown[category] = (directExpenseBreakdown[category] ?? 0) + transaction.amount;
      } else if (expenseClass === 'indirect') {
        indirectExpenses += transaction.amount;
        indirectExpenseBreakdown[category] = (indirectExpenseBreakdown[category] ?? 0) + transaction.amount;
      } else {
        nonBusinessExpenses += transaction.amount;
      }

      if (transaction.eventType === 'owner_withdrawal' || transaction.eventType === 'loan_repayment') {
        cashFlow.financingOutflow += transaction.amount;
      } else if (transaction.eventType !== 'supplier_credit') {
        cashFlow.operatingOutflow += transaction.amount;
      }
    }

    const key = normalizeDateKey(transaction.date);
    if (!dailyMap[key]) {
      dailyMap[key] = { revenue: 0, expenses: 0 };
    }

    if (transaction.type === 'revenue') {
      dailyMap[key].revenue += transaction.amount;
    } else {
      const expenseClass = resolveExpenseClass(transaction);
      if (expenseClass !== 'non_business') {
        dailyMap[key].expenses += transaction.amount;
      }
    }
  }

  cashFlow.totalCashInflow = cashFlow.operatingInflow + cashFlow.financingInflow;
  cashFlow.totalCashOutflow = cashFlow.operatingOutflow + cashFlow.financingOutflow;
  cashFlow.netCashFlow = cashFlow.totalCashInflow - cashFlow.totalCashOutflow;

  const totalExpenses = directExpenses + indirectExpenses;
  const grossProfit = totalRevenue - directExpenses;
  const netProfit = grossProfit - indirectExpenses;

  const dailyBreakdown = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, revenue: values.revenue, expenses: values.expenses }));

  return {
    totalRevenue,
    totalExpenses,
    directExpenses,
    indirectExpenses,
    nonBusinessExpenses,
    grossProfit,
    netProfit,
    profit: netProfit,
    transactionCount,
    categoryBreakdown,
    directExpenseBreakdown,
    indirectExpenseBreakdown,
    dailyBreakdown,
    cashFlow
  };
}
