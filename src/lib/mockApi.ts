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
      eventType: 'cash_sale',
      status: 'confirmed',
      amount: Number(revenueMatch[1].replace(',', '.')),
      date: now,
      category: 'Sales',
      notes: undefined,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  if (expenseMatch) {
    parsed.push({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      type: 'expense',
      eventType: 'operating_expense',
      status: 'confirmed',
      amount: Number(expenseMatch[1].replace(',', '.')),
      date: now,
      category: expenseMatch[2] ? expenseMatch[2].trim() : 'Expense',
      notes: expenseMatch[2]?.trim(),
      confirmedAt: now,
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
          eventType: 'operating_expense',
          status: 'confirmed',
          amount,
          date: now,
          category: 'Expense',
          notes: undefined,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now
        });
      } else {
        parsed.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          userId,
          type: 'revenue',
          eventType: 'cash_sale',
          status: 'confirmed',
          amount,
          date: now,
          category: 'Sales',
          notes: undefined,
          confirmedAt: now,
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
const conversationSessionsByUser: Record<
  string,
  {
    step:
      | 'idle'
      | 'ask_backfill_consent'
      | 'ask_sales'
      | 'ask_sales_type'
      | 'confirm_sales_type_custom'
      | 'ask_expense'
      | 'ask_expense_type'
      | 'confirm_expense_type_custom'
      | 'ask_expense_category'
      | 'await_confirm';
    salesDraftId?: string;
    expenseDraftId?: string;
    logDateKey?: string;
    pendingBackfillDateKey?: string;
    salesEventType?: Transaction['eventType'];
    salesCategory?: string;
    salesTypeConfirmed?: boolean;
    expenseEventType?: Transaction['eventType'];
    expenseTypeConfirmed?: boolean;
    expenseCategory?: string;
    pendingSalesTypeLabel?: string;
    pendingExpenseTypeLabel?: string;
  }
> = {};

type MockCustomLineItem = {
  label: string;
  normalizedLabel: string;
  usageCount: number;
  lastUsedAt: string;
};

const customLineItemsByUser: Record<
  string,
  {
    inflow: MockCustomLineItem[];
    expense: MockCustomLineItem[];
  }
> = {};

const defaultProviderInfo = {
  default: 'twilio' as WhatsAppProvider,
  available: ['twilio', 'infobip'] as WhatsAppProvider[]
};

const normalizeMonthStart = (date: Date): string => {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return utc.toISOString();
};

const createTransactionId = () => `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const parseDateInput = (value?: string): Date => {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
  conversationSessionsByUser[id] = { step: 'idle' };
  customLineItemsByUser[id] = { inflow: [], expense: [] };
  return user;
};

export const mockGetTransactions = async (userId: string): Promise<Transaction[]> => {
  return transactionsByUser[userId] ?? [];
};

export const mockCreateTransaction = async (body: {
  userId: string;
  type: 'revenue' | 'expense';
  eventType?: Transaction['eventType'];
  status?: Transaction['status'];
  amount: number;
  date?: string;
  category?: string;
  notes?: string;
  correctionReason?: string;
}): Promise<Transaction> => {
  const now = new Date();
  const tx: Transaction = {
    id: createTransactionId(),
    userId: body.userId,
    type: body.type,
    eventType: body.eventType ?? 'other',
    status: body.status ?? 'confirmed',
    amount: body.amount,
    date: parseDateInput(body.date),
    category: body.category,
    notes: body.notes,
    correctionReason: body.correctionReason,
    confirmedAt: (body.status ?? 'confirmed') === 'confirmed' ? now : null,
    createdAt: now,
    updatedAt: now
  };

  transactionsByUser[body.userId] = [...(transactionsByUser[body.userId] ?? []), tx];
  return tx;
};

export const mockUpdateTransaction = async (
  id: string,
  updates: {
    type?: 'revenue' | 'expense';
    eventType?: Transaction['eventType'];
    status?: Transaction['status'];
    amount?: number;
    date?: string;
    category?: string | null;
    notes?: string | null;
    correctionReason?: string | null;
  }
): Promise<Transaction> => {
  const userEntry = Object.entries(transactionsByUser).find(([, list]) => list.some((tx) => tx.id === id));
  if (!userEntry) {
    throw new Error('Transaction not found');
  }

  const [userId, list] = userEntry;
  const index = list.findIndex((tx) => tx.id === id);
  const original = list[index];
  if (!original) {
    throw new Error('Transaction not found');
  }

  const hasCoreChange =
    updates.type !== undefined ||
    updates.eventType !== undefined ||
    updates.amount !== undefined ||
    updates.date !== undefined ||
    updates.category !== undefined ||
    updates.notes !== undefined;
  if (original.status === 'confirmed' && hasCoreChange) {
    throw new Error('Confirmed transactions must be corrected first');
  }

  const nextStatus = updates.status ?? original.status ?? 'confirmed';
  const updated: Transaction = {
    ...original,
    type: updates.type ?? original.type,
    eventType: updates.eventType ?? original.eventType,
    status: nextStatus,
    amount: updates.amount ?? original.amount,
    date: updates.date ? parseDateInput(updates.date) : original.date,
    category: updates.category === undefined ? original.category : updates.category ?? undefined,
    notes: updates.notes === undefined ? original.notes : updates.notes ?? undefined,
    correctionReason: updates.correctionReason === undefined ? original.correctionReason : updates.correctionReason ?? undefined,
    confirmedAt: nextStatus === 'confirmed' ? original.confirmedAt ?? new Date() : null,
    updatedAt: new Date()
  };

  const nextList = [...list];
  nextList[index] = updated;
  transactionsByUser[userId] = nextList;
  return updated;
};

export const mockConfirmTransaction = async (id: string): Promise<Transaction> => {
  return mockUpdateTransaction(id, { status: 'confirmed' });
};

export const mockCorrectTransaction = async (
  id: string,
  correction: {
    type?: 'revenue' | 'expense';
    eventType?: Transaction['eventType'];
    status?: Transaction['status'];
    amount?: number;
    date?: string;
    category?: string | null;
    notes?: string | null;
    correctionReason?: string;
  }
): Promise<{ originalTransactionId: string; correction: Transaction }> => {
  const userEntry = Object.entries(transactionsByUser).find(([, list]) => list.some((tx) => tx.id === id));
  if (!userEntry) {
    throw new Error('Transaction not found');
  }

  const [userId, list] = userEntry;
  const index = list.findIndex((tx) => tx.id === id);
  const original = list[index];
  if (!original) {
    throw new Error('Transaction not found');
  }

  const now = new Date();
  const correctionTx: Transaction = {
    ...original,
    id: createTransactionId(),
    type: correction.type ?? original.type,
    eventType: correction.eventType ?? original.eventType,
    status: correction.status ?? 'confirmed',
    amount: correction.amount ?? original.amount,
    date: correction.date ? parseDateInput(correction.date) : original.date,
    category: correction.category === undefined ? original.category : correction.category ?? undefined,
    notes: correction.notes === undefined ? original.notes : correction.notes ?? undefined,
    correctionReason: correction.correctionReason ?? 'Corrected transaction entry',
    correctionOfId: original.id,
    confirmedAt: (correction.status ?? 'confirmed') === 'confirmed' ? now : null,
    createdAt: now,
    updatedAt: now
  };

  const originalUpdated: Transaction = {
    ...original,
    status: 'draft',
    confirmedAt: null,
    correctionReason: `Superseded by correction ${correctionTx.id}`,
    updatedAt: now
  };

  const nextList = [...list];
  nextList[index] = originalUpdated;
  nextList.push(correctionTx);
  transactionsByUser[userId] = nextList;

  return {
    originalTransactionId: original.id,
    correction: correctionTx
  };
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

export const mockGetMonthlyInsights = async (userId: string, year: number, month: number) => {
  const txs = transactionsByUser[userId] ?? [];
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  end.setMilliseconds(end.getMilliseconds() - 1);
  const now = new Date();
  const effectiveEnd = now >= start && now <= end ? now : end;
  const inRange = txs.filter((tx) => {
    const date = new Date(tx.date);
    return date >= start && date <= effectiveEnd && tx.status === 'confirmed' && !tx.correctionOfId;
  });

  const revenue = inRange.filter((tx) => tx.type === 'revenue').reduce((sum, tx) => sum + tx.amount, 0);
  const expenses = inRange.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const profit = revenue - expenses;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysElapsed = Math.min(daysInMonth, Math.max(1, effectiveEnd.getUTCDate()));
  const currentMonthStart = start.toISOString();
  const budgets = (budgetsByUser[userId] ?? []).filter((budget) => budget.periodStart === currentMonthStart);
  const revenueBudget = budgets.find((budget) => budget.targetType === 'revenue' && !budget.category)?.amount;
  const expenseBudget = budgets.find((budget) => budget.targetType === 'expense' && !budget.category)?.amount;
  const expectedRevenue = revenueBudget ? (revenueBudget * daysElapsed) / daysInMonth : undefined;
  const expectedExpense = expenseBudget ? (expenseBudget * daysElapsed) / daysInMonth : undefined;
  const revenueGap = expectedRevenue !== undefined ? revenue - expectedRevenue : undefined;
  const expenseGap = expectedExpense !== undefined ? expenses - expectedExpense : undefined;

  const categoryTotals = inRange
    .filter((tx) => tx.type === 'expense')
    .reduce<Record<string, number>>((acc, tx) => {
      const key = tx.category || 'Uncategorized';
      acc[key] = (acc[key] ?? 0) + tx.amount;
      return acc;
    }, {});

  const topExpenseCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));

  const budgetByCategory = budgets.filter((budget) => budget.targetType === 'expense' && budget.category);
  const overrunCategories = budgetByCategory
    .map((budget) => {
      const actual = categoryTotals[budget.category as string] ?? 0;
      const variance = actual - budget.amount;
      return {
        category: budget.category as string,
        target: budget.amount,
        actual,
        variance
      };
    })
    .filter((entry) => entry.variance > 0.5)
    .sort((a, b) => b.variance - a.variance);

  const daysWithRecords = new Set(inRange.map((tx) => new Date(tx.date).toISOString().slice(0, 10))).size;
  const consistencyRatio = Math.min(1, daysWithRecords / Math.max(1, daysElapsed));
  const classificationRatio = inRange.length === 0
    ? 0
    : inRange.filter((tx) => Boolean(tx.category)).length / inRange.length;
  const personalExpenseTx = inRange.filter((tx) => tx.type === 'expense');
  const personalSeparationRatio = personalExpenseTx.length === 0
    ? 1
    : personalExpenseTx.filter((tx) => {
      const category = (tx.category ?? '').toLowerCase();
      const hasPersonalWord = /(personal|owner|family|home|private|withdraw)/i.test(category);
      return !hasPersonalWord || tx.eventType === 'owner_withdrawal';
    }).length / personalExpenseTx.length;
  const creditSalesCount = inRange.filter((tx) => tx.eventType === 'credit_sale').length;
  const debtRecoveryCount = inRange.filter((tx) => tx.eventType === 'debtor_recovery').length;
  const creditTrackingRatio = creditSalesCount === 0 ? 1 : Math.min(1, debtRecoveryCount / creditSalesCount);

  const score = Math.round(
    consistencyRatio * 35 +
      classificationRatio * 25 +
      personalSeparationRatio * 20 +
      creditTrackingRatio * 20
  );
  const level = score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';

  const highlights: string[] = [];
  if (revenueGap !== undefined && revenueGap < -0.5) {
    highlights.push(`Sales are below month-to-date target by GHS ${Math.abs(revenueGap).toFixed(2)}.`);
  }
  if (expenseGap !== undefined && expenseGap > 0.5) {
    highlights.push(`Expenses are above expected pace by GHS ${expenseGap.toFixed(2)}.`);
  }
  if (overrunCategories.length > 0) {
    highlights.push(`${overrunCategories[0].category} is over budget by GHS ${overrunCategories[0].variance.toFixed(2)}.`);
  }
  if (highlights.length === 0) {
    highlights.push('Your records are on track this month. Keep logging consistently.');
  }

  return {
    period: {
      year,
      month,
      periodStart: start.toISOString(),
      periodEnd: effectiveEnd.toISOString(),
      daysElapsed,
      daysInMonth
    },
    targetStatus: {
      revenueTarget: revenueBudget,
      expenseTarget: expenseBudget,
      profitTarget: revenueBudget !== undefined && expenseBudget !== undefined ? revenueBudget - expenseBudget : undefined,
      actualRevenue: revenue,
      actualExpenses: expenses,
      actualProfit: profit,
      expectedRevenueToDate: expectedRevenue,
      expectedExpensesToDate: expectedExpense,
      revenueGapToDate: revenueGap,
      expenseVarianceToDate: expenseGap,
      profitGap:
        revenueBudget !== undefined && expenseBudget !== undefined
          ? profit - (revenueBudget - expenseBudget)
          : undefined,
      revenueStatus:
        revenueGap === undefined ? undefined : revenueGap < -0.5 ? 'behind' : revenueGap > 0.5 ? 'ahead' : 'onTrack',
      expenseStatus:
        expenseGap === undefined ? undefined : expenseGap > 0.5 ? 'over' : expenseGap < -0.5 ? 'within' : 'onTrack',
      profitStatus: undefined
    },
    expenseOverrun: {
      isOverrun: (expenseGap ?? 0) > 0.5 || overrunCategories.length > 0,
      expectedByNow: expectedExpense,
      actualByNow: expenses,
      varianceByNow: expenseGap,
      overrunCategories,
      topExpenseCategories
    },
    creditReadiness: {
      score,
      level,
      consistencyRatio,
      classificationRatio,
      personalSeparationRatio,
      creditTrackingRatio,
      daysWithRecords,
      expectedRecordDays: Math.max(1, daysElapsed)
    },
    highlights
  };
};

export const mockGetCurrentInsights = async (userId: string) => {
  const now = new Date();
  return mockGetMonthlyInsights(userId, now.getUTCFullYear(), now.getUTCMonth() + 1);
};

const formatAmount = (amount: number): string => Number(amount.toFixed(2)).toString();
const toDateKeyUtc = (date: Date): string => date.toISOString().slice(0, 10);
const startOfUtcDate = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addUtcDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const dateKeyToUtcDate = (dateKey: string): Date => new Date(`${dateKey}T12:00:00.000Z`);
const formatDisplayDateFromKey = (dateKey: string): string =>
  dateKeyToUtcDate(dateKey).toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const buildInitialGreeting = (name?: string): string => {
  const firstName = name?.trim().split(/\s+/)[0];
  if (firstName) {
    return `Good evening, ${firstName}. Let’s log today. How much money inflow came in today?`;
  }
  return 'Good evening. Let’s log today. How much money inflow came in today?';
};
const buildBackfillConsentPrompt = (dateKey: string): string =>
  `You missed ${formatDisplayDateFromKey(dateKey)}. Add that day now? Reply 1 for Yes or 2 for Skip.`;
const buildBackfillInflowPrompt = (dateKey: string): string =>
  `Great. Let’s backfill ${formatDisplayDateFromKey(dateKey)}. How much money inflow came in that day?`;
const buildInflowQuestionForLogDate = (dateKey?: string): string =>
  dateKey ? `How much money inflow came in on ${formatDisplayDateFromKey(dateKey)}?` : 'How much money inflow came in today?';
const buildExpenseQuestionForLogDate = (dateKey?: string): string =>
  dateKey ? `How much did the business spend on ${formatDisplayDateFromKey(dateKey)}?` : 'How much did the business spend today?';
const buildIdleAcknowledgementReply = (name?: string): string => {
  const firstName = name?.trim().split(/\s+/)[0];
  if (firstName) {
    return `You’re welcome, ${firstName}. I’m here whenever you’re ready to log more.`;
  }
  return 'You’re welcome. I’m here whenever you’re ready to log more.';
};
const isAcknowledgementMessage = (text: string): boolean => {
  const value = text.trim().toLowerCase();
  return /^(thank you|thanks|thank u|ok|okay|alright|all right|noted|great|nice|cool|awesome|perfect|got it|understood|roger|appreciated)[!. ]*$/.test(value);
};
const isLoggingIntentMessage = (text: string): boolean => {
  const value = text.trim().toLowerCase();
  if (!value) return false;
  return /\b(log|record|track|capture|enter|update)\b/.test(value)
    || /\b(start|begin)\b/.test(value) && /\b(sales?|inflows?|income|revenue|expenses?|today)\b/.test(value);
};

const baseSalesTypeOptions = [
  { label: 'Cash sale', eventType: 'cash_sale' },
  { label: 'MoMo sale', eventType: 'momo_sale' },
  { label: 'Credit sale', eventType: 'credit_sale' },
  { label: 'Debtor recovery', eventType: 'debtor_recovery' },
  { label: 'Capital introduced', eventType: 'capital_introduced' },
  { label: 'Loan received', eventType: 'loan_received' }
] as const;

const baseExpenseTypeOptions = [
  { label: 'Operating expense', eventType: 'operating_expense' },
  { label: 'Stock purchase', eventType: 'stock_purchase' },
  { label: 'Owner withdrawal', eventType: 'owner_withdrawal' },
  { label: 'Loan repayment', eventType: 'loan_repayment' },
  { label: 'Supplier credit', eventType: 'supplier_credit' }
] as const;

const normalizeCustomLineItemLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').slice(0, 80);

const parseOptionNumber = (text: string): number | undefined => {
  const numericMatch = text.trim().toLowerCase().match(/^(?:option\s*)?\(?(\d{1,2})\)?[.)]?\s*$/i);
  if (!numericMatch) return undefined;
  const parsed = Number(numericMatch[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const listCustomLineItems = (userId: string, kind: 'inflow' | 'expense'): string[] => {
  const store = customLineItemsByUser[userId] ?? { inflow: [], expense: [] };
  return [...store[kind]]
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    })
    .slice(0, 5)
    .map((item) => item.label);
};

const rememberCustomLineItem = (
  userId: string,
  kind: 'inflow' | 'expense',
  rawLabel: string
): string | null => {
  const label = normalizeCustomLineItemLabel(rawLabel);
  if (!label) return null;
  const normalizedLabel = label.toLowerCase();
  const now = new Date().toISOString();
  const store = customLineItemsByUser[userId] ?? { inflow: [], expense: [] };
  customLineItemsByUser[userId] = store;
  const current = store[kind];
  const existing = current.find((item) => item.normalizedLabel === normalizedLabel);
  if (existing) {
    existing.label = label;
    existing.usageCount += 1;
    existing.lastUsedAt = now;
    return existing.label;
  }
  current.push({
    label,
    normalizedLabel,
    usageCount: 1,
    lastUsedAt: now
  });
  return label;
};

const detectMissedYesterday = (userId: string): string | undefined => {
  const now = new Date();
  const todayStart = startOfUtcDate(now);
  const yesterdayStart = addUtcDays(todayStart, -1);
  const transactions = (transactionsByUser[userId] ?? []).filter(
    (tx) => tx.status === 'confirmed' && !tx.correctionOfId
  );
  const historyBeforeToday = transactions.filter((tx) => new Date(tx.date) < todayStart);
  if (historyBeforeToday.length === 0) return undefined;
  const hasYesterday = historyBeforeToday.some((tx) => {
    const date = new Date(tx.date);
    return date >= yesterdayStart && date < todayStart;
  });
  if (hasYesterday) return undefined;
  return toDateKeyUtc(yesterdayStart);
};

const resolveConversationLogDate = (dateKey?: string): Date =>
  dateKey ? dateKeyToUtcDate(dateKey) : new Date();

const buildSalesTypePrompt = (prefix?: string, customItems: string[] = []): string => {
  const header = prefix ? `${prefix}\n` : '';
  const lines = [
    ...baseSalesTypeOptions.map((option, index) => `${index + 1}. ${option.label}`),
    ...customItems.map((label, index) => `${baseSalesTypeOptions.length + index + 1}. ${label}`)
  ];
  return `${header}What type of money inflow was this?\n${lines.join('\n')}\nReply with 1-${lines.length} (or type the name).`;
};

const buildExpenseTypePrompt = (prefix?: string, customItems: string[] = []): string => {
  const header = prefix ? `${prefix}\n` : '';
  const lines = [
    ...baseExpenseTypeOptions.map((option, index) => `${index + 1}. ${option.label}`),
    ...customItems.map((label, index) => `${baseExpenseTypeOptions.length + index + 1}. ${label}`)
  ];
  return `${header}What type of expense was it?\n${lines.join('\n')}\nReply with 1-${lines.length} (or type the name).`;
};

const buildCustomTypeConfirmPrompt = (
  label: string,
  kind: 'inflow' | 'expense'
): string => `“${label}” is not in the ${kind} type list. Add it as a new ${kind} line item? Reply YES or NO.`;

const parseYesResponse = (text: string): boolean => /^(yes|y|ok|okay|confirm|add)$/i.test(text.trim());
const parseNoResponse = (text: string): boolean => /^(no|n|cancel|back)$/i.test(text.trim());
const isBackfillYes = (text: string): boolean => parseYesResponse(text) || /^1$/.test(text.trim());
const isBackfillNo = (text: string): boolean => parseNoResponse(text) || /^2$/.test(text.trim());

const resolveSalesTypeChoice = (
  text: string,
  customItems: string[]
): {
  eventType?: Transaction['eventType'];
  customLabel?: string;
  invalidNumeric?: boolean;
} => {
  const numericChoice = parseOptionNumber(text);
  if (numericChoice !== undefined) {
    if (numericChoice >= 1 && numericChoice <= baseSalesTypeOptions.length) {
      return { eventType: baseSalesTypeOptions[numericChoice - 1].eventType };
    }
    const customIndex = numericChoice - baseSalesTypeOptions.length - 1;
    if (customIndex >= 0 && customIndex < customItems.length) {
      return { eventType: 'other', customLabel: customItems[customIndex] };
    }
    return { invalidNumeric: true };
  }

  const normalizedInput = normalizeCustomLineItemLabel(text).toLowerCase();
  if (!normalizedInput) return {};
  const customMatch = customItems.find((item) => normalizeCustomLineItemLabel(item).toLowerCase() === normalizedInput);
  if (customMatch) return { eventType: 'other', customLabel: customMatch };

  const knownType = parseSalesEventTypeFromText(text, { allowNumericChoice: false });
  if (knownType) return { eventType: knownType };
  return {};
};

const resolveExpenseTypeChoice = (
  text: string,
  customItems: string[]
): {
  eventType?: Transaction['eventType'];
  customLabel?: string;
  invalidNumeric?: boolean;
} => {
  const numericChoice = parseOptionNumber(text);
  if (numericChoice !== undefined) {
    if (numericChoice >= 1 && numericChoice <= baseExpenseTypeOptions.length) {
      return { eventType: baseExpenseTypeOptions[numericChoice - 1].eventType };
    }
    const customIndex = numericChoice - baseExpenseTypeOptions.length - 1;
    if (customIndex >= 0 && customIndex < customItems.length) {
      return { eventType: 'other', customLabel: customItems[customIndex] };
    }
    return { invalidNumeric: true };
  }

  const normalizedInput = normalizeCustomLineItemLabel(text).toLowerCase();
  if (!normalizedInput) return {};
  const customMatch = customItems.find((item) => normalizeCustomLineItemLabel(item).toLowerCase() === normalizedInput);
  if (customMatch) return { eventType: 'other', customLabel: customMatch };

  const knownType = parseExpenseEventTypeFromText(text, { allowNumericChoice: false });
  if (knownType) return { eventType: knownType };
  return {};
};

const parseSalesEventTypeFromText = (
  text: string,
  options?: { allowNumericChoice?: boolean }
): Transaction['eventType'] | undefined => {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  const allowNumericChoice = options?.allowNumericChoice ?? true;
  if (allowNumericChoice) {
    const numericMatch = value.match(/^(?:option\s*)?\(?([1-6])\)?[.)]?\s*$/i);
    if (numericMatch) {
      const fromNumeric: Record<string, Transaction['eventType']> = {
        '1': 'cash_sale',
        '2': 'momo_sale',
        '3': 'credit_sale',
        '4': 'debtor_recovery',
        '5': 'capital_introduced',
        '6': 'loan_received'
      };
      return fromNumeric[numericMatch[1]];
    }
  }
  if (/(debtor|debt recovery|old debt|customer paid)/i.test(value)) return 'debtor_recovery';
  if (/(credit sale|sold on credit|credit)/i.test(value)) return 'credit_sale';
  if (/(momo|mobile money|mobile transfer|transfer)/i.test(value)) return 'momo_sale';
  if (/(loan received|borrowed|loan inflow)/i.test(value)) return 'loan_received';
  if (/(capital introduced|owner added|added capital|money added to business)/i.test(value)) return 'capital_introduced';
  if (/(cash|cash sale|normal sale|walk in sale|sales)/i.test(value)) return 'cash_sale';
  return undefined;
};

const parseExpenseEventTypeFromText = (
  text: string,
  options?: { allowNumericChoice?: boolean }
): Transaction['eventType'] | undefined => {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  const allowNumericChoice = options?.allowNumericChoice ?? true;
  if (allowNumericChoice) {
    const numericMatch = value.match(/^(?:option\s*)?\(?([1-5])\)?[.)]?\s*$/i);
    if (numericMatch) {
      const fromNumeric: Record<string, Transaction['eventType']> = {
        '1': 'operating_expense',
        '2': 'stock_purchase',
        '3': 'owner_withdrawal',
        '4': 'loan_repayment',
        '5': 'supplier_credit'
      };
      return fromNumeric[numericMatch[1]];
    }
  }
  if (/(loan repayment|repaid loan|paid loan)/i.test(value)) return 'loan_repayment';
  if (/(owner withdrawal|withdrawal|personal|owner|family|home|private)/i.test(value)) return 'owner_withdrawal';
  if (/(stock|inventory|supplier goods|restock)/i.test(value)) return 'stock_purchase';
  if (/(supplier credit|pay later to supplier|credit purchase)/i.test(value)) return 'supplier_credit';
  if (/(operating|rent|transport|utility|data|airtime|salary|expense|business expense)/i.test(value)) {
    return 'operating_expense';
  }
  return undefined;
};

const humanizeEventType = (eventType?: Transaction['eventType']): string => {
  const labels: Record<NonNullable<Transaction['eventType']>, string> = {
    cash_sale: 'Cash sale',
    momo_sale: 'MoMo sale',
    credit_sale: 'Credit sale',
    debtor_recovery: 'Debtor recovery',
    stock_purchase: 'Stock purchase',
    operating_expense: 'Operating expense',
    owner_withdrawal: 'Owner withdrawal',
    loan_received: 'Loan received',
    loan_repayment: 'Loan repayment',
    supplier_credit: 'Supplier credit',
    capital_introduced: 'Capital introduced',
    other: 'Other'
  };
  return eventType ? labels[eventType] : 'Other';
};

const defaultExpenseCategory = (eventType?: Transaction['eventType']): string | undefined => {
  if (!eventType) return undefined;
  if (eventType === 'owner_withdrawal') return 'Owner withdrawal';
  if (eventType === 'stock_purchase') return 'Stock purchase';
  if (eventType === 'supplier_credit') return 'Supplier credit';
  if (eventType === 'loan_repayment') return 'Loan repayment';
  return undefined;
};

const buildDraftSummary = (params: {
  salesAmount?: number;
  salesEventType?: Transaction['eventType'];
  salesCategory?: string;
  expenseAmount?: number;
  expenseEventType?: Transaction['eventType'];
  expenseCategory?: string;
}) => {
  const lines: string[] = [];
  if (params.salesAmount !== undefined) lines.push(`Inflow: GHS ${params.salesAmount}`);
  if (params.salesEventType) {
    if (params.salesEventType === 'other' && params.salesCategory) {
      lines.push(`Inflow type: ${params.salesCategory}`);
    } else {
      lines.push(`Inflow type: ${humanizeEventType(params.salesEventType)}`);
    }
  }
  if (params.expenseAmount !== undefined) lines.push(`Expense: GHS ${params.expenseAmount}`);
  if (params.expenseEventType) {
    if (params.expenseEventType === 'other' && params.expenseCategory) {
      lines.push(`Expense type: ${params.expenseCategory}`);
    } else {
      lines.push(`Expense type: ${humanizeEventType(params.expenseEventType)}`);
    }
  }
  if (params.expenseCategory) lines.push(`Expense category: ${params.expenseCategory}`);
  return lines.join('\n');
};

const buildMockPostSaveAdvice = async (userId: string): Promise<string | null> => {
  const insights = await mockGetCurrentInsights(userId);
  const advice: string[] = [];
  const revenueGap = insights.targetStatus.revenueGapToDate;
  const expenseGap = insights.expenseOverrun.varianceByNow;

  if (insights.targetStatus.revenueStatus === 'behind' && revenueGap !== undefined) {
    advice.push(`Sales are behind pace by GHS ${formatAmount(Math.abs(revenueGap))}. Prioritize high-turnover items this week.`);
  } else if (insights.targetStatus.revenueStatus === 'ahead' && revenueGap !== undefined) {
    advice.push(`Sales are ahead of pace by GHS ${formatAmount(revenueGap)}. Keep this consistency through month-end.`);
  }

  if (insights.expenseOverrun.isOverrun) {
    if (expenseGap !== undefined && expenseGap > 0) {
      advice.push(`Expenses are above expected pace by GHS ${formatAmount(expenseGap)}. Tighten spending on non-urgent costs.`);
    } else if (insights.expenseOverrun.overrunCategories.length > 0) {
      const top = insights.expenseOverrun.overrunCategories[0];
      advice.push(`${top.category} is over budget by GHS ${formatAmount(top.variance)}. Review that line item first.`);
    }
  }

  if (insights.creditReadiness.level === 'poor' || insights.creditReadiness.level === 'fair') {
    advice.push(`Credit readiness is ${insights.creditReadiness.level} (${insights.creditReadiness.score}/100). Daily complete entries will lift your score.`);
  } else if (insights.creditReadiness.level === 'strong') {
    advice.push(`Credit readiness is strong (${insights.creditReadiness.score}/100). Keep your record quality at this level.`);
  }

  if (advice.length === 0 && insights.highlights.length > 0) {
    advice.push(insights.highlights[0]);
  }

  if (advice.length === 0) {
    return null;
  }

  return `Quick advice:\n${advice.slice(0, 2).join('\n')}`;
};

export const mockPostChatEntry = async (userId: string, message: string) => {
  const session = conversationSessionsByUser[userId] ?? { step: 'idle' as const };
  conversationSessionsByUser[userId] = session;
  const currentUser = users.find((user) => user.id === userId);
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const logDate = resolveConversationLogDate(session.logDateKey);
  const touched: Transaction[] = [];
  let customInflowItems = listCustomLineItems(userId, 'inflow');
  let customExpenseItems = listCustomLineItems(userId, 'expense');

  const parsed = parseMessageToTransactions(userId, message);
  const revenueParsed = parsed.find((tx) => tx.type === 'revenue');
  const expenseParsed = parsed.find((tx) => tx.type === 'expense');
  const explicitSalesEvent = parseSalesEventTypeFromText(trimmed, { allowNumericChoice: false });
  const explicitExpenseEvent = parseExpenseEventTypeFromText(trimmed, { allowNumericChoice: false });

  const parseAmount = (text: string): number | null => {
    const cleaned = text.replace(/,/g, '');
    const match = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const amount = Number(match[1]);
    return Number.isNaN(amount) || amount <= 0 ? null : amount;
  };

  const findTransaction = (id?: string) => (transactionsByUser[userId] ?? []).find((tx) => tx.id === id);

  const upsertDraft = async (payload: {
    draftId?: string;
    type: 'revenue' | 'expense';
    amount: number;
    date?: Date;
    eventType?: Transaction['eventType'];
    category?: string;
    notes?: string;
  }) => {
    const existing = payload.draftId ? findTransaction(payload.draftId) : undefined;
    if (existing && existing.status === 'draft') {
      const updated = await mockUpdateTransaction(existing.id, {
        type: payload.type,
        eventType: payload.eventType,
        amount: payload.amount,
        date: payload.date?.toISOString(),
        category: payload.category ?? existing.category,
        notes: payload.notes ?? existing.notes
      });
      touched.push(updated);
      return updated;
    }

    const created = await mockCreateTransaction({
      userId,
      type: payload.type,
      eventType: payload.eventType,
      status: 'draft',
      amount: payload.amount,
      date: payload.date?.toISOString(),
      category: payload.category,
      notes: payload.notes
    });
    touched.push(created);
    return created;
  };

  let botReply = '';

  if (session.step === 'idle') {
    if (!revenueParsed && !expenseParsed) {
      const idleReply = isAcknowledgementMessage(trimmed)
        ? buildIdleAcknowledgementReply(currentUser?.name)
        : 'I’m here when you are ready. You can send something like "Inflow 1200, spent 300" and I’ll log it for you.';
      const loggingIntent = isLoggingIntentMessage(trimmed);
      if (loggingIntent) {
        const missedDateKey = session.logDateKey ? undefined : detectMissedYesterday(userId);
        if (missedDateKey) {
          session.pendingBackfillDateKey = missedDateKey;
          session.step = 'ask_backfill_consent';
          botReply = buildBackfillConsentPrompt(missedDateKey);
        } else {
          session.pendingBackfillDateKey = undefined;
          session.step = 'ask_sales';
          botReply = buildInitialGreeting(currentUser?.name);
        }
      } else {
        session.step = 'idle';
        botReply = idleReply;
      }
    } else {
      if (revenueParsed) {
        session.pendingBackfillDateKey = undefined;
        const salesEventType = explicitSalesEvent ?? session.salesEventType ?? revenueParsed.eventType ?? 'cash_sale';
        const sales = await upsertDraft({
          draftId: session.salesDraftId,
          type: 'revenue',
          amount: revenueParsed.amount,
          date: logDate,
          eventType: salesEventType,
          category: revenueParsed.category ?? session.salesCategory ?? 'Sales',
          notes: revenueParsed.notes
        });
        session.salesDraftId = sales.id;
        session.salesEventType = salesEventType;
        session.salesCategory = sales.category ?? 'Sales';
        if (explicitSalesEvent) session.salesTypeConfirmed = true;
        session.pendingSalesTypeLabel = undefined;
      }

      if (expenseParsed) {
        session.pendingBackfillDateKey = undefined;
        const expenseEventType = explicitExpenseEvent ?? session.expenseEventType ?? expenseParsed.eventType ?? 'operating_expense';
        const expenseCategory = expenseParsed.category ?? defaultExpenseCategory(expenseEventType);
        const expense = await upsertDraft({
          draftId: session.expenseDraftId,
          type: 'expense',
          amount: expenseParsed.amount,
          date: logDate,
          eventType: expenseEventType,
          category: expenseCategory,
          notes: expenseParsed.notes
        });
        session.expenseDraftId = expense.id;
        session.expenseEventType = expenseEventType;
        session.expenseCategory = expense.category ?? expenseCategory;
        if (explicitExpenseEvent) session.expenseTypeConfirmed = true;
        session.pendingExpenseTypeLabel = undefined;
      }

      if (!session.salesDraftId) {
        session.step = 'ask_sales';
        botReply = `I noted the expense draft. ${buildInflowQuestionForLogDate(session.logDateKey)}`;
      } else if (!session.salesTypeConfirmed) {
        session.step = 'ask_sales_type';
        botReply = buildSalesTypePrompt('Noted.', customInflowItems);
      } else if (!session.expenseDraftId) {
        session.step = 'ask_expense';
        botReply = `Recorded draft inflow. ${buildExpenseQuestionForLogDate(session.logDateKey)}`;
      } else if (!session.expenseTypeConfirmed) {
        session.step = 'ask_expense_type';
        botReply = buildExpenseTypePrompt('Recorded draft expense.', customExpenseItems);
      } else {
        const expenseDraft = findTransaction(session.expenseDraftId);
        if (!expenseDraft?.category && (expenseDraft?.amount ?? 0) > 0) {
          session.step = 'ask_expense_category';
          botReply = 'Recorded draft expense. What was it spent on?';
        } else {
          session.step = 'await_confirm';
          const salesDraft = findTransaction(session.salesDraftId);
          botReply = `Draft summary:\n${buildDraftSummary({
            salesAmount: salesDraft?.amount,
            salesEventType: session.salesEventType,
            salesCategory: session.salesCategory,
            expenseAmount: expenseDraft?.amount ?? 0,
            expenseEventType: session.expenseEventType,
            expenseCategory: expenseDraft?.category ?? session.expenseCategory
          })}\n\nReply SAVE to confirm or EDIT to adjust.`;
        }
      }
    }
  } else if (session.step === 'ask_backfill_consent') {
    const backfillDateKey = session.pendingBackfillDateKey;
    if (!backfillDateKey) {
      session.step = 'ask_sales';
      botReply = 'How much money inflow came in today?';
    } else if (isBackfillYes(trimmed)) {
      session.logDateKey = backfillDateKey;
      session.pendingBackfillDateKey = undefined;
      session.step = 'ask_sales';
      botReply = buildBackfillInflowPrompt(backfillDateKey);
    } else if (isBackfillNo(trimmed)) {
      session.logDateKey = undefined;
      session.pendingBackfillDateKey = undefined;
      session.step = 'ask_sales';
      botReply = 'No problem. How much money inflow came in today?';
    } else {
      botReply = `${buildBackfillConsentPrompt(backfillDateKey)} Reply with 1 or 2.`;
    }
  } else if (session.step === 'ask_sales') {
    const amount = revenueParsed?.amount ?? parseAmount(trimmed);
    if (amount === null) {
      botReply = 'Please send the money inflow amount in cedis so I can save it as draft. Example: "Inflow 850".';
    } else {
      const salesEventType = explicitSalesEvent ?? session.salesEventType ?? 'cash_sale';
      const sales = await upsertDraft({
        draftId: session.salesDraftId,
        type: 'revenue',
        amount,
        date: logDate,
        eventType: salesEventType,
        category: revenueParsed?.category ?? session.salesCategory ?? 'Sales',
        notes: revenueParsed?.notes
      });
      session.salesDraftId = sales.id;
      session.salesEventType = salesEventType;
      session.salesCategory = sales.category ?? 'Sales';
      if (explicitSalesEvent) session.salesTypeConfirmed = true;
      session.pendingSalesTypeLabel = undefined;
      session.step = session.salesTypeConfirmed ? 'ask_expense' : 'ask_sales_type';
      botReply = session.step === 'ask_sales_type'
        ? buildSalesTypePrompt(`Recorded draft inflow: GHS ${amount}.`, customInflowItems)
        : `Recorded draft inflow: GHS ${amount}. ${buildExpenseQuestionForLogDate(session.logDateKey)}`;
    }
  } else if (session.step === 'ask_sales_type') {
    const salesChoice = resolveSalesTypeChoice(trimmed, customInflowItems);
    if (!salesChoice.eventType) {
      if (!trimmed) {
        botReply = buildSalesTypePrompt('Please choose the inflow type.', customInflowItems);
      } else if (salesChoice.invalidNumeric) {
        botReply = buildSalesTypePrompt('That option number is not in the list.', customInflowItems);
      } else if (parseYesResponse(trimmed) || parseNoResponse(trimmed)) {
        botReply = buildSalesTypePrompt('Please choose one type from the list.', customInflowItems);
      } else {
        session.pendingSalesTypeLabel = trimmed;
        session.step = 'confirm_sales_type_custom';
        botReply = buildCustomTypeConfirmPrompt(trimmed, 'inflow');
      }
    } else {
      const inflowTypeLabel = salesChoice.customLabel ?? humanizeEventType(salesChoice.eventType);
      const inflowCategory = salesChoice.eventType === 'other'
        ? salesChoice.customLabel ?? session.salesCategory ?? 'Other'
        : 'Sales';
      const salesDraft = findTransaction(session.salesDraftId);
      if (salesDraft) {
        const updated = await mockUpdateTransaction(salesDraft.id, {
          eventType: salesChoice.eventType,
          category: inflowCategory,
          notes: salesChoice.eventType === 'other' ? inflowCategory : undefined
        });
        touched.push(updated);
      }
      if (salesChoice.eventType === 'other' && salesChoice.customLabel) {
        rememberCustomLineItem(userId, 'inflow', salesChoice.customLabel);
        customInflowItems = listCustomLineItems(userId, 'inflow');
      }
      session.salesEventType = salesChoice.eventType;
      session.salesCategory = inflowCategory;
      session.salesTypeConfirmed = true;
      session.pendingSalesTypeLabel = undefined;
      session.step = 'ask_expense';
      botReply = `Inflow type recorded as ${inflowTypeLabel}. ${buildExpenseQuestionForLogDate(session.logDateKey)}`;
    }
  } else if (session.step === 'confirm_sales_type_custom') {
    const pendingLabel = session.pendingSalesTypeLabel?.trim();
    if (!pendingLabel) {
      session.step = 'ask_sales_type';
      botReply = buildSalesTypePrompt('Please choose the inflow type.', customInflowItems);
    } else if (parseYesResponse(trimmed)) {
      const savedLabel = rememberCustomLineItem(userId, 'inflow', pendingLabel) ?? pendingLabel;
      customInflowItems = listCustomLineItems(userId, 'inflow');
      const salesDraft = findTransaction(session.salesDraftId);
      if (salesDraft) {
        const updated = await mockUpdateTransaction(salesDraft.id, {
          eventType: 'other',
          category: savedLabel,
          notes: savedLabel
        });
        touched.push(updated);
      }
      session.salesEventType = 'other';
      session.salesCategory = savedLabel;
      session.salesTypeConfirmed = true;
      session.pendingSalesTypeLabel = undefined;
      session.step = 'ask_expense';
      botReply = `Inflow type recorded as ${savedLabel}. ${buildExpenseQuestionForLogDate(session.logDateKey)}`;
    } else if (parseNoResponse(trimmed)) {
      session.pendingSalesTypeLabel = undefined;
      session.step = 'ask_sales_type';
      botReply = buildSalesTypePrompt('Okay, please choose one from the list.', customInflowItems);
    } else {
      botReply = `Please reply YES to add "${pendingLabel}" or NO to choose from the list.`;
    }
  } else if (session.step === 'ask_expense') {
    if (/^(no|none|zero|skip)$/i.test(lower)) {
      session.expenseDraftId = undefined;
      session.expenseEventType = undefined;
      session.expenseTypeConfirmed = true;
      session.expenseCategory = undefined;
      session.pendingExpenseTypeLabel = undefined;
      session.step = 'await_confirm';
      const salesDraft = findTransaction(session.salesDraftId);
      botReply = `Draft summary:\n${buildDraftSummary({
        salesAmount: salesDraft?.amount,
        salesEventType: session.salesEventType,
        salesCategory: session.salesCategory,
        expenseAmount: 0
      })}\n\nReply SAVE to confirm or EDIT to adjust.`;
    } else {
      const amount = expenseParsed?.amount ?? parseAmount(trimmed);
      if (amount === null) {
        botReply = 'Please send the expense amount in cedis, or type NO if there was no expense. Example: "Spent 200".';
      } else {
        const expenseEventType = explicitExpenseEvent ?? session.expenseEventType ?? 'operating_expense';
        const expenseCategory = expenseParsed?.category ?? session.expenseCategory ?? defaultExpenseCategory(expenseEventType);
        const expense = await upsertDraft({
          draftId: session.expenseDraftId,
          type: 'expense',
          amount,
          date: logDate,
          eventType: expenseEventType,
          category: expenseCategory,
          notes: expenseParsed?.notes
        });
        session.expenseDraftId = expense.id;
        session.expenseEventType = expenseEventType;
        session.expenseCategory = expense.category ?? expenseCategory;
        if (explicitExpenseEvent) session.expenseTypeConfirmed = true;
        session.pendingExpenseTypeLabel = undefined;

        if (!session.expenseTypeConfirmed) {
          session.step = 'ask_expense_type';
          botReply = buildExpenseTypePrompt(`Recorded draft expense: GHS ${amount}.`, customExpenseItems);
        } else if (!session.expenseCategory && amount > 0) {
          session.step = 'ask_expense_category';
          botReply = `Recorded expense type as ${humanizeEventType(session.expenseEventType)}. What was it spent on?`;
        } else {
          session.step = 'await_confirm';
          const salesDraft = findTransaction(session.salesDraftId);
          botReply = `Draft summary:\n${buildDraftSummary({
            salesAmount: salesDraft?.amount,
            salesEventType: session.salesEventType,
            salesCategory: session.salesCategory,
            expenseAmount: amount,
            expenseEventType: session.expenseEventType,
            expenseCategory: session.expenseCategory
          })}\n\nReply SAVE to confirm or EDIT to adjust.`;
        }
      }
    }
  } else if (session.step === 'ask_expense_type') {
    const expenseChoice = resolveExpenseTypeChoice(trimmed, customExpenseItems);
    if (!expenseChoice.eventType) {
      if (!trimmed) {
        botReply = buildExpenseTypePrompt('Please choose the expense type.', customExpenseItems);
      } else if (expenseChoice.invalidNumeric) {
        botReply = buildExpenseTypePrompt('That option number is not in the list.', customExpenseItems);
      } else if (parseYesResponse(trimmed) || parseNoResponse(trimmed)) {
        botReply = buildExpenseTypePrompt('Please choose one type from the list.', customExpenseItems);
      } else {
        session.pendingExpenseTypeLabel = trimmed;
        session.step = 'confirm_expense_type_custom';
        botReply = buildCustomTypeConfirmPrompt(trimmed, 'expense');
      }
    } else {
      const resolvedCategory = expenseChoice.eventType === 'other'
        ? expenseChoice.customLabel ?? session.expenseCategory ?? 'Other'
        : session.expenseCategory ?? defaultExpenseCategory(expenseChoice.eventType);
      const expenseTypeLabel = expenseChoice.customLabel ?? humanizeEventType(expenseChoice.eventType);
      const expenseDraft = findTransaction(session.expenseDraftId);
      if (expenseDraft) {
        const updated = await mockUpdateTransaction(expenseDraft.id, {
          eventType: expenseChoice.eventType,
          category: resolvedCategory ?? undefined,
          notes: resolvedCategory ?? undefined
        });
        touched.push(updated);
      }
      if (expenseChoice.eventType === 'other' && expenseChoice.customLabel) {
        rememberCustomLineItem(userId, 'expense', expenseChoice.customLabel);
        customExpenseItems = listCustomLineItems(userId, 'expense');
      }
      session.expenseEventType = expenseChoice.eventType;
      session.expenseTypeConfirmed = true;
      session.expenseCategory = resolvedCategory;
      session.pendingExpenseTypeLabel = undefined;

      if (!session.expenseCategory) {
        session.step = 'ask_expense_category';
        botReply = `Expense type recorded as ${expenseTypeLabel}. What was it spent on?`;
      } else {
        session.step = 'await_confirm';
        const salesDraft = findTransaction(session.salesDraftId);
        const expenseDraftLatest = findTransaction(session.expenseDraftId);
        botReply = `Draft summary:\n${buildDraftSummary({
          salesAmount: salesDraft?.amount,
          salesEventType: session.salesEventType,
          salesCategory: session.salesCategory,
          expenseAmount: expenseDraftLatest?.amount,
          expenseEventType: session.expenseEventType,
          expenseCategory: session.expenseCategory
        })}\n\nReply SAVE to confirm or EDIT to adjust.`;
      }
    }
  } else if (session.step === 'confirm_expense_type_custom') {
    const pendingLabel = session.pendingExpenseTypeLabel?.trim();
    if (!pendingLabel) {
      session.step = 'ask_expense_type';
      botReply = buildExpenseTypePrompt('Please choose the expense type.', customExpenseItems);
    } else if (parseYesResponse(trimmed)) {
      const savedLabel = rememberCustomLineItem(userId, 'expense', pendingLabel) ?? pendingLabel;
      customExpenseItems = listCustomLineItems(userId, 'expense');
      const expenseDraft = findTransaction(session.expenseDraftId);
      if (expenseDraft) {
        const updated = await mockUpdateTransaction(expenseDraft.id, {
          eventType: 'other',
          category: savedLabel,
          notes: savedLabel
        });
        touched.push(updated);
      }
      session.expenseEventType = 'other';
      session.expenseTypeConfirmed = true;
      session.expenseCategory = savedLabel;
      session.pendingExpenseTypeLabel = undefined;
      session.step = 'await_confirm';
      const salesDraft = findTransaction(session.salesDraftId);
      const expenseDraftLatest = findTransaction(session.expenseDraftId);
      botReply = `Expense type recorded as ${savedLabel}.\n\nDraft summary:\n${buildDraftSummary({
        salesAmount: salesDraft?.amount,
        salesEventType: session.salesEventType,
        salesCategory: session.salesCategory,
        expenseAmount: expenseDraftLatest?.amount,
        expenseEventType: session.expenseEventType,
        expenseCategory: session.expenseCategory
      })}\n\nReply SAVE to confirm or EDIT to adjust.`;
    } else if (parseNoResponse(trimmed)) {
      session.pendingExpenseTypeLabel = undefined;
      session.step = 'ask_expense_type';
      botReply = buildExpenseTypePrompt('Okay, please choose one from the list.', customExpenseItems);
    } else {
      botReply = `Please reply YES to add "${pendingLabel}" or NO to choose from the list.`;
    }
  } else if (session.step === 'ask_expense_category') {
    const expenseDraft = findTransaction(session.expenseDraftId);
    if (!expenseDraft) {
      session.step = 'ask_expense';
      botReply = 'I need the expense amount again to continue.';
    } else if (!trimmed) {
      botReply = 'Please share what that expense was spent on so I can classify it correctly.';
    } else {
      const inferredEventType = session.expenseEventType
        ?? (/personal|owner|family|home|private|withdraw/i.test(trimmed)
          ? 'owner_withdrawal'
          : /stock|inventory|restock|supplier/i.test(trimmed)
            ? 'stock_purchase'
            : 'operating_expense');
      const updated = await mockUpdateTransaction(expenseDraft.id, {
        category: trimmed,
        notes: trimmed,
        eventType: inferredEventType
      });
      touched.push(updated);
      session.expenseEventType = inferredEventType;
      session.expenseTypeConfirmed = session.expenseTypeConfirmed ?? true;
      session.expenseCategory = trimmed;
      session.step = 'await_confirm';
      const salesDraft = findTransaction(session.salesDraftId);
      botReply = `Draft summary:\n${buildDraftSummary({
        salesAmount: salesDraft?.amount,
        salesEventType: session.salesEventType,
        salesCategory: session.salesCategory,
        expenseAmount: updated.amount,
        expenseEventType: session.expenseEventType,
        expenseCategory: updated.category
      })}\n\nReply SAVE to confirm or EDIT to adjust.`;
    }
  } else if (session.step === 'await_confirm') {
    if (/^(save|confirm|yes|y|ok|okay|done)$/i.test(lower)) {
      const draftIds = [session.salesDraftId, session.expenseDraftId].filter(Boolean) as string[];
      for (const id of draftIds) {
        const tx = findTransaction(id);
        if (tx && tx.status === 'draft') {
          const confirmed = await mockConfirmTransaction(id);
          touched.push(confirmed);
        }
      }
      session.step = 'idle';
      session.salesDraftId = undefined;
      session.expenseDraftId = undefined;
      session.logDateKey = undefined;
      session.pendingBackfillDateKey = undefined;
      session.pendingSalesTypeLabel = undefined;
      session.pendingExpenseTypeLabel = undefined;
      const advice = await buildMockPostSaveAdvice(userId);
      botReply = advice
        ? `Saved. Your entries are now confirmed.\n\n${advice}\n\nSend another message when you are ready to log more.`
        : 'Saved. Your entries are now confirmed. Send another message when you are ready to log more.';
    } else if (/^(edit|change|update|no)$/i.test(lower)) {
      session.step = 'ask_sales';
      session.salesTypeConfirmed = false;
      session.expenseTypeConfirmed = false;
      session.pendingBackfillDateKey = undefined;
      session.pendingSalesTypeLabel = undefined;
      session.pendingExpenseTypeLabel = undefined;
      botReply = 'Okay, let’s adjust the draft. What is the correct money inflow amount?';
    } else {
      botReply = 'Reply SAVE to confirm these draft entries, or EDIT to change them.';
    }
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  monthEnd.setMilliseconds(monthEnd.getMilliseconds() - 1);
  const monthlyTransactions = (transactionsByUser[userId] ?? []).filter((tx) => {
    const txDate = new Date(tx.date);
    return txDate >= monthStart && txDate <= monthEnd && tx.status === 'confirmed' && !tx.correctionOfId;
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
    botReply,
    conversation: {
      step: session.step,
      awaitingConfirmation: session.step === 'await_confirm'
    },
    transactions: touched,
    summary: createSummary(touched),
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
