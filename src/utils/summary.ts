import { Transaction, SummaryPayload } from '../types';

type ExpenseClass = 'direct' | 'indirect' | 'non_business';
type CashFlowBucket = 'operating_inflow' | 'operating_outflow' | 'financing_inflow' | 'financing_outflow' | 'non_cash';

const resolveExpenseClass = (tx: Transaction): ExpenseClass => {
  const category = (tx.category ?? '').toLowerCase();
  if (tx.eventType === 'stock_purchase' || tx.eventType === 'supplier_credit') return 'direct';
  if (tx.eventType === 'operating_expense') return 'indirect';
  if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') return 'non_business';
  if (/(stock|inventory|raw material|materials|cost of sales|cost of goods|purchase|purchases|supplier)/i.test(category)) return 'direct';
  if (/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category)) return 'non_business';
  return 'indirect';
};

const resolveRevenueCategory = (tx: Transaction): string => {
  if (tx.eventType === 'cash_sale') return tx.category || 'Cash sale';
  if (tx.eventType === 'momo_sale') return 'MoMo sale';
  if (tx.eventType === 'credit_sale') return 'Credit sale';
  if (tx.eventType === 'debtor_recovery') return 'Debtor recovery';
  if (tx.eventType === 'capital_introduced') return 'Capital introduced';
  if (tx.eventType === 'loan_received') return 'Loan received';
  return tx.category || 'Other';
};

const classifyCashFlowBucket = (tx: Transaction): CashFlowBucket => {
  if (tx.type === 'revenue') {
    if (tx.eventType === 'credit_sale') return 'non_cash';
    if (tx.eventType === 'capital_introduced' || tx.eventType === 'loan_received') return 'financing_inflow';
    return 'operating_inflow';
  }

  if (tx.eventType === 'supplier_credit') return 'non_cash';
  if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') return 'financing_outflow';
  return 'operating_outflow';
};

const resolveCashFlowLineLabel = (tx: Transaction): string => {
  if (tx.type === 'revenue') {
    if (tx.eventType === 'cash_sale') return tx.category ?? 'Cash sale';
    if (tx.eventType === 'momo_sale') return 'MoMo sale';
    if (tx.eventType === 'debtor_recovery') return 'Debtor recovery';
    if (tx.eventType === 'capital_introduced') return 'Capital introduced';
    if (tx.eventType === 'loan_received') return 'Loan received';
    return tx.category ?? 'Other inflow';
  }

  if (tx.eventType === 'stock_purchase') return tx.category ?? 'Stock purchase';
  if (tx.eventType === 'operating_expense') return tx.category ?? 'Operating expense';
  if (tx.eventType === 'owner_withdrawal') return 'Owner withdrawal';
  if (tx.eventType === 'loan_repayment') return 'Loan repayment';
  return tx.category ?? 'Other outflow';
};

export const buildCashFlowLineItems = (transactions: Transaction[]) => {
  const accumulate = (bucket: CashFlowBucket) => {
    const grouped: Record<string, number> = {};
    transactions.forEach((tx) => {
      if (classifyCashFlowBucket(tx) !== bucket) return;
      const label = resolveCashFlowLineLabel(tx);
      grouped[label] = (grouped[label] ?? 0) + tx.amount;
    });
    return Object.entries(grouped)
      .map(([label, amount]) => ({ label, amount }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  };

  return {
    operatingInflowLines: accumulate('operating_inflow'),
    operatingOutflowLines: accumulate('operating_outflow'),
    financingInflowLines: accumulate('financing_inflow'),
    financingOutflowLines: accumulate('financing_outflow')
  };
};

export const createSummaryFromTransactions = (transactions: Transaction[]): SummaryPayload => {
  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const directExpenseBreakdown: Record<string, number> = {};
  const indirectExpenseBreakdown: Record<string, number> = {};
  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};
  const cashFlow = {
    operatingInflow: 0, operatingOutflow: 0, financingInflow: 0, financingOutflow: 0,
    totalCashInflow: 0, totalCashOutflow: 0, netCashFlow: 0
  };
  let totalRevenue = 0, directExpenses = 0, indirectExpenses = 0, nonBusinessExpenses = 0;

  transactions.forEach((tx) => {
    if (tx.type === 'revenue') {
      totalRevenue += tx.amount;
      if (tx.eventType === 'capital_introduced' || tx.eventType === 'loan_received') {
        cashFlow.financingInflow += tx.amount;
      } else if (tx.eventType !== 'credit_sale') {
        cashFlow.operatingInflow += tx.amount;
      }
    } else {
      const expenseClass = resolveExpenseClass(tx);
      const category = tx.category || 'Other';
      if (expenseClass === 'direct') {
        directExpenses += tx.amount;
        directExpenseBreakdown[category] = (directExpenseBreakdown[category] ?? 0) + tx.amount;
      } else if (expenseClass === 'indirect') {
        indirectExpenses += tx.amount;
        indirectExpenseBreakdown[category] = (indirectExpenseBreakdown[category] ?? 0) + tx.amount;
      } else {
        nonBusinessExpenses += tx.amount;
      }

      if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') {
        cashFlow.financingOutflow += tx.amount;
      } else if (tx.eventType !== 'supplier_credit') {
        cashFlow.operatingOutflow += tx.amount;
      }
    }

    const category = tx.type === 'revenue' ? resolveRevenueCategory(tx) : (tx.category || 'Other');
    const categoryEntry = categoryBreakdown[category] ?? { revenue: 0, expense: 0, total: 0 };
    if (tx.type === 'revenue') categoryEntry.revenue += tx.amount;
    else categoryEntry.expense += tx.amount;
    categoryEntry.total = categoryEntry.revenue - categoryEntry.expense;
    categoryBreakdown[category] = categoryEntry;

    const txDate = new Date(tx.date);
    const dateKey = Number.isNaN(txDate.getTime()) ? new Date().toISOString().slice(0, 10) : txDate.toISOString().slice(0, 10);
    const dailyEntry = dailyMap[dateKey] ?? { revenue: 0, expenses: 0 };
    if (tx.type === 'revenue') dailyEntry.revenue += tx.amount;
    else if (resolveExpenseClass(tx) !== 'non_business') dailyEntry.expenses += tx.amount;
    dailyMap[dateKey] = dailyEntry;
  });

  cashFlow.totalCashInflow = cashFlow.operatingInflow + cashFlow.financingInflow;
  cashFlow.totalCashOutflow = cashFlow.operatingOutflow + cashFlow.financingOutflow;
  cashFlow.netCashFlow = cashFlow.totalCashInflow - cashFlow.totalCashOutflow;

  const totalExpenses = directExpenses + indirectExpenses;
  const grossProfit = totalRevenue - directExpenses;
  const netProfit = grossProfit - indirectExpenses;

  return {
    totalRevenue, totalExpenses, directExpenses, indirectExpenses, nonBusinessExpenses,
    grossProfit, netProfit, profit: netProfit, transactionCount: transactions.length,
    categoryBreakdown, directExpenseBreakdown, indirectExpenseBreakdown,
    dailyBreakdown: Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, revenue: values.revenue, expenses: values.expenses })),
    cashFlow
  };
};

export const buildProfitLossLines = (summary: SummaryPayload) => {
  const entries = Object.entries(summary.categoryBreakdown);
  const incomeLines = entries.map(([category, values]) => ({ label: category, amount: values.revenue ?? 0 }))
    .filter((line) => line.amount > 0).sort((a, b) => b.amount - a.amount);

  const directExpenseLines = Object.entries(summary.directExpenseBreakdown ?? {})
    .map(([category, amount]) => ({ label: category, amount }))
    .filter((line) => line.amount > 0).sort((a, b) => b.amount - a.amount);

  const indirectExpenseLines = Object.entries(summary.indirectExpenseBreakdown ?? {})
    .map(([category, amount]) => ({ label: category, amount }))
    .filter((line) => line.amount > 0).sort((a, b) => b.amount - a.amount);

  if (incomeLines.length === 0 && summary.totalRevenue > 0) incomeLines.push({ label: 'Business Income', amount: summary.totalRevenue });
  if (directExpenseLines.length === 0 && summary.directExpenses > 0) directExpenseLines.push({ label: 'Direct Expenses', amount: summary.directExpenses });
  if (indirectExpenseLines.length === 0 && summary.indirectExpenses > 0) indirectExpenseLines.push({ label: 'Indirect Expenses', amount: summary.indirectExpenses });

  return { incomeLines, directExpenseLines, indirectExpenseLines };
};
