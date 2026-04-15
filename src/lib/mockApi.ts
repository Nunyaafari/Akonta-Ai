import type { Budget, BudgetStatus, BudgetTargetType, SummaryPayload, Transaction, User, WhatsAppProvider } from '../types';
import { currentWeekSummary, currentMonthSummary, mockTransactions } from '../data/mockData';

const parseMessageToTransactions = (userId: string, message: string): Transaction[] => {
  const text = message.toLowerCase().trim();
  const now = new Date();
  const parsed: Transaction[] = [];

  const revenueMatch = text.match(/(?:made|sold|earned|received|income|revenue)[\s:-]+(\d+(?:[.,]\d+)?)/);
  const expenseMatch = text.match(/(?:spent|expense|cost|paid|bought|buy)[\s:-]+(\d+(?:[.,]\d+)?)(?:\s+on\s+(.+))?/);

  if (revenueMatch) {
    parsed.push({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      type: 'revenue',
      amount: Number(revenueMatch[1].replace(',', '.')),
      date: now,
      category: 'Sales',
      notes: undefined,
      createdAt: now,
      updatedAt: now
    });
  }

  if (expenseMatch) {
    parsed.push({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      type: 'expense',
      amount: Number(expenseMatch[1].replace(',', '.')),
      date: now,
      category: expenseMatch[2] ? expenseMatch[2].trim() : 'Expense',
      notes: expenseMatch[2]?.trim(),
      createdAt: now,
      updatedAt: now
    });
  }

  if (parsed.length === 0) {
    if (text.match(/\d+/)) {
      const amount = Number(text.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.') ?? 0);
      if (text.includes('spent') || text.includes('paid') || text.includes('cost') || text.includes('expense')) {
        parsed.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          userId,
          type: 'expense',
          amount,
          date: now,
          category: 'Expense',
          notes: undefined,
          createdAt: now,
          updatedAt: now
        });
      } else {
        parsed.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          userId,
          type: 'revenue',
          amount,
          date: now,
          category: 'Sales',
          notes: undefined,
          createdAt: now,
          updatedAt: now
        });
      }
    }
  }

  return parsed;
};

const createSummary = (transactions: Transaction[]): SummaryPayload => {
  const revenueTxs = transactions.filter((tx) => tx.type === 'revenue');
  const expenseTxs = transactions.filter((tx) => tx.type === 'expense');
  const totalRevenue = revenueTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpenses = expenseTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const profit = totalRevenue - totalExpenses;
  const transactionCount = transactions.length;

  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const dailyBreakdown: Array<{ date: string; revenue: number; expenses: number }> = [];

  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};

  for (const tx of transactions) {
    const category = tx.category ?? 'Uncategorized';
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { revenue: 0, expense: 0, total: 0 };
    }
    if (tx.type === 'revenue') {
      categoryBreakdown[category].revenue += tx.amount;
      categoryBreakdown[category].total += tx.amount;
    } else {
      categoryBreakdown[category].expense += tx.amount;
      categoryBreakdown[category].total -= tx.amount;
    }

    const dateKey = tx.date instanceof Date ? tx.date.toISOString().slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10);
    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { revenue: 0, expenses: 0 };
    }
    if (tx.type === 'revenue') {
      dailyMap[dateKey].revenue += tx.amount;
    } else {
      dailyMap[dateKey].expenses += tx.amount;
    }
  }

  Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, values]) => dailyBreakdown.push({ date, revenue: values.revenue, expenses: values.expenses }));

  return { totalRevenue, totalExpenses, profit, transactionCount, categoryBreakdown, dailyBreakdown };
};

const users: User[] = [];
const transactionsByUser: Record<string, Transaction[]> = {};
const budgetsByUser: Record<string, Budget[]> = {};

const defaultProviderInfo = {
  default: 'twilio' as WhatsAppProvider,
  available: ['twilio', 'infobip'] as WhatsAppProvider[]
};

const normalizeMonthStart = (date: Date): string => {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return utc.toISOString();
};

export const mockCreateUser = async (body: Partial<User>): Promise<User> => {
  const id = `demo-${Date.now()}`;
  const createdAt = new Date();
  const user: User = {
    id,
    name: body.name ?? 'Demo User',
    phoneNumber: body.phoneNumber ?? '233000000000',
    businessName: body.businessName ?? 'Demo Business',
    businessType: body.businessType ?? 'Trading / Retail',
    preferredTime: body.preferredTime ?? 'evening',
    timezone: body.timezone ?? 'Africa/Accra',
    subscriptionStatus: body.subscriptionStatus ?? 'trial',
    trialEndsAt: undefined,
    createdAt,
  };
  users.push(user);
  transactionsByUser[id] = [...mockTransactions.map((tx) => ({ ...tx, id: `${tx.id}-${id}`, userId: id }))];
  budgetsByUser[id] = [];
  return user;
};

export const mockGetTransactions = async (userId: string): Promise<Transaction[]> => {
  return transactionsByUser[userId] ?? [];
};

export const mockGetWeeklySummary = async (userId: string, start: string, end: string) => {
  const txs = transactionsByUser[userId] ?? [];
  return {
    periodType: 'weekly' as const,
    periodStart: start,
    periodEnd: end,
    summary: createSummary(txs.filter((tx) => {
      const date = new Date(tx.date);
      return date >= new Date(start) && date <= new Date(end);
    }))
  };
};

export const mockGetMonthlySummary = async (userId: string, year: number, month: number) => {
  const txs = transactionsByUser[userId] ?? [];
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  end.setMilliseconds(end.getMilliseconds() - 1);
  return {
    periodType: 'monthly' as const,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    summary: createSummary(txs.filter((tx) => {
      const date = new Date(tx.date);
      return date >= start && date <= end;
    }))
  };
};

export const mockPostChatEntry = async (userId: string, message: string) => {
  const parsed = parseMessageToTransactions(userId, message);
  transactionsByUser[userId] = [...(transactionsByUser[userId] ?? []), ...parsed];
  const created = parsed;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  monthEnd.setMilliseconds(monthEnd.getMilliseconds() - 1);
  const monthlyTransactions = (transactionsByUser[userId] ?? []).filter((tx) => {
    const txDate = new Date(tx.date);
    return txDate >= monthStart && txDate <= monthEnd;
  });

  const budgets = budgetsByUser[userId] ?? [];
  const budgetStatuses: BudgetStatus[] = budgets
    .filter((budget) => budget.periodStart === monthStart.toISOString())
    .map((budget) => {
      const used = monthlyTransactions
        .filter((tx) => tx.type === budget.targetType)
        .reduce((sum, tx) => sum + tx.amount, 0);
      const remaining = budget.amount - used;
      const percentUsed = budget.amount > 0 ? Math.min(100, (used / budget.amount) * 100) : 0;
      let status: BudgetStatus['status'] = 'onTrack';
      if (remaining < 0) status = 'overBudget';
      else if (percentUsed >= 80) status = 'nearTarget';
      return { budget, used, remaining, percentUsed, status };
    });

  return {
    transactions: created,
    summary: createSummary(created),
    monthlySummary: createSummary(monthlyTransactions),
    budgetStatuses
  };
};

export const mockGetCurrentBudgets = async (userId: string): Promise<Budget[]> => {
  return budgetsByUser[userId] ?? [];
};

export const mockPostBudget = async (body: {
  userId: string;
  year: number;
  month: number;
  targetType: BudgetTargetType;
  amount: number;
  category?: string;
  notes?: string;
}): Promise<Budget> => {
  const start = new Date(Date.UTC(body.year, body.month - 1, 1));
  const end = new Date(Date.UTC(body.year, body.month, 1));
  end.setMilliseconds(end.getMilliseconds() - 1);
  const userBudgets = budgetsByUser[body.userId] ?? [];
  const existingIndex = userBudgets.findIndex(
    (budget) => budget.periodStart === start.toISOString() && budget.targetType === body.targetType && budget.category === (body.category ?? null)
  );
  const budget: Budget = {
    id: existingIndex >= 0 ? userBudgets[existingIndex].id : `bdg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId: body.userId,
    periodType: 'monthly',
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    targetType: body.targetType,
    amount: body.amount,
    category: body.category,
    notes: body.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existingIndex >= 0) {
    userBudgets[existingIndex] = budget;
  } else {
    userBudgets.push(budget);
  }
  budgetsByUser[body.userId] = userBudgets;
  return budget;
};

export const mockGetWhatsAppProviderInfo = async () => defaultProviderInfo;

export const mockSendWhatsAppMessage = async (to: string, message: string, provider?: string) => {
  return { success: true, provider: provider ?? defaultProviderInfo.default, result: { message: 'Mock send queued' } };
};

export const mockHealth = async (): Promise<boolean> => true;
