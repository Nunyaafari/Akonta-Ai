import { Prisma } from '@prisma/client';
import type { ConversationChannel, Transaction } from '@prisma/client';
import db from '../lib/db.js';
import { parseWhatsAppEntry, type ParsedTransaction } from './parsing.js';
import { computeSummary } from './summaries.js';
import { getBudgetsForPeriod, computeBudgetStatus } from './budgets.js';
import { getMonthlyInsights } from './insights.js';

type ConversationStep =
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

interface ConversationContext {
  salesTransactionId?: string;
  expenseTransactionId?: string;
  logDateKey?: string;
  pendingBackfillDateKey?: string;
  salesAmount?: number;
  salesEventType?: ParsedTransaction['eventType'];
  salesCategory?: string;
  salesTypeConfirmed?: boolean;
  expenseAmount?: number;
  expenseEventType?: ParsedTransaction['eventType'];
  expenseTypeConfirmed?: boolean;
  expenseCategory?: string;
  pendingSalesTypeLabel?: string;
  pendingExpenseTypeLabel?: string;
}

interface ProcessConversationParams {
  userId: string;
  message: string;
  channel: ConversationChannel;
}

export interface ConversationResult {
  botReply: string;
  conversation: {
    step: ConversationStep;
    awaitingConfirmation: boolean;
  };
  transactions: Transaction[];
  summary: ReturnType<typeof computeSummary>;
  monthlySummary: ReturnType<typeof computeSummary>;
  budgetStatuses: ReturnType<typeof computeBudgetStatus>[];
}

const parseAmountFromText = (text: string): number | null => {
  const cleaned = text.replace(/,/g, '');
  const match = cleaned.match(/(\d+(?:[.]\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (Number.isNaN(amount) || amount <= 0) return null;
  return amount;
};

const parseNoValue = (text: string): boolean => /^(no|none|zero|nil|nothing|skip)$/i.test(text.trim());
const parseConfirm = (text: string): boolean => /^(1|save|confirm|yes|y|ok|okay|done)$/i.test(text.trim());
const parseEdit = (text: string): boolean => /^(2|edit|change|update|no)$/i.test(text.trim());
const parseYesResponse = (text: string): boolean => /^(yes|y|ok|okay|confirm|add)$/i.test(text.trim());
const parseNoResponse = (text: string): boolean => /^(no|n)$/i.test(text.trim());
const parseBack = (text: string): boolean => /^(0|back|previous|prev|menu)$/i.test(text.trim());
const parseCancel = (text: string): boolean => /^(99|cancel|stop|quit|end)$/i.test(text.trim());
const formatAmount = (amount: number): string => Number(amount.toFixed(2)).toString();
const isBackfillYes = (text: string): boolean => parseYesResponse(text) || /^1$/.test(text.trim());
const isBackfillNo = (text: string): boolean => parseNoResponse(text) || /^2$/.test(text.trim());

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
  { label: 'Stock purchase (Direct)', eventType: 'stock_purchase' },
  { label: 'Supplier credit (Direct, non-cash)', eventType: 'supplier_credit' },
  { label: 'Operating expense (Indirect)', eventType: 'operating_expense' },
  { label: 'Owner withdrawal (Non-business)', eventType: 'owner_withdrawal' },
  { label: 'Loan repayment (Non-business)', eventType: 'loan_repayment' }
] as const;

const normalizeCustomLineItemLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').slice(0, 80);
const createCustomLineItemId = (): string => `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const parseOptionNumber = (text: string): number | undefined => {
  const numericMatch = text.trim().toLowerCase().match(/^(?:option\s*)?\(?(\d{1,2})\)?[.)]?\s*$/i);
  if (!numericMatch) return undefined;
  const parsed = Number(numericMatch[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

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

const salesCategoryForCurrentDraft = (context: ConversationContext): string | undefined =>
  context.salesTransactionId ? context.salesCategory : undefined;

const expenseCategoryForCurrentDraft = (context: ConversationContext): string | undefined =>
  context.expenseTransactionId ? context.expenseCategory : undefined;

const resolveSalesTypeChoice = (
  text: string,
  customItems: string[]
): {
  eventType?: ParsedTransaction['eventType'];
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
  eventType?: ParsedTransaction['eventType'];
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

const listCustomLineItems = async (
  userId: string,
  kind: 'inflow' | 'expense'
): Promise<string[]> => {
  try {
    const items = await db.$queryRaw<Array<{ label: string }>>(Prisma.sql`
      SELECT "label"
      FROM "CustomLineItem"
      WHERE "userId" = ${userId}
        AND "kind" = ${kind}
      ORDER BY "usageCount" DESC, "lastUsedAt" DESC
      LIMIT 5
    `);
    return items.map((item) => item.label);
  } catch {
    return [];
  }
};

const rememberCustomLineItem = async (
  userId: string,
  kind: 'inflow' | 'expense',
  rawLabel: string
): Promise<string | null> => {
  const label = normalizeCustomLineItemLabel(rawLabel);
  if (!label) return null;
  const normalizedLabel = label.toLowerCase();
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "CustomLineItem" (
        "id",
        "userId",
        "kind",
        "label",
        "normalizedLabel",
        "usageCount",
        "lastUsedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${createCustomLineItemId()},
        ${userId},
        ${kind},
        ${label},
        ${normalizedLabel},
        1,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT ("userId", "kind", "normalizedLabel")
      DO UPDATE SET
        "label" = EXCLUDED."label",
        "usageCount" = "CustomLineItem"."usageCount" + 1,
        "lastUsedAt" = NOW(),
        "updatedAt" = NOW()
    `);
    return label;
  } catch {
    return label;
  }
};

const parseSalesEventTypeFromText = (
  text: string,
  options?: { allowNumericChoice?: boolean }
): ParsedTransaction['eventType'] | undefined => {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  const allowNumericChoice = options?.allowNumericChoice ?? true;
  if (allowNumericChoice) {
    const numericMatch = value.match(/^(?:option\s*)?\(?([1-6])\)?[.)]?\s*$/i);
    if (numericMatch) {
      const fromNumeric: Record<string, ParsedTransaction['eventType']> = {
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
): ParsedTransaction['eventType'] | undefined => {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  const allowNumericChoice = options?.allowNumericChoice ?? true;
  if (allowNumericChoice) {
    const numericMatch = value.match(/^(?:option\s*)?\(?([1-5])\)?[.)]?\s*$/i);
    if (numericMatch) {
      const fromNumeric: Record<string, ParsedTransaction['eventType']> = {
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

const humanizeEventType = (eventType?: ParsedTransaction['eventType']): string | undefined => {
  if (!eventType) return undefined;
  const labels: Record<NonNullable<ParsedTransaction['eventType']>, string> = {
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
  return labels[eventType];
};

const defaultExpenseCategory = (eventType?: ParsedTransaction['eventType']): string | undefined => {
  if (!eventType) return undefined;
  if (eventType === 'owner_withdrawal') return 'Owner withdrawal';
  if (eventType === 'stock_purchase') return 'Stock purchase';
  if (eventType === 'supplier_credit') return 'Supplier credit';
  if (eventType === 'loan_repayment') return 'Loan repayment';
  return undefined;
};

const defaultRevenueCategory = (eventType?: ParsedTransaction['eventType']): string | undefined => {
  if (!eventType) return undefined;
  if (eventType === 'cash_sale') return 'Cash sale';
  if (eventType === 'momo_sale') return 'MoMo sale';
  if (eventType === 'credit_sale') return 'Credit sale';
  if (eventType === 'debtor_recovery') return 'Debtor recovery';
  if (eventType === 'capital_introduced') return 'Capital introduced';
  if (eventType === 'loan_received') return 'Loan received';
  return undefined;
};

const normalizeContext = (value: unknown): ConversationContext => {
  if (!value || typeof value !== 'object') return {};
  const ctx = value as Record<string, unknown>;
  return {
    salesTransactionId: typeof ctx.salesTransactionId === 'string' ? ctx.salesTransactionId : undefined,
    expenseTransactionId: typeof ctx.expenseTransactionId === 'string' ? ctx.expenseTransactionId : undefined,
    logDateKey: typeof ctx.logDateKey === 'string' ? ctx.logDateKey : undefined,
    pendingBackfillDateKey: typeof ctx.pendingBackfillDateKey === 'string' ? ctx.pendingBackfillDateKey : undefined,
    salesAmount: typeof ctx.salesAmount === 'number' ? ctx.salesAmount : undefined,
    salesEventType: typeof ctx.salesEventType === 'string' ? ctx.salesEventType as ParsedTransaction['eventType'] : undefined,
    salesCategory: typeof ctx.salesCategory === 'string' ? ctx.salesCategory : undefined,
    salesTypeConfirmed: typeof ctx.salesTypeConfirmed === 'boolean' ? ctx.salesTypeConfirmed : undefined,
    expenseAmount: typeof ctx.expenseAmount === 'number' ? ctx.expenseAmount : undefined,
    expenseEventType: typeof ctx.expenseEventType === 'string' ? ctx.expenseEventType as ParsedTransaction['eventType'] : undefined,
    expenseTypeConfirmed: typeof ctx.expenseTypeConfirmed === 'boolean' ? ctx.expenseTypeConfirmed : undefined,
    expenseCategory: typeof ctx.expenseCategory === 'string' ? ctx.expenseCategory : undefined,
    pendingSalesTypeLabel: typeof ctx.pendingSalesTypeLabel === 'string' ? ctx.pendingSalesTypeLabel : undefined,
    pendingExpenseTypeLabel: typeof ctx.pendingExpenseTypeLabel === 'string' ? ctx.pendingExpenseTypeLabel : undefined
  };
};

const contextToJson = (context: ConversationContext): Prisma.InputJsonValue => {
  const payload: Record<string, unknown> = {};
  if (context.salesTransactionId !== undefined) payload.salesTransactionId = context.salesTransactionId;
  if (context.expenseTransactionId !== undefined) payload.expenseTransactionId = context.expenseTransactionId;
  if (context.logDateKey !== undefined) payload.logDateKey = context.logDateKey;
  if (context.pendingBackfillDateKey !== undefined) payload.pendingBackfillDateKey = context.pendingBackfillDateKey;
  if (context.salesAmount !== undefined) payload.salesAmount = context.salesAmount;
  if (context.salesEventType !== undefined) payload.salesEventType = context.salesEventType;
  if (context.salesCategory !== undefined) payload.salesCategory = context.salesCategory;
  if (context.salesTypeConfirmed !== undefined) payload.salesTypeConfirmed = context.salesTypeConfirmed;
  if (context.expenseAmount !== undefined) payload.expenseAmount = context.expenseAmount;
  if (context.expenseEventType !== undefined) payload.expenseEventType = context.expenseEventType;
  if (context.expenseTypeConfirmed !== undefined) payload.expenseTypeConfirmed = context.expenseTypeConfirmed;
  if (context.expenseCategory !== undefined) payload.expenseCategory = context.expenseCategory;
  if (context.pendingSalesTypeLabel !== undefined) payload.pendingSalesTypeLabel = context.pendingSalesTypeLabel;
  if (context.pendingExpenseTypeLabel !== undefined) payload.pendingExpenseTypeLabel = context.pendingExpenseTypeLabel;
  return payload as Prisma.InputJsonValue;
};

const classifyCategoryEventType = (category: string): ParsedTransaction['eventType'] => {
  if (/personal|owner|family|home|private|withdraw/i.test(category)) {
    return 'owner_withdrawal';
  }
  if (/stock|inventory|restock|supplier/i.test(category)) {
    return 'stock_purchase';
  }
  return 'operating_expense';
};

const detectMissedYesterday = async (userId: string): Promise<string | undefined> => {
  const now = new Date();
  const todayStart = startOfUtcDate(now);
  const yesterdayStart = addUtcDays(todayStart, -1);

  const historyCountBeforeToday = await db.transaction.count({
    where: {
      userId,
      status: 'confirmed',
      correctionOfId: null,
      date: { lt: todayStart }
    }
  });

  if (historyCountBeforeToday === 0) return undefined;

  const yesterdayCount = await db.transaction.count({
    where: {
      userId,
      status: 'confirmed',
      correctionOfId: null,
      date: {
        gte: yesterdayStart,
        lt: todayStart
      }
    }
  });

  if (yesterdayCount > 0) return undefined;
  return toDateKeyUtc(yesterdayStart);
};

const resolveConversationLogDate = (context: ConversationContext): Date =>
  context.logDateKey ? dateKeyToUtcDate(context.logDateKey) : new Date();

const upsertDraftTransaction = async (params: {
  transactionId?: string;
  userId: string;
  type: 'revenue' | 'expense';
  eventType?: ParsedTransaction['eventType'];
  amount: number;
  date?: Date;
  category?: string;
  notes?: string;
}): Promise<Transaction> => {
  if (params.transactionId) {
    const existing = await db.transaction.findUnique({ where: { id: params.transactionId } });
    if (existing && existing.status === 'draft') {
      return db.transaction.update({
        where: { id: existing.id },
        data: {
          type: params.type,
          eventType: params.eventType ?? existing.eventType,
          amount: params.amount,
          date: params.date ?? existing.date,
          category: params.category ?? existing.category,
          notes: params.notes ?? existing.notes
        }
      });
    }
  }

  return db.transaction.create({
    data: {
      userId: params.userId,
      type: params.type,
      eventType: params.eventType ?? 'other',
      status: 'draft',
      amount: params.amount,
      date: params.date ?? new Date(),
      category: params.category ?? null,
      notes: params.notes ?? null,
      confirmedAt: null
    }
  });
};

const buildDraftSummary = (context: ConversationContext): string => {
  const lines: string[] = [];
  if (context.salesAmount !== undefined) lines.push(`Inflow: GHS ${context.salesAmount}`);
  if (context.salesEventType) {
    if (context.salesEventType === 'other' && context.salesCategory) {
      lines.push(`Inflow type: ${context.salesCategory}`);
    } else {
      lines.push(`Inflow type: ${humanizeEventType(context.salesEventType)}`);
    }
  }
  if (context.expenseAmount !== undefined) lines.push(`Expense: GHS ${context.expenseAmount}`);
  if (context.expenseEventType) {
    if (context.expenseEventType === 'other' && context.expenseCategory) {
      lines.push(`Expense type: ${context.expenseCategory}`);
    } else {
      lines.push(`Expense type: ${humanizeEventType(context.expenseEventType)}`);
    }
  }
  if (context.expenseCategory) lines.push(`Expense category: ${context.expenseCategory}`);
  if (lines.length === 0) return 'No draft values captured yet.';
  return lines.join('\n');
};

const getMonthlyData = async (userId: string) => {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);

  const monthlyTransactions = await db.transaction.findMany({
    where: {
      userId,
      status: 'confirmed',
      correctionOfId: null,
      date: {
        gte: periodStart,
        lte: periodEnd
      }
    }
  });

  const budgets = await getBudgetsForPeriod(userId, 'monthly', periodStart);
  const budgetStatuses = budgets.map((budget) => computeBudgetStatus(budget, monthlyTransactions));

  return {
    monthlyTransactions,
    budgetStatuses
  };
};

const buildPostSaveAdvice = async (userId: string): Promise<string | null> => {
  try {
    const now = new Date();
    const insights = await getMonthlyInsights({
      userId,
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      now
    });

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

    if (advice.length === 0) {
      const highlight = insights.highlights[0];
      if (highlight) advice.push(highlight);
    }

    if (advice.length === 0) {
      return null;
    }

    return `Quick advice:\n${advice.slice(0, 2).join('\n')}`;
  } catch {
    return null;
  }
};

const finalizeResult = async (params: {
  userId: string;
  botReply: string;
  step: ConversationStep;
  touchedTransactions: Transaction[];
}) => {
  const { monthlyTransactions, budgetStatuses } = await getMonthlyData(params.userId);
  return {
    botReply: params.botReply,
    conversation: {
      step: params.step,
      awaitingConfirmation: params.step === 'await_confirm'
    },
    transactions: params.touchedTransactions,
    summary: computeSummary(params.touchedTransactions),
    monthlySummary: computeSummary(monthlyTransactions),
    budgetStatuses
  };
};

export const processConversationMessage = async (
  params: ProcessConversationParams
): Promise<ConversationResult> => {
  const session = await db.conversationSession.upsert({
    where: {
      userId_channel: {
        userId: params.userId,
        channel: params.channel
      }
    },
    update: {},
    create: {
      userId: params.userId,
      channel: params.channel,
      step: 'idle',
      context: {}
    }
  });

  let step = (session.step as ConversationStep) ?? 'idle';
  const context = normalizeContext(session.context);
  const message = params.message.trim();
  const lower = message.toLowerCase();
  const logDate = resolveConversationLogDate(context);
  const touchedTransactions: Transaction[] = [];
  let customInflowItems = await listCustomLineItems(params.userId, 'inflow');
  let customExpenseItems = await listCustomLineItems(params.userId, 'expense');

  if (step !== 'idle' && parseCancel(message)) {
    step = 'idle';
    await db.conversationSession.update({
      where: { id: session.id },
      data: {
        step,
        context: {}
      }
    });
    return finalizeResult({
      userId: params.userId,
      botReply: 'No problem. I have cancelled this draft. Send a message when you are ready to log again.',
      step,
      touchedTransactions
    });
  }

  if (step !== 'idle' && parseBack(message)) {
    let botReply = '';

    if (step === 'ask_backfill_consent') {
      context.pendingBackfillDateKey = undefined;
      context.logDateKey = undefined;
      step = 'idle';
      botReply = 'Okay. Back to start. Send a message when you are ready to log today.';
    } else if (step === 'ask_sales_type' || step === 'confirm_sales_type_custom') {
      context.pendingSalesTypeLabel = undefined;
      context.salesTypeConfirmed = false;
      step = 'ask_sales';
      botReply = `Back to inflow amount. ${buildInflowQuestionForLogDate(context.logDateKey)} (Reply NO if there was no inflow.)`;
    } else if (step === 'ask_expense_type' || step === 'confirm_expense_type_custom' || step === 'ask_expense_category') {
      context.pendingExpenseTypeLabel = undefined;
      context.expenseTypeConfirmed = false;
      step = 'ask_expense';
      botReply = `Back to expense amount. ${buildExpenseQuestionForLogDate(context.logDateKey)}`;
    } else if (step === 'await_confirm') {
      context.pendingSalesTypeLabel = undefined;
      context.pendingExpenseTypeLabel = undefined;
      context.salesTypeConfirmed = false;
      context.expenseTypeConfirmed = false;
      step = 'ask_sales';
      botReply = `Back to edit mode. ${buildInflowQuestionForLogDate(context.logDateKey)} (Reply NO if there was no inflow.)`;
    } else {
      step = 'ask_sales';
      botReply = `${buildInflowQuestionForLogDate(context.logDateKey)} (Reply NO if there was no inflow.)`;
    }

    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply,
      step,
      touchedTransactions
    });
  }

  if (step === 'idle') {
    const parsed = parseWhatsAppEntry(message);
    const revenue = parsed.find((entry) => entry.type === 'revenue');
    const expense = parsed.find((entry) => entry.type === 'expense');
    const explicitSalesEvent = parseSalesEventTypeFromText(message, { allowNumericChoice: false });
    const explicitExpenseEvent = parseExpenseEventTypeFromText(message, { allowNumericChoice: false });

    if (!revenue && !expense) {
      const userProfile = await db.user.findUnique({
        where: { id: params.userId },
        select: { name: true }
      });
      const idleReply = isAcknowledgementMessage(message)
        ? buildIdleAcknowledgementReply(userProfile?.name)
        : 'I’m here when you are ready. You can send something like "Inflow 1200, spent 300" and I’ll log it for you.';
      const loggingIntent = isLoggingIntentMessage(message);
      let botReply = idleReply;

      if (loggingIntent) {
        const missedDateKey = context.logDateKey ? undefined : await detectMissedYesterday(params.userId);
        if (missedDateKey) {
          context.pendingBackfillDateKey = missedDateKey;
          step = 'ask_backfill_consent';
          botReply = buildBackfillConsentPrompt(missedDateKey);
        } else {
          context.pendingBackfillDateKey = undefined;
          step = 'ask_sales';
          botReply = buildInitialGreeting(userProfile?.name);
        }
      } else {
        step = 'idle';
      }

      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply,
        step,
        touchedTransactions
      });
    }

    if (revenue) {
      context.pendingBackfillDateKey = undefined;
      const salesEventType = explicitSalesEvent ?? context.salesEventType ?? revenue.eventType ?? 'cash_sale';
      const draftRevenue = await upsertDraftTransaction({
        transactionId: context.salesTransactionId,
        userId: params.userId,
        type: 'revenue',
        eventType: salesEventType,
        amount: revenue.amount,
        date: logDate,
        category: revenue.category
          ?? salesCategoryForCurrentDraft(context)
          ?? defaultRevenueCategory(salesEventType)
          ?? 'Cash sale',
        notes: revenue.notes
      });
      touchedTransactions.push(draftRevenue);
      context.salesTransactionId = draftRevenue.id;
      context.salesAmount = draftRevenue.amount;
      context.salesEventType = salesEventType;
      context.salesCategory = draftRevenue.category
        ?? revenue.category
        ?? defaultRevenueCategory(salesEventType)
        ?? 'Cash sale';
      if (explicitSalesEvent) context.salesTypeConfirmed = true;
      context.pendingSalesTypeLabel = undefined;
    }

    if (expense) {
      context.pendingBackfillDateKey = undefined;
      const expenseEventType = explicitExpenseEvent ?? context.expenseEventType ?? expense.eventType ?? 'operating_expense';
      const expenseCategory = expense.category ?? defaultExpenseCategory(expenseEventType);
      const draftExpense = await upsertDraftTransaction({
        transactionId: context.expenseTransactionId,
        userId: params.userId,
        type: 'expense',
        eventType: expenseEventType,
        amount: expense.amount,
        date: logDate,
        category: expenseCategory,
        notes: expense.notes
      });
      touchedTransactions.push(draftExpense);
      context.expenseTransactionId = draftExpense.id;
      context.expenseAmount = draftExpense.amount;
      context.expenseEventType = expenseEventType;
      context.expenseCategory = draftExpense.category ?? expenseCategory ?? undefined;
      if (explicitExpenseEvent) context.expenseTypeConfirmed = true;
      context.pendingExpenseTypeLabel = undefined;
    }

    if (context.salesAmount === undefined) {
      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `I noted the expense draft. ${buildInflowQuestionForLogDate(context.logDateKey)} Reply NO if there was no inflow.`,
        step,
        touchedTransactions
      });
    }

    if (!context.salesTypeConfirmed) {
      step = 'ask_sales_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: buildSalesTypePrompt('Noted.', customInflowItems),
        step,
        touchedTransactions
      });
    }

    if (context.expenseAmount === undefined) {
      step = 'ask_expense';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Recorded draft inflow: GHS ${context.salesAmount}. ${buildExpenseQuestionForLogDate(context.logDateKey)}`,
        step,
        touchedTransactions
      });
    }

    if ((context.expenseAmount ?? 0) > 0 && !context.expenseTypeConfirmed) {
      step = 'ask_expense_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: buildExpenseTypePrompt('Recorded draft expense.', customExpenseItems),
        step,
        touchedTransactions
      });
    }

    if (!context.expenseCategory) {
      step = 'ask_expense_category';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Recorded draft expense: GHS ${context.expenseAmount}. What was it spent on?`,
        step,
        touchedTransactions
      });
    }

    step = 'await_confirm';
    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: `Here is your draft record:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_backfill_consent') {
    const backfillDateKey = context.pendingBackfillDateKey;
    if (!backfillDateKey) {
      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: 'How much money inflow came in today?',
        step,
        touchedTransactions
      });
    }

    if (isBackfillYes(message)) {
      context.logDateKey = backfillDateKey;
      context.pendingBackfillDateKey = undefined;
      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: buildBackfillInflowPrompt(backfillDateKey),
        step,
        touchedTransactions
      });
    }

    if (isBackfillNo(message)) {
      context.logDateKey = undefined;
      context.pendingBackfillDateKey = undefined;
      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: 'No problem. How much money inflow came in today?',
        step,
        touchedTransactions
      });
    }

    return finalizeResult({
      userId: params.userId,
      botReply: `${buildBackfillConsentPrompt(backfillDateKey)} Reply with 1 or 2.`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_sales') {
    if (parseNoValue(lower)) {
      context.salesAmount = 0;
      context.salesEventType = undefined;
      context.salesTypeConfirmed = true;
      context.salesCategory = undefined;
      context.pendingSalesTypeLabel = undefined;

      if (context.expenseAmount === undefined) {
        step = 'ask_expense';
        await db.conversationSession.update({
          where: { id: session.id },
          data: { step, context: contextToJson(context) }
        });
        return finalizeResult({
          userId: params.userId,
          botReply: `Inflow recorded as GHS 0. ${buildExpenseQuestionForLogDate(context.logDateKey)}`,
          step,
          touchedTransactions
        });
      }

      if ((context.expenseAmount ?? 0) > 0 && !context.expenseTypeConfirmed) {
        step = 'ask_expense_type';
        await db.conversationSession.update({
          where: { id: session.id },
          data: { step, context: contextToJson(context) }
        });
        return finalizeResult({
          userId: params.userId,
          botReply: buildExpenseTypePrompt(`Inflow recorded as GHS 0. Recorded draft expense: GHS ${context.expenseAmount}.`, customExpenseItems),
          step,
          touchedTransactions
        });
      }

      if ((context.expenseAmount ?? 0) > 0 && !context.expenseCategory) {
        step = 'ask_expense_category';
        await db.conversationSession.update({
          where: { id: session.id },
          data: { step, context: contextToJson(context) }
        });
        return finalizeResult({
          userId: params.userId,
          botReply: `Inflow recorded as GHS 0. Recorded draft expense: GHS ${context.expenseAmount}. What was it spent on?`,
          step,
          touchedTransactions
        });
      }

      step = 'await_confirm';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: `Draft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
        step,
        touchedTransactions
      });
    }

    const parsedEntries = parseWhatsAppEntry(message);
    const parsedRevenue = parsedEntries.find((entry) => entry.type === 'revenue');
    const parsedExpense = parsedEntries.find((entry) => entry.type === 'expense');
    const explicitSalesEvent = parseSalesEventTypeFromText(message, { allowNumericChoice: false });
    const explicitExpenseEvent = parseExpenseEventTypeFromText(message, { allowNumericChoice: false });
    const shouldTreatAsExpenseFirst = Boolean(
      (parsedExpense && !parsedRevenue)
      || (!parsedRevenue && explicitExpenseEvent && !explicitSalesEvent)
    );

    if (shouldTreatAsExpenseFirst) {
      const expenseAmount = parsedExpense?.amount ?? parseAmountFromText(message);
      if (expenseAmount === null || expenseAmount === undefined) {
        return finalizeResult({
          userId: params.userId,
          botReply: `If this is an expense, send amount + label (example: "230 transport"). Otherwise, ${buildInflowQuestionForLogDate(context.logDateKey)}`,
          step,
          touchedTransactions
        });
      }

      const expenseEventType = explicitExpenseEvent ?? context.expenseEventType ?? 'operating_expense';
      const expenseCategory = parsedExpense?.category
        ?? expenseCategoryForCurrentDraft(context)
        ?? defaultExpenseCategory(expenseEventType);
      const draftExpense = await upsertDraftTransaction({
        transactionId: context.expenseTransactionId,
        userId: params.userId,
        type: 'expense',
        eventType: expenseEventType,
        amount: expenseAmount,
        date: logDate,
        category: expenseCategory,
        notes: parsedExpense?.notes
      });

      touchedTransactions.push(draftExpense);
      context.expenseTransactionId = draftExpense.id;
      context.expenseAmount = draftExpense.amount;
      context.expenseEventType = expenseEventType;
      context.expenseCategory = draftExpense.category ?? expenseCategory ?? undefined;
      if (explicitExpenseEvent) context.expenseTypeConfirmed = true;
      context.pendingExpenseTypeLabel = undefined;

      if (!context.expenseTypeConfirmed) {
        step = 'ask_expense_type';
        await db.conversationSession.update({
          where: { id: session.id },
          data: { step, context: contextToJson(context) }
        });
        return finalizeResult({
          userId: params.userId,
          botReply: buildExpenseTypePrompt(`Recorded draft expense: GHS ${draftExpense.amount}.`, customExpenseItems),
          step,
          touchedTransactions
        });
      }

      if (!context.expenseCategory) {
        step = 'ask_expense_category';
        await db.conversationSession.update({
          where: { id: session.id },
          data: { step, context: contextToJson(context) }
        });
        return finalizeResult({
          userId: params.userId,
          botReply: `Recorded expense type as ${humanizeEventType(context.expenseEventType)}. What was it spent on?`,
          step,
          touchedTransactions
        });
      }

      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: `Recorded draft expense: GHS ${draftExpense.amount}. ${buildInflowQuestionForLogDate(context.logDateKey)} Reply NO if there was no inflow.`,
        step,
        touchedTransactions
      });
    }

    const salesAmount = parsedRevenue?.amount ?? parseAmountFromText(message);
    if (salesAmount === null || salesAmount === undefined) {
      return finalizeResult({
        userId: params.userId,
        botReply: 'Please send the money inflow amount in cedis so I can save it as draft. Example: "Inflow 850". You can also reply NO if there was no inflow.',
        step,
        touchedTransactions
      });
    }

    const salesEventType = explicitSalesEvent ?? context.salesEventType ?? 'cash_sale';
    const draftRevenue = await upsertDraftTransaction({
      transactionId: context.salesTransactionId,
      userId: params.userId,
      type: 'revenue',
      eventType: salesEventType,
      amount: salesAmount,
      date: logDate,
      category: parsedRevenue?.category
        ?? salesCategoryForCurrentDraft(context)
        ?? defaultRevenueCategory(salesEventType)
        ?? 'Cash sale',
      notes: parsedRevenue?.notes
    });

    touchedTransactions.push(draftRevenue);
    context.salesTransactionId = draftRevenue.id;
    context.salesAmount = draftRevenue.amount;
    context.salesEventType = salesEventType;
    context.salesCategory = draftRevenue.category
      ?? parsedRevenue?.category
      ?? defaultRevenueCategory(salesEventType)
      ?? 'Cash sale';
    if (explicitSalesEvent) context.salesTypeConfirmed = true;
    context.pendingSalesTypeLabel = undefined;

    step = context.salesTypeConfirmed ? 'ask_expense' : 'ask_sales_type';

    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: step === 'ask_sales_type'
        ? buildSalesTypePrompt(`Recorded draft inflow: GHS ${draftRevenue.amount}.`, customInflowItems)
        : `Recorded draft inflow: GHS ${draftRevenue.amount}. ${buildExpenseQuestionForLogDate(context.logDateKey)} (Reply NO if there was no expense.)`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_sales_type') {
    const salesChoice = resolveSalesTypeChoice(message, customInflowItems);
    if (!salesChoice.eventType) {
      if (!message) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildSalesTypePrompt('Please choose the inflow type.', customInflowItems),
          step,
          touchedTransactions
        });
      }
      if (salesChoice.invalidNumeric) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildSalesTypePrompt('That option number is not in the list.', customInflowItems),
          step,
          touchedTransactions
        });
      }
      if (parseYesResponse(message) || parseNoResponse(message)) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildSalesTypePrompt('Please choose one type from the list.', customInflowItems),
          step,
          touchedTransactions
        });
      }
      context.pendingSalesTypeLabel = message;
      step = 'confirm_sales_type_custom';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: buildCustomTypeConfirmPrompt(message, 'inflow'),
        step,
        touchedTransactions
      });
    }

    const inflowTypeLabel = salesChoice.customLabel ?? humanizeEventType(salesChoice.eventType) ?? 'Other';
    const inflowCategory = salesChoice.eventType === 'other'
      ? salesChoice.customLabel ?? salesCategoryForCurrentDraft(context) ?? 'Other'
      : defaultRevenueCategory(salesChoice.eventType) ?? 'Cash sale';

    if (context.salesTransactionId) {
      const updated = await db.transaction.update({
        where: { id: context.salesTransactionId },
        data: {
          eventType: salesChoice.eventType,
          category: inflowCategory,
          notes: salesChoice.eventType === 'other' ? inflowCategory : undefined
        }
      });
      touchedTransactions.push(updated);
      context.salesCategory = updated.category ?? inflowCategory;
    }

    if (salesChoice.eventType === 'other' && salesChoice.customLabel) {
      await rememberCustomLineItem(params.userId, 'inflow', salesChoice.customLabel);
      customInflowItems = await listCustomLineItems(params.userId, 'inflow');
    }

    context.salesEventType = salesChoice.eventType;
    context.salesCategory = inflowCategory;
    context.salesTypeConfirmed = true;
    context.pendingSalesTypeLabel = undefined;
    step = 'ask_expense';

    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: `Inflow type recorded as ${inflowTypeLabel}. ${buildExpenseQuestionForLogDate(context.logDateKey)}`,
      step,
      touchedTransactions
    });
  }

  if (step === 'confirm_sales_type_custom') {
    const pendingLabel = context.pendingSalesTypeLabel?.trim();
    if (!pendingLabel) {
      step = 'ask_sales_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: buildSalesTypePrompt('Please choose the inflow type.', customInflowItems),
        step,
        touchedTransactions
      });
    }

    if (parseYesResponse(message)) {
      const savedLabel = await rememberCustomLineItem(params.userId, 'inflow', pendingLabel);
      customInflowItems = await listCustomLineItems(params.userId, 'inflow');
      const inflowLabel = savedLabel ?? pendingLabel;

      if (context.salesTransactionId) {
        const updated = await db.transaction.update({
          where: { id: context.salesTransactionId },
          data: { eventType: 'other', category: inflowLabel, notes: inflowLabel }
        });
        touchedTransactions.push(updated);
        context.salesCategory = updated.category ?? inflowLabel;
      } else {
        context.salesCategory = inflowLabel;
      }

      context.salesEventType = 'other';
      context.salesTypeConfirmed = true;
      context.pendingSalesTypeLabel = undefined;
      step = 'ask_expense';

      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Inflow type recorded as ${inflowLabel}. ${buildExpenseQuestionForLogDate(context.logDateKey)}`,
        step,
        touchedTransactions
      });
    }

    if (parseNoResponse(message)) {
      context.pendingSalesTypeLabel = undefined;
      step = 'ask_sales_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: buildSalesTypePrompt('Okay, please choose one from the list.', customInflowItems),
        step,
        touchedTransactions
      });
    }

    return finalizeResult({
      userId: params.userId,
      botReply: `Please reply YES to add "${pendingLabel}" or NO to choose from the list.`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_expense') {
    if (parseNoValue(lower)) {
      context.expenseAmount = 0;
      context.expenseEventType = undefined;
      context.expenseTypeConfirmed = true;
      context.expenseCategory = undefined;
      context.expenseTransactionId = undefined;
      context.pendingExpenseTypeLabel = undefined;
      step = 'await_confirm';

      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Draft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
        step,
        touchedTransactions
      });
    }

    const parsed = parseWhatsAppEntry(message).find((entry) => entry.type === 'expense');
    const explicitExpenseEvent = parseExpenseEventTypeFromText(message, { allowNumericChoice: false });
    const expenseAmount = parsed?.amount ?? parseAmountFromText(message);
    if (expenseAmount === null || expenseAmount === undefined) {
      return finalizeResult({
        userId: params.userId,
        botReply: 'Please send the expense amount in cedis, or type NO if there was no expense. Example: "Spent 200".',
        step,
        touchedTransactions
      });
    }

    const expenseEventType = explicitExpenseEvent ?? context.expenseEventType ?? 'operating_expense';
    const expenseCategory = parsed?.category
      ?? expenseCategoryForCurrentDraft(context)
      ?? defaultExpenseCategory(expenseEventType);
    const draftExpense = await upsertDraftTransaction({
      transactionId: context.expenseTransactionId,
      userId: params.userId,
      type: 'expense',
      eventType: expenseEventType,
      amount: expenseAmount,
      date: logDate,
      category: expenseCategory,
      notes: parsed?.notes
    });

    touchedTransactions.push(draftExpense);
    context.expenseTransactionId = draftExpense.id;
    context.expenseAmount = draftExpense.amount;
    context.expenseEventType = expenseEventType;
    context.expenseCategory = draftExpense.category ?? expenseCategory ?? undefined;
    if (explicitExpenseEvent) context.expenseTypeConfirmed = true;
    context.pendingExpenseTypeLabel = undefined;

    if (!context.expenseTypeConfirmed) {
      step = 'ask_expense_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: buildExpenseTypePrompt(`Recorded draft expense: GHS ${draftExpense.amount}.`, customExpenseItems),
        step,
        touchedTransactions
      });
    }

    if (!context.expenseCategory) {
      step = 'ask_expense_category';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Recorded expense type as ${humanizeEventType(context.expenseEventType)}. What was it spent on?`,
        step,
        touchedTransactions
      });
    }

    step = 'await_confirm';
    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: `Draft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_expense_type') {
    const expenseChoice = resolveExpenseTypeChoice(message, customExpenseItems);
    if (!expenseChoice.eventType) {
      if (!message) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildExpenseTypePrompt('Please choose the expense type.', customExpenseItems),
          step,
          touchedTransactions
        });
      }
      if (expenseChoice.invalidNumeric) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildExpenseTypePrompt('That option number is not in the list.', customExpenseItems),
          step,
          touchedTransactions
        });
      }
      if (parseYesResponse(message) || parseNoResponse(message)) {
        return finalizeResult({
          userId: params.userId,
          botReply: buildExpenseTypePrompt('Please choose one type from the list.', customExpenseItems),
          step,
          touchedTransactions
        });
      }
      context.pendingExpenseTypeLabel = message;
      step = 'confirm_expense_type_custom';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: buildCustomTypeConfirmPrompt(message, 'expense'),
        step,
        touchedTransactions
      });
    }

    const resolvedCategory = expenseChoice.eventType === 'other'
      ? expenseChoice.customLabel ?? context.expenseCategory ?? 'Other'
      : context.expenseCategory ?? defaultExpenseCategory(expenseChoice.eventType);
    const expenseTypeLabel = expenseChoice.customLabel ?? humanizeEventType(expenseChoice.eventType) ?? 'Other';

    if (context.expenseTransactionId) {
      const updated = await db.transaction.update({
        where: { id: context.expenseTransactionId },
        data: {
          eventType: expenseChoice.eventType,
          category: resolvedCategory ?? undefined,
          notes: resolvedCategory ?? undefined
        }
      });
      touchedTransactions.push(updated);
    }

    if (expenseChoice.eventType === 'other' && expenseChoice.customLabel) {
      await rememberCustomLineItem(params.userId, 'expense', expenseChoice.customLabel);
      customExpenseItems = await listCustomLineItems(params.userId, 'expense');
    }

    context.expenseEventType = expenseChoice.eventType;
    context.expenseTypeConfirmed = true;
    context.expenseCategory = resolvedCategory;
    context.pendingExpenseTypeLabel = undefined;

    if (!context.expenseCategory) {
      step = 'ask_expense_category';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Expense type recorded as ${expenseTypeLabel}. What was it spent on?`,
        step,
        touchedTransactions
      });
    }

    step = 'await_confirm';
    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: `Draft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
      step,
      touchedTransactions
    });
  }

  if (step === 'confirm_expense_type_custom') {
    const pendingLabel = context.pendingExpenseTypeLabel?.trim();
    if (!pendingLabel) {
      step = 'ask_expense_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });
      return finalizeResult({
        userId: params.userId,
        botReply: buildExpenseTypePrompt('Please choose the expense type.', customExpenseItems),
        step,
        touchedTransactions
      });
    }

    if (parseYesResponse(message)) {
      const savedLabel = await rememberCustomLineItem(params.userId, 'expense', pendingLabel);
      customExpenseItems = await listCustomLineItems(params.userId, 'expense');
      const expenseLabel = savedLabel ?? pendingLabel;

      if (context.expenseTransactionId) {
        const updated = await db.transaction.update({
          where: { id: context.expenseTransactionId },
          data: {
            eventType: 'other',
            category: expenseLabel,
            notes: expenseLabel
          }
        });
        touchedTransactions.push(updated);
      }

      context.expenseEventType = 'other';
      context.expenseTypeConfirmed = true;
      context.expenseCategory = expenseLabel;
      context.pendingExpenseTypeLabel = undefined;
      step = 'await_confirm';

      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: `Expense type recorded as ${expenseLabel}.\n\nDraft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
        step,
        touchedTransactions
      });
    }

    if (parseNoResponse(message)) {
      context.pendingExpenseTypeLabel = undefined;
      step = 'ask_expense_type';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: buildExpenseTypePrompt('Okay, please choose one from the list.', customExpenseItems),
        step,
        touchedTransactions
      });
    }

    return finalizeResult({
      userId: params.userId,
      botReply: `Please reply YES to add "${pendingLabel}" or NO to choose from the list.`,
      step,
      touchedTransactions
    });
  }

  if (step === 'ask_expense_category') {
    const category = message;
    if (!category) {
      return finalizeResult({
        userId: params.userId,
        botReply: 'Please share what that expense was spent on so I can classify it correctly.',
        step,
        touchedTransactions
      });
    }

    if (context.expenseTransactionId) {
      const inferredEventType = context.expenseEventType ?? classifyCategoryEventType(category);
      const updated = await db.transaction.update({
        where: { id: context.expenseTransactionId },
        data: {
          category,
          eventType: inferredEventType,
          notes: category
        }
      });
      touchedTransactions.push(updated);
      context.expenseEventType = inferredEventType;
    }

    context.expenseCategory = category;
    context.expenseTypeConfirmed = context.expenseTypeConfirmed ?? true;
    step = 'await_confirm';
    await db.conversationSession.update({
      where: { id: session.id },
      data: { step, context: contextToJson(context) }
    });

    return finalizeResult({
      userId: params.userId,
      botReply: `Draft summary:\n${buildDraftSummary(context)}\n\n${buildAwaitConfirmPrompt()}`,
      step,
      touchedTransactions
    });
  }

  if (step === 'await_confirm') {
    if (parseConfirm(lower)) {
      const draftIds = [context.salesTransactionId, context.expenseTransactionId].filter(
        (value): value is string => Boolean(value)
      );

      const confirmedTransactions = await Promise.all(
        draftIds.map((id) =>
          db.transaction.updateMany({
            where: {
              id,
              userId: params.userId,
              status: 'draft'
            },
            data: {
              status: 'confirmed',
              confirmedAt: new Date()
            }
          }).then(async (result) => {
            if (!result.count) return null;
            return db.transaction.findUnique({ where: { id } });
          })
        )
      );

      touchedTransactions.push(
        ...confirmedTransactions.filter((tx): tx is Transaction => tx !== null)
      );

      step = 'idle';
      await db.conversationSession.update({
        where: { id: session.id },
        data: {
          step,
          context: {}
        }
      });

      const advice = await buildPostSaveAdvice(params.userId);
      const botReply = advice
        ? `Saved. Your entries are now confirmed.\n\n${advice}\n\nSend another message when you are ready to log more.`
        : 'Saved. Your entries are now confirmed. Send another message when you are ready to log more.';

      return finalizeResult({
        userId: params.userId,
        botReply,
        step,
        touchedTransactions
      });
    }

    if (parseEdit(lower)) {
      context.salesTypeConfirmed = false;
      context.expenseTypeConfirmed = false;
      context.pendingBackfillDateKey = undefined;
      context.pendingSalesTypeLabel = undefined;
      context.pendingExpenseTypeLabel = undefined;
      step = 'ask_sales';
      await db.conversationSession.update({
        where: { id: session.id },
        data: { step, context: contextToJson(context) }
      });

      return finalizeResult({
        userId: params.userId,
        botReply: 'Okay, let’s adjust the draft. What is the correct money inflow amount?',
        step,
        touchedTransactions
      });
    }

    return finalizeResult({
      userId: params.userId,
      botReply: buildAwaitConfirmPrompt(),
      step,
      touchedTransactions
    });
  }

  step = 'idle';
  await db.conversationSession.update({
    where: { id: session.id },
    data: { step, context: {} }
  });

  return finalizeResult({
    userId: params.userId,
    botReply: 'Session reset. How much money inflow came in today?',
    step,
    touchedTransactions
  });
};
