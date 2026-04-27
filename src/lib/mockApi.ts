import type {
  AdminAnalytics,
  AdminPaymentSettings,
  AdminWhatsAppSettings,
  Budget,
  BudgetStatus,
  BudgetTargetType,
  ReferralProgress,
  SummaryPayload,
  SubscriptionPaymentInitialization,
  SubscriptionPaymentVerification,
  Transaction,
  User,
  WhatsAppProvider
} from '../types';
import { mockTransactions } from '../data/mockData';

const REFERRAL_MILESTONE_SIZE = 3;
const REFERRAL_REWARD_MONTHS = 1;
const INITIAL_TRIAL_MONTHS = 1;

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
      const hasExpenseHint = /(spent|paid|cost|expense|transport|rent|utility|airtime|data|salary|fuel|stock|inventory|owner|withdraw|purchase|bought|buy)/i.test(text);
      const hasRevenueHint = /(made|sold|earned|received|income|revenue|inflow|sale|momo|capital|loan received|debtor|recovery)/i.test(text);
      if (hasExpenseHint && !hasRevenueHint) {
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
  type ExpenseClass = 'direct' | 'indirect' | 'non_business';
  const resolveRevenueCategory = (tx: Transaction): string => {
    if (tx.eventType === 'cash_sale') return tx.category ?? 'Cash sale';
    if (tx.eventType === 'momo_sale') return 'MoMo sale';
    if (tx.eventType === 'credit_sale') return 'Credit sale';
    if (tx.eventType === 'debtor_recovery') return 'Debtor recovery';
    if (tx.eventType === 'capital_introduced') return 'Capital introduced';
    if (tx.eventType === 'loan_received') return 'Loan received';
    return tx.category ?? 'Uncategorized';
  };
  const resolveExpenseClass = (tx: Transaction): ExpenseClass => {
    const category = (tx.category ?? '').toLowerCase();
    if (tx.eventType === 'stock_purchase' || tx.eventType === 'supplier_credit') return 'direct';
    if (tx.eventType === 'operating_expense') return 'indirect';
    if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') return 'non_business';
    if (/(stock|inventory|raw material|materials|cost of sales|cost of goods|purchase|purchases|supplier)/i.test(category)) return 'direct';
    if (/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category)) return 'non_business';
    return 'indirect';
  };

  const revenueTxs = transactions.filter((tx) => tx.type === 'revenue');
  const totalRevenue = revenueTxs.reduce((sum, tx) => sum + tx.amount, 0);
  let directExpenses = 0;
  let indirectExpenses = 0;
  let nonBusinessExpenses = 0;
  const transactionCount = transactions.length;

  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const directExpenseBreakdown: Record<string, number> = {};
  const indirectExpenseBreakdown: Record<string, number> = {};
  const dailyBreakdown: Array<{ date: string; revenue: number; expenses: number }> = [];

  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};
  const cashFlow = {
    operatingInflow: 0,
    operatingOutflow: 0,
    financingInflow: 0,
    financingOutflow: 0,
    totalCashInflow: 0,
    totalCashOutflow: 0,
    netCashFlow: 0
  };

  for (const tx of transactions) {
    const category = tx.type === 'revenue'
      ? resolveRevenueCategory(tx)
      : (tx.category ?? 'Uncategorized');
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { revenue: 0, expense: 0, total: 0 };
    }
    if (tx.type === 'revenue') {
      categoryBreakdown[category].revenue += tx.amount;
      categoryBreakdown[category].total += tx.amount;
      if (tx.eventType === 'capital_introduced' || tx.eventType === 'loan_received') {
        cashFlow.financingInflow += tx.amount;
      } else if (tx.eventType !== 'credit_sale') {
        cashFlow.operatingInflow += tx.amount;
      }
    } else {
      categoryBreakdown[category].expense += tx.amount;
      categoryBreakdown[category].total -= tx.amount;

      const expenseClass = resolveExpenseClass(tx);
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

    const dateKey = tx.date instanceof Date ? tx.date.toISOString().slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10);
    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { revenue: 0, expenses: 0 };
    }
    if (tx.type === 'revenue') {
      dailyMap[dateKey].revenue += tx.amount;
    } else {
      const expenseClass = resolveExpenseClass(tx);
      if (expenseClass !== 'non_business') {
        dailyMap[dateKey].expenses += tx.amount;
      }
    }
  }

  Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, values]) => dailyBreakdown.push({ date, revenue: values.revenue, expenses: values.expenses }));

  cashFlow.totalCashInflow = cashFlow.operatingInflow + cashFlow.financingInflow;
  cashFlow.totalCashOutflow = cashFlow.operatingOutflow + cashFlow.financingOutflow;
  cashFlow.netCashFlow = cashFlow.totalCashInflow - cashFlow.totalCashOutflow;

  const totalExpenses = directExpenses + indirectExpenses;
  const grossProfit = totalRevenue - directExpenses;
  const netProfit = grossProfit - indirectExpenses;

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
};

const isBusinessExpenseTx = (tx: Transaction): boolean => {
  if (tx.type !== 'expense') return false;
  if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') return false;
  const category = (tx.category ?? '').toLowerCase();
  return !/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category);
};

const matchesBudgetTarget = (tx: Transaction, targetType: BudgetTargetType): boolean => {
  if (targetType === 'revenue') return tx.type === 'revenue';
  return isBusinessExpenseTx(tx);
};

const users: User[] = [];
const transactionsByUser: Record<string, Transaction[]> = {};
const budgetsByUser: Record<string, Budget[]> = {};
const userByReferralCode: Record<string, string> = {};
const referralConversionsByReferrer: Record<
  string,
  Array<{ id: string; referredUserId: string; qualifiedAt: string }>
> = {};
const referralRewardsByReferrer: Record<
  string,
  Array<{ id: string; milestone: number; grantedMonths: number; qualifiedReferralsAtGrant: number; createdAt: string }>
> = {};
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
  default: 'whatchimp' as WhatsAppProvider,
  available: ['whatchimp', 'twilio', 'infobip'] as WhatsAppProvider[]
};
let activeProvider = defaultProviderInfo.default;

let mockWhatchimpSettings: AdminWhatsAppSettings['whatchimp'] = {
  baseUrl: 'https://api.whatchimp.com',
  apiKey: '',
  senderId: '',
  sendPath: '/api/messages/whatsapp',
  authScheme: 'Bearer'
};

let mockPaystackSettings: AdminPaymentSettings = {
  paystackPublicKey: '',
  paystackSecretKey: '',
  paystackWebhookSecret: '',
  basicAmount: 60,
  premiumAmount: 200,
  currencyCode: 'GHS'
};

const subscriptionPayments: Array<{
  id: string;
  reference: string;
  userId: string;
  plan: 'basic' | 'premium';
  amountMinor: number;
  currencyCode: string;
  status: 'pending' | 'successful' | 'failed';
  createdAt: string;
}> = [];

const createTransactionId = () => `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createReferralCode = (seed?: string) => {
  const prefix = (seed ?? 'AKONTA').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'AKONTA';
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
};
const addMonthsUtc = (value: Date, months: number): Date => {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const parseDateInput = (value?: string): Date => {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const parsePositiveInt = (value: unknown, fallback = 1): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const ensureReferralQualification = (userId: string) => {
  const user = users.find((entry) => entry.id === userId);
  if (!user || !user.referredByUserId) return;

  const referrerId = user.referredByUserId;
  const existing = referralConversionsByReferrer[referrerId] ?? [];
  if (!existing.some((item) => item.referredUserId === userId)) {
    existing.push({
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      referredUserId: userId,
      qualifiedAt: new Date().toISOString()
    });
    referralConversionsByReferrer[referrerId] = existing;
  }

  const rewards = referralRewardsByReferrer[referrerId] ?? [];
  const milestoneEarned = Math.floor(existing.length / REFERRAL_MILESTONE_SIZE);
  while (rewards.length < milestoneEarned) {
    const milestone = rewards.length + 1;
    rewards.push({
      id: `rwd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      milestone,
      grantedMonths: REFERRAL_REWARD_MONTHS,
      qualifiedReferralsAtGrant: milestone * REFERRAL_MILESTONE_SIZE,
      createdAt: new Date().toISOString()
    });

    const referrer = users.find((entry) => entry.id === referrerId);
    if (referrer) {
      const now = new Date();
      const baseEnd = referrer.subscriptionEndsAt
        ? new Date(referrer.subscriptionEndsAt)
        : now;
      const anchor = baseEnd > now ? baseEnd : now;
      referrer.subscriptionStatus = 'basic';
      referrer.subscriptionEndsAt = addMonthsUtc(anchor, REFERRAL_REWARD_MONTHS);
      referrer.freeSubscriptionMonthsEarned = (referrer.freeSubscriptionMonthsEarned ?? 0) + REFERRAL_REWARD_MONTHS;
    }
  }
  referralRewardsByReferrer[referrerId] = rewards;
};

export const mockCreateUser = async (body: Partial<User>): Promise<User> => {
  const id = `demo-${Date.now()}`;
  const createdAt = new Date();
  const normalizedReferral = body.referralCode?.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const referredByUserId = normalizedReferral ? userByReferralCode[normalizedReferral] ?? null : null;
  let referralCode = createReferralCode(body.name);
  while (userByReferralCode[referralCode]) {
    referralCode = createReferralCode(body.name);
  }

  const trialEndsAt = addMonthsUtc(createdAt, INITIAL_TRIAL_MONTHS);
  const defaultSubscriptionStatus = body.subscriptionStatus ?? 'trial';
  const user: User = {
    id,
    name: body.name ?? 'Demo User',
    phoneNumber: body.phoneNumber ?? '233000000000',
    businessName: body.businessName ?? 'Demo Business',
    businessType: body.businessType ?? 'Trading / Retail',
    preferredTime: body.preferredTime ?? 'evening',
    timezone: body.timezone ?? 'Africa/Accra',
    currencyCode: body.currencyCode ?? 'GHS',
    subscriptionStatus: defaultSubscriptionStatus,
    trialEndsAt: defaultSubscriptionStatus === 'trial' ? trialEndsAt : undefined,
    subscriptionEndsAt: body.subscriptionEndsAt ?? (defaultSubscriptionStatus === 'trial' ? trialEndsAt : null),
    freeSubscriptionMonthsEarned: body.freeSubscriptionMonthsEarned ?? 0,
    referralCode,
    referredByUserId,
    isSuperAdmin: body.isSuperAdmin ?? users.length === 0,
    createdAt,
  };
  users.push(user);
  userByReferralCode[referralCode] = id;
  transactionsByUser[id] = [...mockTransactions.map((tx) => ({ ...tx, id: `${tx.id}-${id}`, userId: id }))];
  budgetsByUser[id] = [];
  conversationSessionsByUser[id] = { step: 'idle' };
  customLineItemsByUser[id] = { inflow: [], expense: [] };
  ensureReferralQualification(id);
  return user;
};

export const mockGetUser = async (id: string): Promise<User | undefined> => users.find((user) => user.id === id);

export const mockListUsers = async (): Promise<User[]> => [...users];

export const mockUpdateUser = async (
  id: string,
  updates: Partial<Pick<User, 'name' | 'businessName' | 'businessType' | 'preferredTime' | 'timezone' | 'currencyCode'>>
): Promise<User> => {
  const user = users.find((entry) => entry.id === id);
  if (!user) throw new Error('User not found');
  Object.assign(user, updates);
  return user;
};

export const mockActivateUserSubscription = async (id: string, payload: {
  status?: 'free' | 'basic' | 'premium' | 'trial';
  months?: number;
  note?: string;
}): Promise<User> => {
  const user = users.find((entry) => entry.id === id);
  if (!user) throw new Error('User not found');

  const nextStatus = payload.status ?? user.subscriptionStatus;
  user.subscriptionStatus = nextStatus;
  if (nextStatus === 'basic' || nextStatus === 'premium') {
    const now = new Date();
    const anchorBase = user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt) : now;
    const anchor = anchorBase > now ? anchorBase : now;
    const months = Math.max(0, Math.floor(payload.months ?? 1));
    user.subscriptionEndsAt = months > 0 ? addMonthsUtc(anchor, months) : user.subscriptionEndsAt;
    user.trialEndsAt = undefined;
    ensureReferralQualification(id);
  } else if (nextStatus === 'trial') {
    const trialEnd = addMonthsUtc(new Date(), INITIAL_TRIAL_MONTHS);
    user.trialEndsAt = trialEnd;
    user.subscriptionEndsAt = trialEnd;
  } else {
    user.trialEndsAt = undefined;
    user.subscriptionEndsAt = null;
  }

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
  const user = users.find((entry) => entry.id === userId);
  const display = resolveDisplayPreferences(user?.currencyCode);
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
  const expenses = inRange.filter((tx) => isBusinessExpenseTx(tx)).reduce((sum, tx) => sum + tx.amount, 0);
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
    .filter((tx) => isBusinessExpenseTx(tx))
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
    highlights.push(`Sales are below month-to-date target by ${formatCurrencyForDisplay(Math.abs(revenueGap), display)}.`);
  }
  if (expenseGap !== undefined && expenseGap > 0.5) {
    highlights.push(`Expenses are above expected pace by ${formatCurrencyForDisplay(expenseGap, display)}.`);
  }
  if (overrunCategories.length > 0) {
    highlights.push(`${overrunCategories[0].category} is over budget by ${formatCurrencyForDisplay(overrunCategories[0].variance, display)}.`);
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
const resolveDisplayPreferences = (currencyCode?: string): { currencyCode: string; locale: string } => {
  const normalized = currencyCode?.trim().toUpperCase() || 'GHS';
  return {
    currencyCode: normalized,
    locale: CURRENCY_LOCALE_MAP[normalized] ?? 'en-GH'
  };
};
const formatCurrencyForDisplay = (amount: number, display: { currencyCode: string; locale: string }): string => {
  try {
    return new Intl.NumberFormat(display.locale, {
      style: 'currency',
      currency: display.currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${display.currencyCode} ${formatAmount(amount)}`;
  }
};
const toDateKeyUtc = (date: Date): string => date.toISOString().slice(0, 10);
const startOfUtcDate = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const addUtcDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const dateKeyToUtcDate = (dateKey: string): Date => new Date(`${dateKey}T12:00:00.000Z`);
const formatDisplayDateFromKey = (dateKey: string, display: { currencyCode: string; locale: string }): string => {
  const date = dateKeyToUtcDate(dateKey);
  try {
    return date.toLocaleDateString(display.locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return date.toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
};
const buildInitialGreeting = (name?: string): string => {
  const firstName = name?.trim().split(/\s+/)[0];
  if (firstName) {
    return `Good evening, ${firstName}. Let’s log today. How much money inflow came in today?`;
  }
  return 'Good evening. Let’s log today. How much money inflow came in today?';
};
const buildBackfillConsentPrompt = (dateKey: string, display: { currencyCode: string; locale: string }): string =>
  `You missed ${formatDisplayDateFromKey(dateKey, display)}. Add that day now? Reply 1 for Yes or 2 for Skip.`;
const buildBackfillInflowPrompt = (dateKey: string, display: { currencyCode: string; locale: string }): string =>
  `Great. Let’s backfill ${formatDisplayDateFromKey(dateKey, display)}. How much money inflow came in that day?`;
const buildInflowQuestionForLogDate = (display: { currencyCode: string; locale: string }, dateKey?: string): string =>
  dateKey ? `How much money inflow came in on ${formatDisplayDateFromKey(dateKey, display)}?` : 'How much money inflow came in today?';
const buildExpenseQuestionForLogDate = (display: { currencyCode: string; locale: string }, dateKey?: string): string =>
  dateKey ? `How much did the business spend on ${formatDisplayDateFromKey(dateKey, display)}?` : 'How much did the business spend today?';
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
  { label: 'Stock purchase (Direct)', eventType: 'stock_purchase' },
  { label: 'Supplier credit (Direct, non-cash)', eventType: 'supplier_credit' },
  { label: 'Operating expense (Indirect)', eventType: 'operating_expense' },
  { label: 'Owner withdrawal (Non-business)', eventType: 'owner_withdrawal' },
  { label: 'Loan repayment (Non-business)', eventType: 'loan_repayment' }
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
  return `${header}What type of money inflow was this?\n${lines.join('\n')}\nReply with 1-${lines.length} (or type the name). You can also reply BACK (0) or CANCEL (99).`;
};

const buildExpenseTypePrompt = (prefix?: string, customItems: string[] = []): string => {
  const header = prefix ? `${prefix}\n` : '';
  const lines = [
    ...baseExpenseTypeOptions.map((option, index) => `${index + 1}. ${option.label}`),
    ...customItems.map((label, index) => `${baseExpenseTypeOptions.length + index + 1}. ${label}`)
  ];
  return `${header}What type of expense was it? (This drives Direct vs Indirect in your reports.)\n${lines.join('\n')}\nReply with 1-${lines.length} (or type the name). You can also reply BACK (0) or CANCEL (99).`;
};

const buildCustomTypeConfirmPrompt = (
  label: string,
  kind: 'inflow' | 'expense'
): string => `“${label}” is not in the ${kind} type list. Add it as a new ${kind} line item? Reply YES or NO. (0 = BACK, 99 = CANCEL)`;

const buildAwaitConfirmPrompt = (): string =>
  'Reply with:\n1. SAVE (confirm)\n2. EDIT (adjust)\n0. BACK (previous step)\n99. CANCEL (stop)';

const salesCategoryForCurrentDraft = (session: {
  salesDraftId?: string;
  salesCategory?: string;
}): string | undefined => (session.salesDraftId ? session.salesCategory : undefined);

const expenseCategoryForCurrentDraft = (session: {
  expenseDraftId?: string;
  expenseCategory?: string;
}): string | undefined => (session.expenseDraftId ? session.expenseCategory : undefined);

const parseYesResponse = (text: string): boolean => /^(yes|y|ok|okay|confirm|add)$/i.test(text.trim());
const parseNoResponse = (text: string): boolean => /^(no|n)$/i.test(text.trim());
const parseBack = (text: string): boolean => /^(0|back|previous|prev|menu)$/i.test(text.trim());
const parseCancel = (text: string): boolean => /^(99|cancel|stop|quit|end)$/i.test(text.trim());
const parseNoValue = (text: string): boolean => /^(no|none|zero|nil|nothing|skip)$/i.test(text.trim());
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
        '1': 'stock_purchase',
        '2': 'supplier_credit',
        '3': 'operating_expense',
        '4': 'owner_withdrawal',
        '5': 'loan_repayment'
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

const defaultRevenueCategory = (eventType?: Transaction['eventType']): string | undefined => {
  if (!eventType) return undefined;
  if (eventType === 'cash_sale') return 'Cash sale';
  if (eventType === 'momo_sale') return 'MoMo sale';
  if (eventType === 'credit_sale') return 'Credit sale';
  if (eventType === 'debtor_recovery') return 'Debtor recovery';
  if (eventType === 'capital_introduced') return 'Capital introduced';
  if (eventType === 'loan_received') return 'Loan received';
  return undefined;
};

const buildDraftSummary = (params: {
  salesAmount?: number;
  salesEventType?: Transaction['eventType'];
  salesCategory?: string;
  expenseAmount?: number;
  expenseEventType?: Transaction['eventType'];
  expenseCategory?: string;
  display: {
    currencyCode: string;
    locale: string;
  };
}) => {
  const lines: string[] = [];
  if (params.salesAmount !== undefined) lines.push(`Inflow: ${formatCurrencyForDisplay(params.salesAmount, params.display)}`);
  if (params.salesEventType) {
    if (params.salesEventType === 'other' && params.salesCategory) {
      lines.push(`Inflow type: ${params.salesCategory}`);
    } else {
      lines.push(`Inflow type: ${humanizeEventType(params.salesEventType)}`);
    }
  }
  if (params.expenseAmount !== undefined) lines.push(`Expense: ${formatCurrencyForDisplay(params.expenseAmount, params.display)}`);
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

const buildMockPostSaveAdvice = async (
  userId: string,
  display: { currencyCode: string; locale: string }
): Promise<string | null> => {
  const insights = await mockGetCurrentInsights(userId);
  const advice: string[] = [];
  const revenueGap = insights.targetStatus.revenueGapToDate;
  const expenseGap = insights.expenseOverrun.varianceByNow;

  if (insights.targetStatus.revenueStatus === 'behind' && revenueGap !== undefined) {
    advice.push(`Sales are behind pace by ${formatCurrencyForDisplay(Math.abs(revenueGap), display)}. Prioritize high-turnover items this week.`);
  } else if (insights.targetStatus.revenueStatus === 'ahead' && revenueGap !== undefined) {
    advice.push(`Sales are ahead of pace by ${formatCurrencyForDisplay(revenueGap, display)}. Keep this consistency through month-end.`);
  }

  if (insights.expenseOverrun.isOverrun) {
    if (expenseGap !== undefined && expenseGap > 0) {
      advice.push(`Expenses are above expected pace by ${formatCurrencyForDisplay(expenseGap, display)}. Tighten spending on non-urgent costs.`);
    } else if (insights.expenseOverrun.overrunCategories.length > 0) {
      const top = insights.expenseOverrun.overrunCategories[0];
      advice.push(`${top.category} is over budget by ${formatCurrencyForDisplay(top.variance, display)}. Review that line item first.`);
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
  const display = resolveDisplayPreferences(currentUser?.currencyCode);
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

  if (session.step !== 'idle' && parseCancel(trimmed)) {
    session.step = 'idle';
    session.salesDraftId = undefined;
    session.expenseDraftId = undefined;
    session.salesEventType = undefined;
    session.salesCategory = undefined;
    session.salesTypeConfirmed = false;
    session.expenseEventType = undefined;
    session.expenseCategory = undefined;
    session.expenseTypeConfirmed = false;
    session.logDateKey = undefined;
    session.pendingBackfillDateKey = undefined;
    session.pendingSalesTypeLabel = undefined;
    session.pendingExpenseTypeLabel = undefined;
    return {
      botReply: 'No problem. I have cancelled this draft. Send a message when you are ready to log again.',
      conversation: {
        step: session.step,
        awaitingConfirmation: false
      },
      transactions: touched,
      summary: createSummary(touched),
      monthlySummary: createSummary((transactionsByUser[userId] ?? []).filter((tx) => tx.status === 'confirmed' && !tx.correctionOfId)),
      budgetStatuses: []
    };
  }

  if (session.step !== 'idle' && parseBack(trimmed)) {
    if (session.step === 'ask_backfill_consent') {
      session.pendingBackfillDateKey = undefined;
      session.logDateKey = undefined;
      session.step = 'idle';
      botReply = 'Okay. Back to start. Send a message when you are ready to log today.';
    } else if (session.step === 'ask_sales_type' || session.step === 'confirm_sales_type_custom') {
      session.pendingSalesTypeLabel = undefined;
      session.salesTypeConfirmed = false;
      session.step = 'ask_sales';
      botReply = `Back to inflow amount. ${buildInflowQuestionForLogDate(display, session.logDateKey)} (Reply NO if there was no inflow.)`;
    } else if (session.step === 'ask_expense_type' || session.step === 'confirm_expense_type_custom' || session.step === 'ask_expense_category') {
      session.pendingExpenseTypeLabel = undefined;
      session.expenseTypeConfirmed = false;
      session.step = 'ask_expense';
      botReply = `Back to expense amount. ${buildExpenseQuestionForLogDate(display, session.logDateKey)}`;
    } else if (session.step === 'await_confirm') {
      session.pendingSalesTypeLabel = undefined;
      session.pendingExpenseTypeLabel = undefined;
      session.salesTypeConfirmed = false;
      session.expenseTypeConfirmed = false;
      session.step = 'ask_sales';
      botReply = `Back to edit mode. ${buildInflowQuestionForLogDate(display, session.logDateKey)} (Reply NO if there was no inflow.)`;
    } else {
      session.step = 'ask_sales';
      botReply = `${buildInflowQuestionForLogDate(display, session.logDateKey)} (Reply NO if there was no inflow.)`;
    }
  }

  if (botReply && session.step !== 'idle') {
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
          .filter((tx) => matchesBudgetTarget(tx, budget.targetType))
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
  }

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
          botReply = buildBackfillConsentPrompt(missedDateKey, display);
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
          category: revenueParsed.category
            ?? salesCategoryForCurrentDraft(session)
            ?? defaultRevenueCategory(salesEventType)
            ?? 'Cash sale',
          notes: revenueParsed.notes
        });
        session.salesDraftId = sales.id;
        session.salesEventType = salesEventType;
        session.salesCategory = sales.category
          ?? revenueParsed.category
          ?? defaultRevenueCategory(salesEventType)
          ?? 'Cash sale';
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
        botReply = `I noted the expense draft. ${buildInflowQuestionForLogDate(display, session.logDateKey)} Reply NO if there was no inflow.`;
      } else if (!session.salesTypeConfirmed) {
        session.step = 'ask_sales_type';
        botReply = buildSalesTypePrompt('Noted.', customInflowItems);
      } else if (!session.expenseDraftId) {
        session.step = 'ask_expense';
        botReply = `Recorded draft inflow. ${buildExpenseQuestionForLogDate(display, session.logDateKey)}`;
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
            expenseCategory: expenseDraft?.category ?? session.expenseCategory,
            display
          })}\n\n${buildAwaitConfirmPrompt()}`;
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
      botReply = buildBackfillInflowPrompt(backfillDateKey, display);
    } else if (isBackfillNo(trimmed)) {
      session.logDateKey = undefined;
      session.pendingBackfillDateKey = undefined;
      session.step = 'ask_sales';
      botReply = 'No problem. How much money inflow came in today?';
    } else {
      botReply = `${buildBackfillConsentPrompt(backfillDateKey, display)} Reply with 1 or 2.`;
    }
  } else if (session.step === 'ask_sales') {
    if (parseNoValue(trimmed)) {
      session.salesDraftId = undefined;
      session.salesEventType = undefined;
      session.salesTypeConfirmed = true;
      session.salesCategory = undefined;
      session.pendingSalesTypeLabel = undefined;

      if (!session.expenseDraftId) {
        session.step = 'ask_expense';
        botReply = `Inflow recorded as ${formatCurrencyForDisplay(0, display)}. ${buildExpenseQuestionForLogDate(display, session.logDateKey)}`;
      } else if (!session.expenseTypeConfirmed) {
        const expenseDraft = findTransaction(session.expenseDraftId);
        session.step = 'ask_expense_type';
        botReply = buildExpenseTypePrompt(
          `Inflow recorded as ${formatCurrencyForDisplay(0, display)}. Recorded draft expense: ${formatCurrencyForDisplay(expenseDraft?.amount ?? 0, display)}.`,
          customExpenseItems
        );
      } else {
        const expenseDraft = findTransaction(session.expenseDraftId);
        if (!expenseDraft?.category && (expenseDraft?.amount ?? 0) > 0) {
          session.step = 'ask_expense_category';
          botReply = `Inflow recorded as ${formatCurrencyForDisplay(0, display)}. Recorded draft expense: ${formatCurrencyForDisplay(expenseDraft?.amount ?? 0, display)}. What was it spent on?`;
        } else {
          session.step = 'await_confirm';
          botReply = `Draft summary:\n${buildDraftSummary({
            salesAmount: 0,
            expenseAmount: expenseDraft?.amount,
            expenseEventType: session.expenseEventType,
            expenseCategory: expenseDraft?.category ?? session.expenseCategory,
            display
          })}\n\n${buildAwaitConfirmPrompt()}`;
        }
      }
    } else {
      const shouldTreatAsExpenseFirst = Boolean(
        (expenseParsed && !revenueParsed)
        || (!revenueParsed && explicitExpenseEvent && !explicitSalesEvent)
      );

      if (shouldTreatAsExpenseFirst) {
        const expenseAmount = expenseParsed?.amount ?? parseAmount(trimmed);
        if (expenseAmount === null) {
          botReply = `If this is an expense, send amount + label (example: "230 transport"). Otherwise, ${buildInflowQuestionForLogDate(display, session.logDateKey)}`;
        } else {
          const expenseEventType = explicitExpenseEvent ?? session.expenseEventType ?? 'operating_expense';
          const expenseCategory = expenseParsed?.category
            ?? expenseCategoryForCurrentDraft(session)
            ?? defaultExpenseCategory(expenseEventType);
          const expense = await upsertDraft({
            draftId: session.expenseDraftId,
            type: 'expense',
            amount: expenseAmount,
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
            botReply = buildExpenseTypePrompt(`Recorded draft expense: ${formatCurrencyForDisplay(expenseAmount, display)}.`, customExpenseItems);
          } else if (!session.expenseCategory && expenseAmount > 0) {
            session.step = 'ask_expense_category';
            botReply = `Recorded expense type as ${humanizeEventType(session.expenseEventType)}. What was it spent on?`;
          } else {
            session.step = 'ask_sales';
            botReply = `Recorded draft expense: ${formatCurrencyForDisplay(expenseAmount, display)}. ${buildInflowQuestionForLogDate(display, session.logDateKey)} Reply NO if there was no inflow.`;
          }
        }
      } else {
        const amount = revenueParsed?.amount ?? parseAmount(trimmed);
        if (amount === null) {
          botReply = `Please send the money inflow amount in ${display.currencyCode} so I can save it as draft. Example: "Inflow 850". You can also reply NO if there was no inflow.`;
        } else {
          const salesEventType = explicitSalesEvent ?? session.salesEventType ?? 'cash_sale';
          const sales = await upsertDraft({
            draftId: session.salesDraftId,
            type: 'revenue',
            amount,
            date: logDate,
            eventType: salesEventType,
            category: revenueParsed?.category
              ?? salesCategoryForCurrentDraft(session)
              ?? defaultRevenueCategory(salesEventType)
              ?? 'Cash sale',
            notes: revenueParsed?.notes
          });
          session.salesDraftId = sales.id;
          session.salesEventType = salesEventType;
          session.salesCategory = sales.category
            ?? revenueParsed?.category
            ?? defaultRevenueCategory(salesEventType)
            ?? 'Cash sale';
          if (explicitSalesEvent) session.salesTypeConfirmed = true;
          session.pendingSalesTypeLabel = undefined;
          session.step = session.salesTypeConfirmed ? 'ask_expense' : 'ask_sales_type';
          botReply = session.step === 'ask_sales_type'
            ? buildSalesTypePrompt(`Recorded draft inflow: ${formatCurrencyForDisplay(amount, display)}.`, customInflowItems)
            : `Recorded draft inflow: ${formatCurrencyForDisplay(amount, display)}. ${buildExpenseQuestionForLogDate(display, session.logDateKey)} (Reply NO if there was no expense.)`;
        }
      }
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
        ? salesChoice.customLabel ?? salesCategoryForCurrentDraft(session) ?? 'Other'
        : defaultRevenueCategory(salesChoice.eventType) ?? 'Cash sale';
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
      botReply = `Inflow type recorded as ${inflowTypeLabel}. ${buildExpenseQuestionForLogDate(display, session.logDateKey)}`;
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
      botReply = `Inflow type recorded as ${savedLabel}. ${buildExpenseQuestionForLogDate(display, session.logDateKey)}`;
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
        expenseAmount: 0,
        display
      })}\n\n${buildAwaitConfirmPrompt()}`;
    } else {
      const amount = expenseParsed?.amount ?? parseAmount(trimmed);
      if (amount === null) {
        botReply = `Please send the expense amount in ${display.currencyCode}, or type NO if there was no expense. Example: "Spent 200".`;
      } else {
        const expenseEventType = explicitExpenseEvent ?? session.expenseEventType ?? 'operating_expense';
        const expenseCategory = expenseParsed?.category
          ?? expenseCategoryForCurrentDraft(session)
          ?? defaultExpenseCategory(expenseEventType);
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
          botReply = buildExpenseTypePrompt(`Recorded draft expense: ${formatCurrencyForDisplay(amount, display)}.`, customExpenseItems);
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
            expenseCategory: session.expenseCategory,
            display
          })}\n\n${buildAwaitConfirmPrompt()}`;
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
          expenseCategory: session.expenseCategory,
          display
        })}\n\n${buildAwaitConfirmPrompt()}`;
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
        expenseCategory: session.expenseCategory,
        display
      })}\n\n${buildAwaitConfirmPrompt()}`;
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
        expenseCategory: updated.category,
        display
      })}\n\n${buildAwaitConfirmPrompt()}`;
    }
  } else if (session.step === 'await_confirm') {
    if (/^(1|save|confirm|yes|y|ok|okay|done)$/i.test(lower)) {
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
      session.salesEventType = undefined;
      session.salesCategory = undefined;
      session.salesTypeConfirmed = false;
      session.expenseEventType = undefined;
      session.expenseCategory = undefined;
      session.expenseTypeConfirmed = false;
      session.logDateKey = undefined;
      session.pendingBackfillDateKey = undefined;
      session.pendingSalesTypeLabel = undefined;
      session.pendingExpenseTypeLabel = undefined;
      const advice = await buildMockPostSaveAdvice(userId, display);
      botReply = advice
        ? `Saved. Your entries are now confirmed.\n\n${advice}\n\nSend another message when you are ready to log more.`
        : 'Saved. Your entries are now confirmed. Send another message when you are ready to log more.';
    } else if (/^(2|edit|change|update|no)$/i.test(lower)) {
      session.step = 'ask_sales';
      session.salesTypeConfirmed = false;
      session.expenseTypeConfirmed = false;
      session.pendingBackfillDateKey = undefined;
      session.pendingSalesTypeLabel = undefined;
      session.pendingExpenseTypeLabel = undefined;
      botReply = 'Okay, let’s adjust the draft. What is the correct money inflow amount?';
    } else {
      botReply = buildAwaitConfirmPrompt();
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
        .filter((tx) => matchesBudgetTarget(tx, budget.targetType))
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

export const mockGetReferralProgress = async (userId: string): Promise<ReferralProgress> => {
  const user = users.find((entry) => entry.id === userId);
  if (!user) throw new Error('User not found');
  if (!user.referralCode) {
    let code = createReferralCode(user.name);
    while (userByReferralCode[code]) {
      code = createReferralCode(user.name);
    }
    user.referralCode = code;
    userByReferralCode[code] = user.id;
  }

  const conversions = referralConversionsByReferrer[userId] ?? [];
  const rewards = referralRewardsByReferrer[userId] ?? [];
  const totalRewardMonths = rewards.reduce((sum, item) => sum + item.grantedMonths, 0);
  const progress = conversions.length % REFERRAL_MILESTONE_SIZE;
  const remainingForNextReward = progress === 0 ? REFERRAL_MILESTONE_SIZE : REFERRAL_MILESTONE_SIZE - progress;

  return {
    referralCode: user.referralCode,
    referralLink: `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`,
    qualifiedReferrals: conversions.length,
    rewardMilestoneSize: REFERRAL_MILESTONE_SIZE,
    remainingForNextReward,
    totalRewardMonths,
    rewards: rewards.map((reward) => ({ ...reward })),
    recentConversions: conversions
      .slice()
      .sort((a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt))
      .slice(0, 8)
      .map((conversion) => {
        const referredUser = users.find((entry) => entry.id === conversion.referredUserId);
        return {
          id: conversion.id,
          qualifiedAt: conversion.qualifiedAt,
          referredUser: {
            id: referredUser?.id ?? conversion.referredUserId,
            name: referredUser?.name ?? 'Unknown user',
            businessName: referredUser?.businessName ?? null,
            subscriptionStatus: referredUser?.subscriptionStatus ?? 'free'
          }
        };
      })
  };
};

export const mockGetAdminAnalytics = async (): Promise<AdminAnalytics> => {
  const total = users.length;
  const basic = users.filter((user) => user.subscriptionStatus === 'basic').length;
  const premium = users.filter((user) => user.subscriptionStatus === 'premium').length;
  const trial = users.filter((user) => user.subscriptionStatus === 'trial').length;
  const free = users.filter((user) => user.subscriptionStatus === 'free').length;
  const totalBusinesses = users.length;
  const businessCounts = users.reduce<Record<string, number>>((acc, user) => {
    const key = user.businessType || 'Unspecified';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const locationCounts = users.reduce<Record<string, number>>((acc, user) => {
    const key = user.timezone || 'Unspecified';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const conversions = Object.values(referralConversionsByReferrer).reduce((sum, items) => sum + items.length, 0);
  const rewards = Object.values(referralRewardsByReferrer).flat();
  const days = 14;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const daily = Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const dateKey = day.toISOString().slice(0, 10);
    const successful = subscriptionPayments.filter(
      (payment) =>
        payment.status === 'successful' &&
        payment.createdAt.slice(0, 10) === dateKey
    );
    return {
      date: dateKey,
      count: successful.length,
      revenue: successful.reduce((sum, payment) => sum + payment.amountMinor / 100, 0)
    };
  });
  const dailyRevenueTotal = daily.reduce((sum, day) => sum + day.revenue, 0);

  const allTransactions = Object.values(transactionsByUser).flat();
  const last30Start = new Date();
  last30Start.setUTCDate(last30Start.getUTCDate() - 29);
  const last30Transactions = allTransactions.filter((tx) => {
    const createdAt = new Date(tx.createdAt);
    return createdAt >= last30Start;
  });
  const revenueLast30 = last30Transactions
    .filter((tx) => tx.type === 'revenue' && tx.status === 'confirmed')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const expensesLast30 = last30Transactions
    .filter((tx) => tx.type === 'expense' && tx.status === 'confirmed')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const recentActivity = [
    ...subscriptionPayments
      .filter((payment) => payment.status === 'successful')
      .map((payment) => {
        const user = users.find((entry) => entry.id === payment.userId);
        return {
          id: `subscription-${payment.id}`,
          type: 'subscription' as const,
          title: 'Subscription payment succeeded',
          description: `${payment.currencyCode} ${(payment.amountMinor / 100).toFixed(2)}`,
          businessName: user?.businessName ?? 'Unknown workspace',
          actorName: user?.name ?? 'Unknown user',
          occurredAt: payment.createdAt
        };
      }),
    ...last30Transactions.map((tx) => ({
      id: `transaction-${tx.id}`,
      type: 'transaction' as const,
      title: tx.type === 'revenue' ? 'Revenue entry created' : 'Expense entry created',
      description: `${tx.status ?? 'confirmed'} • ${tx.amount.toFixed(2)}`,
      businessName: users.find((entry) => entry.id === tx.userId)?.businessName ?? 'Unknown workspace',
      actorName: users.find((entry) => entry.id === tx.userId)?.name ?? 'Unknown user',
      occurredAt: new Date(tx.createdAt).toISOString()
    }))
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 40);

  const upcomingRenewals = users
    .filter((user) => (user.subscriptionStatus === 'basic' || user.subscriptionStatus === 'premium') && Boolean(user.subscriptionEndsAt))
    .map((user) => {
      const renewalDate = new Date(user.subscriptionEndsAt as Date | string);
      const msRemaining = renewalDate.getTime() - now.getTime();
      const daysUntilRenewal = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
      const plan = user.subscriptionStatus === 'premium' ? 'premium' as const : 'basic' as const;
      const expectedAmount = plan === 'premium' ? mockPaystackSettings.premiumAmount : mockPaystackSettings.basicAmount;
      return {
        businessId: user.id,
        businessName: user.businessName || `${user.name}'s Business`,
        ownerName: user.fullName || user.name,
        plan,
        renewalDate: renewalDate.toISOString(),
        daysUntilRenewal,
        expectedAmount,
        currencyCode: mockPaystackSettings.currencyCode,
        autoRenewReady: false
      };
    })
    .filter((entry) => entry.daysUntilRenewal <= 30)
    .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal)
    .slice(0, 100);

  const upcomingNext7 = upcomingRenewals.filter((item) => item.daysUntilRenewal <= 7);
  const upcomingNext30 = upcomingRenewals.filter((item) => item.daysUntilRenewal <= 30);

  const subscriptionRevenueLast30 = subscriptionPayments
    .filter((payment) => payment.status === 'successful')
    .filter((payment) => {
      const created = new Date(payment.createdAt);
      return created >= last30Start;
    })
    .reduce((sum, payment) => sum + payment.amountMinor / 100, 0);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const subscriptionRevenueMonthToDate = subscriptionPayments
    .filter((payment) => payment.status === 'successful')
    .filter((payment) => {
      const created = new Date(payment.createdAt);
      return created >= monthStart;
    })
    .reduce((sum, payment) => sum + payment.amountMinor / 100, 0);

  return {
    users: {
      total,
      subscribed: basic + premium + trial,
      paid: basic + premium,
      basic,
      premium,
      trial,
      free
    },
    tiers: {
      free,
      basic,
      premium,
      trial
    },
    businesses: {
      total: totalBusinesses,
      free,
      basic,
      premium,
      trial
    },
    subscriptions: {
      paidStarts: subscriptionPayments.filter((payment) => payment.status === 'successful').length,
      daily,
      inflows: {
        currencyCode: mockPaystackSettings.currencyCode,
        last14Days: dailyRevenueTotal,
        last30Days: subscriptionRevenueLast30,
        monthToDate: subscriptionRevenueMonthToDate
      },
      upcomingRenewals: {
        currencyCode: mockPaystackSettings.currencyCode,
        next7DaysCount: upcomingNext7.length,
        next30DaysCount: upcomingNext30.length,
        expectedRevenueNext7Days: upcomingNext7.reduce((sum, item) => sum + item.expectedAmount, 0),
        expectedRevenueNext30Days: upcomingNext30.reduce((sum, item) => sum + item.expectedAmount, 0),
        autoRenewReadyCount: upcomingNext30.filter((item) => item.autoRenewReady).length,
        list: upcomingRenewals
      }
    },
    locations: Object.entries(locationCounts)
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count),
    channels: {
      app: last30Transactions.length,
      whatsapp: 0,
      system: 0
    },
    activity: {
      last30Days: {
        transactions: last30Transactions.length,
        revenue: revenueLast30,
        expenses: expensesLast30,
        net: revenueLast30 - expensesLast30
      },
      recent: recentActivity
    },
    referrals: {
      qualifiedConversions: conversions,
      rewardsGranted: rewards.length,
      freeMonthsGranted: rewards.reduce((sum, item) => sum + item.grantedMonths, 0)
    },
    businessTypes: Object.entries(businessCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    whatsapp: {
      provider: activeProvider,
      availableProviders: [...defaultProviderInfo.available]
    }
  };
};

export const mockGetAdminWhatsAppProvider = async (): Promise<AdminWhatsAppSettings> => ({
  provider: activeProvider,
  available: [...defaultProviderInfo.available],
  whatchimp: { ...mockWhatchimpSettings }
});

export const mockSetAdminWhatsAppProvider = async (
  payload: {
    provider?: WhatsAppProvider;
    whatchimp?: Partial<AdminWhatsAppSettings['whatchimp']>;
  }
): Promise<AdminWhatsAppSettings> => {
  if (payload.provider) {
    activeProvider = payload.provider;
  }
  if (payload.whatchimp) {
    mockWhatchimpSettings = {
      ...mockWhatchimpSettings,
      ...payload.whatchimp
    };
  }
  return {
    provider: activeProvider,
    available: [...defaultProviderInfo.available],
    whatchimp: { ...mockWhatchimpSettings }
  };
};

export const mockGetAdminPaymentSettings = async (): Promise<AdminPaymentSettings> => ({
  ...mockPaystackSettings
});

export const mockSetAdminPaymentSettings = async (
  payload: Partial<AdminPaymentSettings>
): Promise<AdminPaymentSettings> => {
  mockPaystackSettings = {
    ...mockPaystackSettings,
    ...payload,
    basicAmount: payload.basicAmount !== undefined
      ? Math.max(1, Math.floor(payload.basicAmount))
      : mockPaystackSettings.basicAmount,
    premiumAmount: payload.premiumAmount !== undefined
      ? Math.max(1, Math.floor(payload.premiumAmount))
      : mockPaystackSettings.premiumAmount,
    currencyCode: payload.currencyCode ? payload.currencyCode.toUpperCase() : mockPaystackSettings.currencyCode
  };
  return { ...mockPaystackSettings };
};

export const mockInitializeSubscriptionPayment = async (payload: {
  userId: string;
  plan?: 'basic' | 'premium';
  months?: number;
  callbackUrl?: string;
  customerEmail?: string;
}): Promise<SubscriptionPaymentInitialization> => {
  const months = parsePositiveInt(payload.months, 1);
  const plan = payload.plan === 'premium' ? 'premium' : 'basic';
  const amountMajor = (plan === 'premium' ? mockPaystackSettings.premiumAmount : mockPaystackSettings.basicAmount) * months;
  const amountMinor = amountMajor * 100;
  const reference = `mock_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  subscriptionPayments.push({
    id: `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    reference,
    userId: payload.userId,
    plan,
    amountMinor,
    currencyCode: mockPaystackSettings.currencyCode,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  return {
    reference,
    authorizationUrl: `${window.location.origin}${window.location.pathname}?reference=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(reference)}`,
    accessCode: `access_${Math.random().toString(36).slice(2, 10)}`,
    amountMinor,
    amountMajor,
    currencyCode: mockPaystackSettings.currencyCode,
    plan,
    months,
    publicKey: mockPaystackSettings.paystackPublicKey || null
  };
};

export const mockVerifySubscriptionPayment = async (payload: {
  reference: string;
}): Promise<SubscriptionPaymentVerification> => {
  const payment = subscriptionPayments.find((entry) => entry.reference === payload.reference);
  if (!payment) {
    return {
      status: 'failed',
      applied: false,
      user: null
    };
  }

  if (payment.status !== 'successful') {
    payment.status = 'successful';
    payment.createdAt = new Date().toISOString();
    await mockActivateUserSubscription(payment.userId, {
      status: payment.plan,
      months: 1,
      note: 'Mock Paystack payment success'
    });
  }

  const user = users.find((entry) => entry.id === payment.userId) ?? null;
  return {
    status: 'success',
    applied: true,
    user
  };
};

export const mockGetWhatsAppProviderInfo = async () => ({
  default: activeProvider,
  available: [...defaultProviderInfo.available]
});

export const mockSendWhatsAppMessage = async (_to: string, _message: string, provider?: string) => {
  return { success: true, provider: provider ?? activeProvider, result: { message: 'Mock send queued' } };
};

export const mockHealth = async (): Promise<boolean> => true;
