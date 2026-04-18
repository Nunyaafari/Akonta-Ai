import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppView, User, ChatMessage, Transaction, SummaryPayload, WhatsAppProvider, Budget, BudgetTargetType, MonthlyInsights, AdminPaymentSettings, AdminWhatsAppSettings } from './types';
import { 
  ChartIcon, HistoryIcon,
  SendIcon, TrendingUpIcon, TrendingDownIcon, HomeIcon, 
  CalendarIcon, ArrowLeftIcon, CheckIcon, ClockIcon, BellIcon, ChatIcon, SettingsIcon, ShieldIcon
} from './components/Icons';
import { 
  mockTransactions, currentWeekSummary, currentMonthSummary, 
  chatMessages 
} from './data/mockData';
import SalesProfitTrendChart, { type SalesProfitTrendPoint } from './components/SalesProfitTrendChart';
import {
  activateUserSubscription,
  createUser,
  getAdminAnalytics,
  getAdminPaymentSettings,
  getAdminWhatsAppProvider,
  getCurrentBudgets,
  getCurrentInsights,
  getMonthlyInsights,
  getMonthlySummary,
  getReferralProgress,
  getTransactions,
  getWeeklySummary,
  initializeSubscriptionPayment,
  isOfflineSyncError,
  postBudget,
  postChatEntry,
  registerDemoModeListener,
  setAdminPaymentSettings,
  setAdminWhatsAppProvider,
  verifySubscriptionPayment,
  updateUser
} from './lib/api';
import {
  buildCashFlowCsvRows,
  buildCashFlowStatementHtml,
  buildProfitLossCsvRows,
  buildProfitLossStatementHtml,
  downloadCsvFile,
  generateCashFlowPdf,
  generateProfitLossPdf,
  printStatementHtml,
  sanitizeFileName
} from './utils/reports';
import { formatCurrencyValue, formatDate, formatTime, parseDateValue } from './utils/formatters';
import { createSummaryFromTransactions, buildCashFlowLineItems, buildProfitLossLines } from './utils/summary';
import { LandingView } from './components/LandingView';
import {
  enqueuePendingChatMessage,
  getPendingChatCount,
  listPendingChatMessages,
  markPendingChatMessageFailure,
  removePendingChatMessage
} from './lib/offlineQueue';

const brandMarkSrc = '/brand/akonta.svg';
const appCopyrightNotice = `© ${new Date().getFullYear()} All rights reserved. Amagold Technologies Ltd.`;
const supportedCurrencies = ['GHS', 'USD', 'NGN', 'KES', 'EUR', 'GBP'] as const;

const hasActivePremiumWindow = (user: User | null): boolean => {
  if (!user) return false;
  if (user.subscriptionStatus === 'free') return false;
  const accessEnd = parseDateValue(user.subscriptionEndsAt ?? user.trialEndsAt ?? null);
  if (!accessEnd) return user.subscriptionStatus === 'premium';
  return accessEnd.getTime() > Date.now();
};

const resolveDayPart = (timeZone?: string): 'morning' | 'afternoon' | 'evening' => {
  const now = new Date();
  let hour = now.getHours();
  if (timeZone) {
    const formattedHour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now);
    const parsedHour = Number(formattedHour);
    if (!Number.isNaN(parsedHour)) hour = parsedHour;
  }
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};

const defaultWeeklySummary: SummaryPayload = {
  totalRevenue: currentWeekSummary.totalRevenue, totalExpenses: currentWeekSummary.totalExpenses,
  directExpenses: currentWeekSummary.totalExpenses, indirectExpenses: 0, nonBusinessExpenses: 0,
  grossProfit: currentWeekSummary.totalRevenue - currentWeekSummary.totalExpenses,
  netProfit: currentWeekSummary.profit, profit: currentWeekSummary.profit, transactionCount: currentWeekSummary.transactionCount,
  categoryBreakdown: {}, directExpenseBreakdown: {}, indirectExpenseBreakdown: {},
  dailyBreakdown: currentWeekSummary.dailyBreakdown.map((day) => ({
    date: day.date.toISOString().slice(0, 10), revenue: day.revenue, expenses: day.expenses
  })),
  cashFlow: {
    operatingInflow: currentWeekSummary.totalRevenue, operatingOutflow: currentWeekSummary.totalExpenses,
    financingInflow: 0, financingOutflow: 0, totalCashInflow: currentWeekSummary.totalRevenue,
    totalCashOutflow: currentWeekSummary.totalExpenses, netCashFlow: currentWeekSummary.profit
  }
};

const emptySummaryPayload: SummaryPayload = {
  totalRevenue: 0, totalExpenses: 0, directExpenses: 0, indirectExpenses: 0, nonBusinessExpenses: 0,
  grossProfit: 0, netProfit: 0, profit: 0, transactionCount: 0, categoryBreakdown: {},
  directExpenseBreakdown: {}, indirectExpenseBreakdown: {}, dailyBreakdown: [],
  cashFlow: {
    operatingInflow: 0, operatingOutflow: 0, financingInflow: 0, financingOutflow: 0,
    totalCashInflow: 0, totalCashOutflow: 0, netCashFlow: 0
  }
};

type ChatEntryResult = Awaited<ReturnType<typeof postChatEntry>>;
type UpdateUserPayload = Parameters<typeof updateUser>[1];
type PostBudgetPayload = Parameters<typeof postBudget>[0];
type ActivateSubscriptionPayload = Parameters<typeof activateUserSubscription>[1];

const toDateInputValue = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const INSTALL_PROMPT_DISMISS_KEY = 'akontaai-install-dismissed-at';
const INSTALL_PROMPT_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 3;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const toTimeZoneDateKey = (value: Date | string, timeZone: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

const shiftDateKey = (dateKey: string, delta: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + delta);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
};

const mergeBusinessExpenseBreakdown = (summary: SummaryPayload): Array<{ category: string; amount: number }> => {
  const merged: Record<string, number> = {};
  for (const [category, amount] of Object.entries(summary.directExpenseBreakdown ?? {})) {
    merged[category] = (merged[category] ?? 0) + amount;
  }
  for (const [category, amount] of Object.entries(summary.indirectExpenseBreakdown ?? {})) {
    merged[category] = (merged[category] ?? 0) + amount;
  }
  return Object.entries(merged).map(([category, amount]) => ({ category, amount }));
};

const isBusinessExpenseForTrend = (tx: Transaction): boolean => {
  if (tx.type !== 'expense') return false;
  if (tx.eventType === 'owner_withdrawal' || tx.eventType === 'loan_repayment') return false;
  const category = (tx.category ?? '').toLowerCase();
  return !/(owner|drawing|personal|private|family|loan repayment|repayment|withdraw)/i.test(category);
};

const isSalesEvent = (tx: Transaction): boolean =>
  tx.type === 'revenue' && (tx.eventType === 'cash_sale' || tx.eventType === 'momo_sale' || tx.eventType === 'credit_sale');

const buildSalesProfitTrendPoints = (params: {
  transactions: Transaction[];
  mode: 'monthly' | 'yearly';
  year: number;
  month: number;
}): SalesProfitTrendPoint[] => {
  const dataMap: Record<string, { label: string; sales: number; businessExpenses: number }> = {};

  if (params.mode === 'monthly') {
    const daysInMonth = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${params.year}-${String(params.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dataMap[key] = { label: String(day), sales: 0, businessExpenses: 0 };
    }
  } else {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${params.year}-${String(month).padStart(2, '0')}`;
      const label = new Date(Date.UTC(params.year, month - 1, 1)).toLocaleDateString('en-GH', { month: 'short' });
      dataMap[key] = { label, sales: 0, businessExpenses: 0 };
    }
  }

  params.transactions.forEach((tx) => {
    const date = new Date(tx.date);
    if (Number.isNaN(date.getTime())) return;
    const key = params.mode === 'monthly'
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 7);
    if (!dataMap[key]) return;

    if (isSalesEvent(tx)) dataMap[key].sales += tx.amount;
    if (isBusinessExpenseForTrend(tx)) dataMap[key].businessExpenses += tx.amount;
  });

  return Object.entries(dataMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      label: value.label,
      sales: value.sales,
      profit: value.sales - value.businessExpenses
    }));
};

type HistoryDatePreset = 'this_month' | 'last_month' | 'last_90_days' | 'all_time' | 'custom';

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages);
  const [inputValue, setInputValue] = useState('');
  const [reportMode, setReportMode] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedReportYear, setSelectedReportYear] = useState<number>(new Date().getUTCFullYear());
  const [selectedReportMonth, setSelectedReportMonth] = useState<number>(new Date().getUTCMonth() + 1);
  const [selectedReportSummary, setSelectedReportSummary] = useState<SummaryPayload | null>(null);
  const [selectedReportInsights, setSelectedReportInsights] = useState<MonthlyInsights | null>(null);
  const [reportSummaryCache, setReportSummaryCache] = useState<Record<string, SummaryPayload>>({});
  const [reportInsightsCache, setReportInsightsCache] = useState<Record<string, MonthlyInsights>>({});
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'reports'>('overview');
  const [reportLockNotice, setReportLockNotice] = useState<string | null>(null);
  const [isReferralLoading, setIsReferralLoading] = useState(false);
  const [referralCopyMessage, setReferralCopyMessage] = useState<string | null>(null);
  const [adminWhatchimpDraft, setAdminWhatchimpDraft] = useState<AdminWhatsAppSettings['whatchimp'] | null>(null);
  const [adminPaymentDraft, setAdminPaymentDraft] = useState<AdminPaymentSettings | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [budgetTargetType, setBudgetTargetType] = useState<BudgetTargetType>('expense');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, setFollowUpStep] = useState<'customer' | 'targets' | 'cash' | 'sales' | 'salesBreakdown' | 'debtRecovery' | 'expense' | 'expenseCategory' | 'supportingDoc' | 'confirmRecord' | 'closingBalance' | 'confirmImpact' | null>(null);
  const [attachmentTransaction, setAttachmentTransaction] = useState<Transaction | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isIosInstallHintEligible, setIsIosInstallHintEligible] = useState(false);
  const [historyDatePreset, setHistoryDatePreset] = useState<HistoryDatePreset>('all_time');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyTransactionTypeFilter, setHistoryTransactionTypeFilter] = useState<'all' | 'revenue' | 'expense'>('all');
  const [historyAttachmentFilter, setHistoryAttachmentFilter] = useState<'all' | 'with' | 'without'>('all');
  const [settingsCurrencyCode, setSettingsCurrencyCode] = useState<'GHS' | 'USD' | 'NGN' | 'KES' | 'EUR' | 'GBP'>('GHS');
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isOutboxSyncing, setIsOutboxSyncing] = useState(false);

  const activeCurrencyCode = user?.currencyCode ?? 'GHS';
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const formatCurrency = (amount: number) => formatCurrencyValue(amount, activeCurrencyCode);
  const hasReportAccess = hasActivePremiumWindow(user);
  const subscriptionAccessEnd = parseDateValue(user?.subscriptionEndsAt ?? user?.trialEndsAt ?? null);
  const subscriptionDaysRemaining = subscriptionAccessEnd
    ? Math.max(0, Math.ceil((subscriptionAccessEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  
  // Onboarding form state
  const [formData, setFormData] = useState<{
    name: string;
    phoneNumber: string;
    businessName: string;
    businessType: string;
    preferredTime: 'morning' | 'afternoon' | 'evening';
  }>({
    name: '',
    phoneNumber: '',
    businessName: '',
    businessType: '',
    preferredTime: 'evening'
  });
  const [onboardingReferralCode, setOnboardingReferralCode] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const invalidateUserDataQueries = useCallback((userId: string, options?: { includeBudgets?: boolean }) => {
    queryClient.invalidateQueries({ queryKey: ['transactions', userId] });
    queryClient.invalidateQueries({ queryKey: ['weekly-summary', userId] });
    queryClient.invalidateQueries({ queryKey: ['monthly-summary', userId] });
    queryClient.invalidateQueries({ queryKey: ['current-insights', userId] });
    queryClient.invalidateQueries({ queryKey: ['referrals', userId] });
    queryClient.invalidateQueries({ queryKey: ['selected-report', userId] });
    if (options?.includeBudgets) {
      queryClient.invalidateQueries({ queryKey: ['budgets', userId] });
    }
  }, [queryClient]);

  const postChatEntryMutation = useMutation({
    mutationFn: (payload: { userId: string; message: string; channel: 'web' | 'whatsapp' }) =>
      postChatEntry(payload.userId, payload.message, payload.channel)
  });

  const saveBudgetMutation = useMutation({
    mutationFn: (payload: PostBudgetPayload) => postBudget(payload),
    onSuccess: (_savedBudget, payload) => {
      invalidateUserDataQueries(payload.userId, { includeBudgets: true });
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: (payload: { id: string; updates: UpdateUserPayload }) => updateUser(payload.id, payload.updates)
  });

  const createUserMutation = useMutation({
    mutationFn: (payload: Partial<User>) => createUser(payload)
  });

  const initializeSubscriptionMutation = useMutation({
    mutationFn: (payload: {
      userId: string;
      months?: number;
      callbackUrl?: string;
      customerEmail?: string;
    }) => initializeSubscriptionPayment(payload)
  });

  const verifySubscriptionMutation = useMutation({
    mutationFn: (reference: string) => verifySubscriptionPayment(reference)
  });

  const activateSubscriptionMutation = useMutation({
    mutationFn: (payload: { userId: string; request: ActivateSubscriptionPayload }) =>
      activateUserSubscription(payload.userId, payload.request),
    onSuccess: (_updated, payload) => {
      queryClient.invalidateQueries({ queryKey: ['referrals', payload.userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    }
  });
  const isOnboardingSubmitting = createUserMutation.isPending;
  const isSavingCurrency = updateUserMutation.isPending;
  const isSavingBudget = saveBudgetMutation.isPending;
  const isStartingCheckout = initializeSubscriptionMutation.isPending;
  const isActivatingPremium = activateSubscriptionMutation.isPending;
  const isAnySettingsActionPending = isSavingCurrency || isSavingBudget || isStartingCheckout || isActivatingPremium;

  const currentPeriodContext = useMemo(() => {
    const now = new Date();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() - 6);
    weekStartDate.setHours(0, 0, 0, 0);
    const weekEndDate = new Date(now);
    weekEndDate.setHours(23, 59, 59, 999);
    return {
      weekStart: weekStartDate.toISOString().slice(0, 10),
      weekEnd: weekEndDate.toISOString().slice(0, 10),
      currentYear: now.getUTCFullYear(),
      currentMonth: now.getUTCMonth() + 1,
      currentKey: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    };
  }, [user?.id]);

  const transactionsQuery = useQuery({
    queryKey: ['transactions', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getTransactions(user!.id)
  });

  const weeklySummaryQuery = useQuery({
    queryKey: ['weekly-summary', user?.id, currentPeriodContext.weekStart, currentPeriodContext.weekEnd],
    enabled: Boolean(user?.id),
    queryFn: () => getWeeklySummary(user!.id, currentPeriodContext.weekStart, currentPeriodContext.weekEnd)
  });

  const monthlySummaryQuery = useQuery({
    queryKey: ['monthly-summary', user?.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
    enabled: Boolean(user?.id),
    queryFn: () => getMonthlySummary(user!.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth)
  });

  const currentInsightsQuery = useQuery({
    queryKey: ['current-insights', user?.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
    enabled: Boolean(user?.id),
    queryFn: () => getCurrentInsights(user!.id)
  });

  const referralProgressQuery = useQuery({
    queryKey: ['referrals', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getReferralProgress(user!.id)
  });

  const budgetsQuery = useQuery({
    queryKey: ['budgets', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getCurrentBudgets(user!.id)
  });

  const selectedReportDataQuery = useQuery({
    queryKey: ['selected-report', user?.id, selectedReportYear, selectedReportMonth],
    enabled: Boolean(user?.id) && reportMode === 'monthly',
    queryFn: async () => {
      const [monthly, insights] = await Promise.all([
        getMonthlySummary(user!.id, selectedReportYear, selectedReportMonth),
        getMonthlyInsights(user!.id, selectedReportYear, selectedReportMonth)
      ]);
      return { monthly, insights };
    }
  });

  const adminAnalyticsQuery = useQuery({
    queryKey: ['admin-analytics', user?.id],
    enabled: isSuperAdmin,
    queryFn: () => getAdminAnalytics(),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });

  const adminProviderQuery = useQuery({
    queryKey: ['admin-whatsapp-provider', user?.id],
    enabled: isSuperAdmin,
    queryFn: () => getAdminWhatsAppProvider(),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });

  const adminPaymentSettingsQuery = useQuery({
    queryKey: ['admin-payment-settings', user?.id],
    enabled: isSuperAdmin,
    queryFn: () => getAdminPaymentSettings(),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });

  const updateAdminProviderMutation = useMutation({
    mutationFn: (payload: {
      provider?: WhatsAppProvider;
      whatchimp?: Partial<AdminWhatsAppSettings['whatchimp']>;
    }) => setAdminWhatsAppProvider(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-whatsapp-provider', user?.id], updated);
      setAdminWhatchimpDraft(updated.whatchimp);
      queryClient.invalidateQueries({ queryKey: ['admin-analytics', user?.id] });
    }
  });

  const updateAdminPaymentMutation = useMutation({
    mutationFn: (payload: Partial<AdminPaymentSettings>) => setAdminPaymentSettings(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-payment-settings', user?.id], updated);
      setAdminPaymentDraft(updated);
      queryClient.invalidateQueries({ queryKey: ['admin-analytics', user?.id] });
    }
  });

  const transactions = transactionsQuery.data ?? (user ? [] : mockTransactions);
  const weeklySummary = weeklySummaryQuery.data?.summary ?? null;
  const monthlySummary = monthlySummaryQuery.data?.summary ?? null;
  const currentInsights = currentInsightsQuery.data ?? null;
  const referralProgress = referralProgressQuery.data ?? null;
  const budgets = budgetsQuery.data ?? [];
  const adminAnalytics = adminAnalyticsQuery.data ?? null;
  const adminProviderInfo = adminProviderQuery.data ?? null;
  const adminPaymentSettings = adminPaymentSettingsQuery.data ?? null;
  const effectiveReferralLink = referralProgress?.referralLink
    ?? (referralProgress?.referralCode
      ? `${window.location.origin}/?ref=${encodeURIComponent(referralProgress.referralCode)}`
      : null)
    ?? (user?.referralCode
      ? `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`
      : null);
  const isAdminSaving = updateAdminProviderMutation.isPending || updateAdminPaymentMutation.isPending;

  const activeWeeklySummary = weeklySummary ?? defaultWeeklySummary;
  const activeMonthlySummary = monthlySummary ?? {
    totalRevenue: currentMonthSummary.totalRevenue,
    totalExpenses: currentMonthSummary.totalExpenses,
    directExpenses: currentMonthSummary.totalExpenses,
    indirectExpenses: 0,
    nonBusinessExpenses: 0,
    grossProfit: currentMonthSummary.totalRevenue - currentMonthSummary.totalExpenses,
    netProfit: currentMonthSummary.profit,
    profit: currentMonthSummary.profit,
    transactionCount: currentMonthSummary.transactionCount,
    categoryBreakdown: {},
    directExpenseBreakdown: {},
    indirectExpenseBreakdown: {},
    dailyBreakdown: [],
    cashFlow: {
      operatingInflow: currentMonthSummary.totalRevenue,
      operatingOutflow: currentMonthSummary.totalExpenses,
      financingInflow: 0,
      financingOutflow: 0,
      totalCashInflow: currentMonthSummary.totalRevenue,
      totalCashOutflow: currentMonthSummary.totalExpenses,
      netCashFlow: currentMonthSummary.profit
    }
  };

  const canShowInstallPromptByCooldown = () => {
    const lastDismissedRaw = window.localStorage.getItem(INSTALL_PROMPT_DISMISS_KEY);
    if (!lastDismissedRaw) return true;
    const lastDismissed = Number(lastDismissedRaw);
    if (Number.isNaN(lastDismissed)) return true;
    return Date.now() - lastDismissed > INSTALL_PROMPT_COOLDOWN_MS;
  };

  const dismissInstallPrompt = () => {
    setShowInstallPrompt(false);
    window.localStorage.setItem(INSTALL_PROMPT_DISMISS_KEY, String(Date.now()));
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setShowInstallPrompt(false);
        setInstallPromptEvent(null);
        window.localStorage.removeItem(INSTALL_PROMPT_DISMISS_KEY);
        return;
      }
    } catch (error) {
      console.error('Install prompt failed', error);
    }
    dismissInstallPrompt();
  };

  const applyHistoryDatePreset = (preset: HistoryDatePreset) => {
    const today = new Date();
    if (preset === 'all_time') {
      setHistoryStartDate('');
      setHistoryEndDate('');
      setHistoryDatePreset('all_time');
      return;
    }

    if (preset === 'this_month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setHistoryStartDate(toDateInputValue(start));
      setHistoryEndDate(toDateInputValue(today));
      setHistoryDatePreset('this_month');
      return;
    }

    if (preset === 'last_month') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      setHistoryStartDate(toDateInputValue(start));
      setHistoryEndDate(toDateInputValue(end));
      setHistoryDatePreset('last_month');
      return;
    }

    if (preset === 'last_90_days') {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      setHistoryStartDate(toDateInputValue(start));
      setHistoryEndDate(toDateInputValue(today));
      setHistoryDatePreset('last_90_days');
      return;
    }

    setHistoryDatePreset('custom');
  };

  const reportPeriodLabel = reportMode === 'yearly'
    ? `${selectedReportYear}`
    : new Date(Date.UTC(selectedReportYear, selectedReportMonth - 1, 1)).toLocaleString('default', { month: 'long', year: 'numeric' });
  const reportPeriodKey = `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
  const nowUtc = new Date();
  const isSelectedCurrentMonth = selectedReportYear === nowUtc.getUTCFullYear() && selectedReportMonth === nowUtc.getUTCMonth() + 1;
  const cachedReportSummary = reportSummaryCache[reportPeriodKey];
  const cachedReportInsights = reportInsightsCache[reportPeriodKey];

  const confirmedTransactions = transactions.filter((tx) => tx.status === 'confirmed' && !tx.correctionOfId);
  const userTimeZone = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dashboardDayPart = resolveDayPart(userTimeZone);
  const uniqueConfirmedDateKeys = Array.from(
    new Set(
      confirmedTransactions
        .map((tx) => toTimeZoneDateKey(tx.date, userTimeZone))
        .filter((dateKey) => Boolean(dateKey))
    )
  ).sort();
  const confirmedDateSet = new Set(uniqueConfirmedDateKeys);
  const todayDateKey = toTimeZoneDateKey(new Date(), userTimeZone);
  const yesterdayDateKey = shiftDateKey(todayDateKey, -1);
  const hasLoggedToday = confirmedDateSet.has(todayDateKey);
  const hasLoggedYesterday = confirmedDateSet.has(yesterdayDateKey);
  const streakAnchorKey = hasLoggedToday
    ? todayDateKey
    : hasLoggedYesterday
      ? yesterdayDateKey
      : (uniqueConfirmedDateKeys.at(-1) ?? '');
  let dailyStreakCount = 0;
  let streakCursor = streakAnchorKey;
  while (streakCursor && confirmedDateSet.has(streakCursor)) {
    dailyStreakCount += 1;
    streakCursor = shiftDateKey(streakCursor, -1);
  }
  const streakNeedsTodayCheckIn = !hasLoggedToday && dailyStreakCount > 0;
  const currentMonthPrefix = todayDateKey.slice(0, 7);
  const activeDaysThisMonth = uniqueConfirmedDateKeys.filter((dateKey) => dateKey.startsWith(currentMonthPrefix)).length;
  const activeReportSummary = reportMode === 'yearly'
    ? createSummaryFromTransactions(
        confirmedTransactions.filter((tx) => new Date(tx.date).getUTCFullYear() === selectedReportYear)
      )
    : selectedReportSummary ?? cachedReportSummary ?? (isSelectedCurrentMonth ? activeMonthlySummary : emptySummaryPayload);
  const activeReportTransactions = confirmedTransactions.filter((tx) => {
    const txDate = new Date(tx.date);
    if (Number.isNaN(txDate.getTime())) return false;
    if (reportMode === 'yearly') {
      return txDate.getUTCFullYear() === selectedReportYear;
    }
    return txDate.getUTCFullYear() === selectedReportYear && txDate.getUTCMonth() + 1 === selectedReportMonth;
  });

  const dashboardTopExpenseCategories = (
    Object.keys(activeMonthlySummary.directExpenseBreakdown ?? {}).length
    || Object.keys(activeMonthlySummary.indirectExpenseBreakdown ?? {}).length
  )
    ? mergeBusinessExpenseBreakdown(activeMonthlySummary)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    : currentMonthSummary.topExpenseCategories;

  const reportTopExpenseCategories = mergeBusinessExpenseBreakdown(activeReportSummary)
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const cashFlowLineItems = buildCashFlowLineItems(activeReportTransactions);
  const salesProfitTrendPoints = buildSalesProfitTrendPoints({
    transactions: activeReportTransactions,
    mode: reportMode,
    year: selectedReportYear,
    month: selectedReportMonth
  });

  const { incomeLines, directExpenseLines, indirectExpenseLines } = buildProfitLossLines(activeReportSummary);
  const netMargin = activeReportSummary.totalRevenue > 0
    ? (activeReportSummary.netProfit / activeReportSummary.totalRevenue) * 100
    : 0;

  const reportPeriodEndDate = reportMode === 'yearly'
    ? new Date(Date.UTC(selectedReportYear, 11, 31))
    : new Date(Date.UTC(selectedReportYear, selectedReportMonth, 0));

  const reportStatementSubtitle = reportMode === 'yearly'
    ? `For the year ended ${reportPeriodEndDate.toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : `For the month ended ${reportPeriodEndDate.toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  const statementPreparedBy = 'Akonta AI Accounting Assistant';
  const accountantReviewNote = reportMode === 'monthly'
    ? (selectedReportInsights ?? cachedReportInsights ?? (isSelectedCurrentMonth ? currentInsights : null))?.highlights[0]
      ?? 'Keep consistent daily records and category discipline to support reporting quality.'
    : activeReportSummary.netProfit >= 0
      ? 'The business remained profitable in the selected year. Maintain controls on expense-heavy categories.'
      : 'The selected year shows a loss position. Review pricing, sales mix, and controllable expenses.'
  const statementPeriodKey = reportMode === 'yearly'
    ? `${selectedReportYear}`
    : `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
  const statementBusinessKey = sanitizeFileName(user?.businessName ?? 'akonta-ai');

  const profitLossStatementParams = {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    statementPreparedBy,
    appCopyrightNotice,
    reportMode,
    incomeLines,
    directExpenseLines,
    indirectExpenseLines,
    activeReportSummary,
    netMargin,
    accountantReviewNote
  };

  const cashFlowStatementParams = {
    user,
    reportPeriodLabel,
    reportStatementSubtitle,
    activeCurrencyCode,
    statementPreparedBy,
    appCopyrightNotice,
    cashFlowLineItems,
    activeReportSummary
  };

  const handlePrintProfitLoss = () => {
    const statementHtml = buildProfitLossStatementHtml(profitLossStatementParams);
    printStatementHtml(statementHtml);
  };

  const handleDownloadProfitLoss = async () => {
    try {
      await generateProfitLossPdf({
        ...profitLossStatementParams,
        statementBusinessKey,
        statementPeriodKey
      });
    } catch (error) {
      console.error('Unable to generate PDF statement. Falling back to print.', error);
      handlePrintProfitLoss();
    }
  };

  const handleDownloadProfitLossCsv = () => {
    const businessName = user?.businessName || 'Akonta AI Business';
    const rows = buildProfitLossCsvRows({
      reportPeriodLabel,
      businessName,
      reportStatementSubtitle,
      activeCurrencyCode,
      activeReportSummary,
      incomeLines,
      directExpenseLines,
      indirectExpenseLines,
      netMargin
    });
    downloadCsvFile(`${statementBusinessKey}-profit-loss-${statementPeriodKey}.csv`, rows);
  };

  const handlePrintCashFlow = () => {
    const statementHtml = buildCashFlowStatementHtml(cashFlowStatementParams);
    printStatementHtml(statementHtml);
  };

  const handleDownloadCashFlow = async () => {
    try {
      await generateCashFlowPdf({
        ...cashFlowStatementParams,
        statementBusinessKey,
        statementPeriodKey
      });
    } catch (error) {
      console.error('Unable to generate cash flow PDF statement. Falling back to print.', error);
      handlePrintCashFlow();
    }
  };

  const handleDownloadCashFlowCsv = () => {
    const businessName = user?.businessName || 'Akonta AI Business';
    const rows = buildCashFlowCsvRows({
      reportPeriodLabel,
      businessName,
      reportStatementSubtitle,
      activeCurrencyCode,
      activeReportSummary,
      cashFlowLineItems
    });
    downloadCsvFile(`${statementBusinessKey}-cash-flow-${statementPeriodKey}.csv`, rows);
  };

  const adjustReportMonth = (delta: number) => {
    setSelectedReportMonth((current) => {
      const candidate = current + delta;
      if (candidate < 1) {
        setSelectedReportYear((year) => year - 1);
        return 12;
      }
      if (candidate > 12) {
        setSelectedReportYear((year) => year + 1);
        return 1;
      }
      return candidate;
    });
  };

  const adjustReportPeriod = (delta: number) => {
    if (reportMode === 'yearly') {
      setSelectedReportYear((current) => current + delta);
      return;
    }
    adjustReportMonth(delta);
  };

  const openTransactionAttachment = (transaction: Transaction) => {
    setAttachmentTransaction(transaction);
    setView('attach');
  };

  const refreshReferralData = async () => {
    if (!user) return;
    setIsReferralLoading(true);
    try {
      await referralProgressQuery.refetch();
    } catch (error) {
      console.error('Unable to refresh referral progress', error);
    } finally {
      setIsReferralLoading(false);
    }
  };

  const copyReferralLink = useCallback(async () => {
    if (!effectiveReferralLink) return;
    try {
      await navigator.clipboard.writeText(effectiveReferralLink);
      setReferralCopyMessage('Referral link copied.');
    } catch {
      setReferralCopyMessage('Unable to copy automatically. Please copy it manually.');
    }
    setTimeout(() => setReferralCopyMessage(null), 2400);
  }, [effectiveReferralLink]);

  const refreshPendingSyncCount = useCallback(async (userId: string) => {
    try {
      const count = await getPendingChatCount(userId);
      setPendingSyncCount(count);
      return count;
    } catch (error) {
      console.error('Unable to read offline queue count', error);
      return 0;
    }
  }, []);

  const applyChatEntryResult = useCallback(async (
    result: ChatEntryResult,
    options?: { fromOutbox?: boolean }
  ) => {
    setFollowUpStep(null);

    if (user?.id) {
      queryClient.setQueryData<Transaction[]>(['transactions', user.id], (previous = []) => {
        const merged = new Map(previous.map((tx) => [tx.id, tx]));
        for (const tx of result.transactions) {
          merged.set(tx.id, tx);
        }
        return Array.from(merged.values()).sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      });

      queryClient.setQueryData(
        ['weekly-summary', user.id, currentPeriodContext.weekStart, currentPeriodContext.weekEnd],
        {
          periodType: 'weekly',
          periodStart: currentPeriodContext.weekStart,
          periodEnd: currentPeriodContext.weekEnd,
          summary: result.summary
        }
      );
      queryClient.setQueryData(
        ['monthly-summary', user.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
        {
          periodType: 'monthly',
          periodStart: `${currentPeriodContext.currentYear}-${String(currentPeriodContext.currentMonth).padStart(2, '0')}-01`,
          periodEnd: `${currentPeriodContext.currentYear}-${String(currentPeriodContext.currentMonth).padStart(2, '0')}-${String(
            new Date(Date.UTC(currentPeriodContext.currentYear, currentPeriodContext.currentMonth, 0)).getUTCDate()
          ).padStart(2, '0')}`,
          summary: result.monthlySummary
        }
      );

      const currentKey = `${currentPeriodContext.currentYear}-${String(currentPeriodContext.currentMonth).padStart(2, '0')}`;
      setReportSummaryCache((prev) => ({ ...prev, [currentKey]: result.monthlySummary }));

      try {
        const latestInsights = await getCurrentInsights(user.id);
        queryClient.setQueryData(
          ['current-insights', user.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
          latestInsights
        );
        setReportInsightsCache((prev) => ({ ...prev, [currentKey]: latestInsights }));
      } catch (insightError) {
        console.error('Unable to refresh current insights after chat update', insightError);
      }
    }

    let botText = result.botReply;
    if (result.budgetStatuses.length > 0) {
      const expenseBudget = result.budgetStatuses.find((status) => status.budget.targetType === 'expense');
      if (expenseBudget) {
        if (expenseBudget.status === 'overBudget') {
          botText += `\n\nExpense alert: you are over budget by ${formatCurrency(Math.abs(expenseBudget.remaining))}.`;
        } else if (expenseBudget.status === 'nearTarget') {
          botText += `\n\nExpense watch: you have used ${Math.round(expenseBudget.percentUsed)}% of your budget.`;
        }
      }
    }

    if (options?.fromOutbox) {
      botText = `Synced pending entry.\n${botText}`;
    }

    const botResponse: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'bot',
      content: botText,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, botResponse]);

    if (user?.id) {
      invalidateUserDataQueries(user.id);
    }
  }, [currentPeriodContext.currentMonth, currentPeriodContext.currentYear, currentPeriodContext.weekEnd, currentPeriodContext.weekStart, formatCurrency, invalidateUserDataQueries, queryClient, user?.id]);

  const flushPendingChatOutbox = useCallback(async () => {
    if (!user || !navigator.onLine || isOutboxSyncing) return;

    setIsOutboxSyncing(true);
    try {
      const queued = await listPendingChatMessages(user.id);
      if (queued.length === 0) {
        setPendingSyncCount(0);
        return;
      }

      for (const item of queued) {
        try {
          const result = await postChatEntryMutation.mutateAsync({
            userId: user.id,
            message: item.message,
            channel: item.channel
          });
          await removePendingChatMessage(item.id);
          setMessages((prev) => prev.map((msg) => (
            msg.id === item.clientMessageId
              ? { ...msg, syncStatus: 'synced' }
              : msg
          )));
          await applyChatEntryResult(result, { fromOutbox: true });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await markPendingChatMessageFailure(item.id, reason);
          if (isOfflineSyncError(error)) {
            break;
          }
          setMessages((prev) => prev.map((msg) => (
            msg.id === item.clientMessageId
              ? { ...msg, syncStatus: 'failed' }
              : msg
          )));
        }
      }
    } finally {
      await refreshPendingSyncCount(user.id);
      setIsOutboxSyncing(false);
    }
  }, [applyChatEntryResult, isOutboxSyncing, postChatEntryMutation, refreshPendingSyncCount, user]);

  const submitChatMessage = useCallback(async (message: string) => {
    if (!user) {
      setError('Please complete onboarding before sending messages.');
      return;
    }

    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const userMessage: ChatMessage = {
      id: clientMessageId,
      type: 'user',
      content: message,
      timestamp: new Date(),
      syncStatus: 'synced'
    };
    setMessages((prev) => [...prev, userMessage]);
    setError(null);

    try {
      const result = await postChatEntryMutation.mutateAsync({
        userId: user.id,
        message,
        channel: 'web'
      });
      await applyChatEntryResult(result);
    } catch (error) {
      if (isOfflineSyncError(error)) {
        setMessages((prev) => prev.map((msg) => (
          msg.id === clientMessageId
            ? { ...msg, syncStatus: 'pending' }
            : msg
        )));
        try {
          await enqueuePendingChatMessage({
            userId: user.id,
            clientMessageId,
            message,
            channel: 'web'
          });
          await refreshPendingSyncCount(user.id);
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'bot',
              content: 'Captured offline. I will sync this entry automatically once your internet is back.',
              timestamp: new Date()
            }
          ]);
          return;
        } catch (queueError) {
          console.error('Unable to queue offline message', queueError);
          setMessages((prev) => prev.map((msg) => (
            msg.id === clientMessageId
              ? { ...msg, syncStatus: 'failed' }
              : msg
          )));
        }
      }

      console.error(error);
      const errorResponse: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'bot',
        content: "I couldn't save that entry right now. Please try again in a moment.",
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorResponse]);
    }
  }, [applyChatEntryResult, postChatEntryMutation, refreshPendingSyncCount, user]);

  const heroSlides = [
    {
      title: 'Your Accountant',
      subtitle: 'On WhatsApp'
    },
    {
      title: 'Your Accountant',
      subtitle: 'On Web Chat'
    }
  ];

  const DemoModeBanner = () =>
    isDemoMode ? (
      <div className="bg-yellow-100 border-b border-yellow-300 px-4 py-2 text-center text-sm font-semibold text-yellow-900">
        Demo mode active — web chat works locally while backend / WhatsApp configuration is pending.
      </div>
    ) : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referral = params.get('ref');
    if (referral && referral.trim()) {
      setOnboardingReferralCode(referral.trim());
      setView('onboarding');
    }
  }, []);

  useEffect(() => {
    const savedUser = window.localStorage.getItem('akontaai-user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        setView('chat');
      } catch (error) {
        console.error('Failed to restore user from storage', error);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      window.localStorage.setItem('akontaai-user', JSON.stringify(user));
    } else {
      window.localStorage.removeItem('akontaai-user');
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPendingSyncCount(0);
      return;
    }

    let cancelled = false;
    const bootstrapQueue = async () => {
      const pending = await refreshPendingSyncCount(user.id);
      if (!cancelled && pending > 0 && navigator.onLine) {
        await flushPendingChatOutbox();
      }
    };

    void bootstrapQueue();

    return () => {
      cancelled = true;
    };
  }, [flushPendingChatOutbox, refreshPendingSyncCount, user]);

  useEffect(() => {
    if (!user) return;
    const handleOnline = () => {
      void flushPendingChatOutbox();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingChatOutbox, user]);

  useEffect(() => {
    const current = (user?.currencyCode ?? 'GHS').toUpperCase();
    if (supportedCurrencies.includes(current as typeof supportedCurrencies[number])) {
      setSettingsCurrencyCode(current as typeof supportedCurrencies[number]);
    } else {
      setSettingsCurrencyCode('GHS');
    }
  }, [user?.currencyCode]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setIsAppInstalled(standalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = /safari/.test(userAgent) && !/crios|fxios|edgios|opr|opera/.test(userAgent);
    setIsIosInstallHintEligible(isIos && isSafari && !standalone);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setShowInstallPrompt(false);
      setInstallPromptEvent(null);
      window.localStorage.removeItem(INSTALL_PROMPT_DISMISS_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!user || isAppInstalled) {
      setShowInstallPrompt(false);
      return;
    }

    if (!canShowInstallPromptByCooldown()) return;

    if (installPromptEvent || isIosInstallHintEligible) {
      setShowInstallPrompt(true);
    }
  }, [user, isAppInstalled, installPromptEvent, isIosInstallHintEligible]);

  useEffect(() => {
    const interval = setInterval(() => {
      setHeroSlide((prev) => (prev + 1) % heroSlides.length);
    }, 4500);

    return () => clearInterval(interval);
  }, [heroSlides.length]);

  useEffect(() => {
    if (!user) return;

    const cachedMessages = window.localStorage.getItem(`akontaai-chat-${user.id}`);
    if (cachedMessages) {
      try {
        const parsedMessages = JSON.parse(cachedMessages) as ChatMessage[];
        setMessages(parsedMessages.map((msg) => ({ ...msg, timestamp: new Date(msg.timestamp) })));
      } catch (error) {
        console.error('Unable to restore chat messages', error);
      }
    }
  }, [user]);

  useEffect(() => {
    if (monthlySummaryQuery.data?.summary) {
      setReportSummaryCache((prev) => ({ ...prev, [currentPeriodContext.currentKey]: monthlySummaryQuery.data.summary }));
    }
  }, [currentPeriodContext.currentKey, monthlySummaryQuery.data?.summary]);

  useEffect(() => {
    if (currentInsightsQuery.data) {
      setReportInsightsCache((prev) => ({ ...prev, [currentPeriodContext.currentKey]: currentInsightsQuery.data }));
    }
  }, [currentInsightsQuery.data, currentPeriodContext.currentKey]);

  useEffect(() => {
    if (transactionsQuery.error) {
      console.error('Failed to load transactions', transactionsQuery.error);
    }
    if (weeklySummaryQuery.error) {
      console.error('Failed to load weekly summary', weeklySummaryQuery.error);
    }
    if (monthlySummaryQuery.error) {
      console.error('Failed to load monthly summary', monthlySummaryQuery.error);
    }
    if (currentInsightsQuery.error) {
      console.error('Failed to load current insights', currentInsightsQuery.error);
    }
    if (referralProgressQuery.error) {
      console.error('Failed to load referral progress', referralProgressQuery.error);
    }
  }, [currentInsightsQuery.error, monthlySummaryQuery.error, referralProgressQuery.error, transactionsQuery.error, weeklySummaryQuery.error]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference) return;

    let cancelled = false;
    const finalizePayment = async () => {
      try {
        const result = await verifySubscriptionMutation.mutateAsync(reference);
        if (cancelled) return;
        if (result.user) {
          setUser(result.user);
        }
        if (result.status === 'success') {
          setSettingsNotice('Subscription payment confirmed. Premium is now active.');
        } else {
          setError('Payment verification did not return success yet. Please try again in a moment.');
        }
      } catch (paymentError) {
        console.error('Unable to verify payment', paymentError);
        if (!cancelled) {
          setError('Unable to verify payment right now.');
        }
      } finally {
        const cleanUrl = `${window.location.pathname}${window.location.hash}`;
        window.history.replaceState({}, '', cleanUrl);
      }
    };

    void finalizePayment();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSelectedReportSummary(null);
      setSelectedReportInsights(null);
      return;
    }
    if (reportMode === 'yearly') {
      setSelectedReportSummary(null);
      setSelectedReportInsights(null);
      return;
    }
    const selectedKey = `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
    setSelectedReportSummary(reportSummaryCache[selectedKey] ?? null);
    setSelectedReportInsights(reportInsightsCache[selectedKey] ?? null);
  }, [reportInsightsCache, reportMode, reportSummaryCache, selectedReportMonth, selectedReportYear, user]);

  useEffect(() => {
    if (!selectedReportDataQuery.data || reportMode !== 'monthly') return;
    const selectedKey = `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
    setSelectedReportSummary(selectedReportDataQuery.data.monthly.summary);
    setSelectedReportInsights(selectedReportDataQuery.data.insights);
    setReportSummaryCache((prev) => ({ ...prev, [selectedKey]: selectedReportDataQuery.data.monthly.summary }));
    setReportInsightsCache((prev) => ({ ...prev, [selectedKey]: selectedReportDataQuery.data.insights }));
  }, [reportMode, selectedReportDataQuery.data, selectedReportMonth, selectedReportYear]);

  useEffect(() => {
    if (!selectedReportDataQuery.error || reportMode !== 'monthly') return;
    const selectedKey = `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
    console.error('Failed to load selected report summary', selectedReportDataQuery.error);
    if (!reportSummaryCache[selectedKey]) {
      setSelectedReportSummary(null);
    }
    if (!reportInsightsCache[selectedKey]) {
      setSelectedReportInsights(null);
    }
  }, [reportInsightsCache, reportMode, reportSummaryCache, selectedReportDataQuery.error, selectedReportMonth, selectedReportYear]);

  useEffect(() => {
    registerDemoModeListener(() => setIsDemoMode(true));
  }, []);

  useEffect(() => {
    if (!budgets.length) return;
    const expenseBudget = budgets.find((budget) => budget.targetType === 'expense');
    if (expenseBudget) {
      setBudgetTargetType('expense');
      setBudgetAmount(expenseBudget.amount.toString());
    }
  }, [budgets]);

  useEffect(() => {
    if (budgetsQuery.error) {
      console.error('Unable to load current budgets', budgetsQuery.error);
    }
  }, [budgetsQuery.error]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setAdminWhatchimpDraft(null);
      setAdminPaymentDraft(null);
      setAdminError(null);
      return;
    }
    if (adminProviderQuery.data && !adminWhatchimpDraft) {
      setAdminWhatchimpDraft(adminProviderQuery.data.whatchimp);
    }
    if (adminPaymentSettingsQuery.data && !adminPaymentDraft) {
      setAdminPaymentDraft(adminPaymentSettingsQuery.data);
    }
  }, [adminPaymentDraft, adminPaymentSettingsQuery.data, adminProviderQuery.data, adminWhatchimpDraft, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const failed = adminAnalyticsQuery.error || adminProviderQuery.error || adminPaymentSettingsQuery.error;
    if (!failed) return;
    console.error('Unable to load admin data', failed);
    setAdminError('Unable to load admin analytics right now.');
  }, [adminAnalyticsQuery.error, adminPaymentSettingsQuery.error, adminProviderQuery.error, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    if (adminAnalyticsQuery.isSuccess && adminProviderQuery.isSuccess && adminPaymentSettingsQuery.isSuccess) {
      setAdminError(null);
    }
  }, [adminAnalyticsQuery.isSuccess, adminPaymentSettingsQuery.isSuccess, adminProviderQuery.isSuccess, isSuperAdmin]);

  useEffect(() => {
    if (user) {
      window.localStorage.setItem(
        `akontaai-chat-${user.id}`,
        JSON.stringify(messages)
      );
    }
  }, [messages, user]);

  useEffect(() => {    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (view === 'reports') {
      if (hasReportAccess) {
        setDashboardTab('reports');
      } else {
        setDashboardTab('overview');
        setReportLockNotice('Reports are locked. Subscribe to regain access.');
      }
      setView('dashboard');
    }
  }, [view, hasReportAccess]);

  useEffect(() => {
    if (!hasReportAccess && dashboardTab === 'reports') {
      setDashboardTab('overview');
    }
  }, [dashboardTab, hasReportAccess]);

  useEffect(() => {
    if (hasReportAccess) {
      setReportLockNotice(null);
    }
  }, [hasReportAccess]);

  if (view === 'landing') {
    return <LandingView setView={setView} heroSlide={heroSlide} setHeroSlide={setHeroSlide} appCopyrightNotice={appCopyrightNotice} />;
  }

  // Onboarding Flow
  if (view === 'onboarding') {
    const steps = [
      {
        title: "What's your name?",
        subtitle: "Let's get to know you",
        field: 'name',
        placeholder: 'Enter your first name'
      },
      {
        title: "What's your WhatsApp number?",
        subtitle: "We'll send you daily prompts here",
        field: 'phoneNumber',
        placeholder: '+233 XX XXX XXXX'
      },
      {
        title: "What's your business name?",
        subtitle: "This helps us personalize your experience",
        field: 'businessName',
        placeholder: 'e.g., Mama Adwoa\'s Shop'
      },
      {
        title: "What type of business?",
        subtitle: "Select the closest match",
        field: 'businessType',
        options: ['Trading / Retail', 'Food & Beverages', 'Services', 'Fashion & Beauty', 'Tech & Digital', 'Other']
      },
      {
        title: "When should we check in?",
        subtitle: "Pick your preferred daily reminder time",
        field: 'preferredTime',
        options: ['morning', 'afternoon', 'evening']
      }
    ];

    const currentStep = steps[onboardingStep];

    const finishOnboarding = async () => {
      if (onboardingStep < steps.length - 1) {
        setOnboardingStep(onboardingStep + 1);
        return;
      }

      setError(null);

      try {
        const savedUser = await createUserMutation.mutateAsync({
          name: formData.name,
          phoneNumber: formData.phoneNumber,
          businessName: formData.businessName,
          businessType: formData.businessType,
          preferredTime: formData.preferredTime,
          timezone: 'Africa/Accra',
          currencyCode: 'GHS',
          referralCode: onboardingReferralCode ?? undefined,
          subscriptionStatus: 'trial'
        });

        setUser(savedUser);
        if (onboardingReferralCode) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete('ref');
          window.history.replaceState({}, '', nextUrl.toString());
          setOnboardingReferralCode(null);
        }
        setView('chat');
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : 'Failed to create your account. Please try again.';
        setError(message);
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex flex-col">
        <div className="px-4 py-6">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <button 
              onClick={() => onboardingStep > 0 ? setOnboardingStep(onboardingStep - 1) : setView('landing')}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeftIcon size={20} className="text-gray-600" />
            </button>
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div 
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i <= onboardingStep ? 'bg-green-500 w-6' : 'bg-gray-200 w-1.5'
                  }`}
                />
              ))}
            </div>
            <div className="w-10"></div>
          </div>
        </div>

        <div className="flex-1 px-4 py-12">
          <div className="max-w-md mx-auto text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{currentStep.title}</h1>
            <p className="text-gray-500 mb-8">{currentStep.subtitle}</p>
            {onboardingReferralCode && (
              <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                Referral applied: {onboardingReferralCode}
              </p>
            )}

            {currentStep.options ? (
              <div className="space-y-3">
                {currentStep.field === 'preferredTime' ? (
                  <>
                    {['morning', 'afternoon', 'evening'].map((time) => (
                      <button
                        key={time}
                        onClick={() => setFormData({ ...formData, preferredTime: time as 'morning' | 'afternoon' | 'evening' })}
                        className={`w-full p-4 rounded-2xl border-2 transition-all ${
                          formData.preferredTime === time
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">
                              {time === 'morning' ? '🌅' : time === 'afternoon' ? '☀️' : '🌙'}
                            </span>
                            <div className="text-left">
                              <p className="font-semibold text-gray-900 capitalize">{time}</p>
                              <p className="text-sm text-gray-500">
                                {time === 'morning' ? '8:00 AM' : time === 'afternoon' ? '2:00 PM' : '7:00 PM'}
                              </p>
                            </div>
                          </div>
                          {formData.preferredTime === time && (
                            <CheckIcon className="text-green-500" size={20} />
                          )}
                        </div>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {currentStep.options.map((option) => (
                      <button
                        key={option}
                        onClick={() => setFormData({ ...formData, [currentStep.field]: option as any })}
                        className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${
                          formData[currentStep.field as keyof typeof formData] === option
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900">{option}</span>
                          {formData[currentStep.field as keyof typeof formData] === option && (
                            <CheckIcon className="text-green-500" size={20} />
                          )}
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <input
                type="text"
                placeholder={currentStep.placeholder}
                value={formData[currentStep.field as keyof typeof formData] as string}
                onChange={(e) => setFormData({ ...formData, [currentStep.field]: e.target.value })}
                className="w-full px-5 py-4 rounded-2xl border-2 border-gray-200 focus:border-green-500 focus:outline-none text-lg"
                autoFocus
              />
            )}
          </div>
        </div>

        <div className="px-4 py-8">
          <div className="max-w-md mx-auto">
            {error && (
              <p className="mb-4 text-sm text-red-600">{error}</p>
            )}
            <button
              onClick={finishOnboarding}
              disabled={!formData[currentStep.field as keyof typeof formData] || isOnboardingSubmitting}
              className="w-full py-4 bg-green-500 text-white rounded-2xl font-semibold text-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isOnboardingSubmitting ? 'Saving...' : onboardingStep === steps.length - 1 ? 'Start 1-Month Free Trial' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main App Layout with Bottom Navigation
  const BottomNav = () => {
    const shouldShowInstallBanner = Boolean(
      user && showInstallPrompt && !isAppInstalled && (installPromptEvent || isIosInstallHintEligible)
    );

    return (
      <>
        {shouldShowInstallBanner && (
          <div className="fixed bottom-20 left-4 right-4 z-30">
            <div className="mx-auto max-w-md rounded-2xl border border-green-200 bg-white p-4 shadow-lg shadow-green-100">
              <p className="text-sm font-semibold text-gray-900">Install Akonta AI App</p>
              <p className="mt-1 text-xs text-gray-600">
                {installPromptEvent
                  ? 'Save Akonta AI to your home screen for a faster, app-like experience and daily check-ins.'
                  : 'On iPhone Safari, tap Share and then Add to Home Screen to install Akonta AI.'}
              </p>
              <div className="mt-3 flex gap-2">
                {installPromptEvent ? (
                  <button
                    onClick={handleInstallApp}
                    className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    Install App
                  </button>
                ) : (
                  <button
                    onClick={dismissInstallPrompt}
                    className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                  >
                    Got it
                  </button>
                )}
                <button
                  onClick={dismissInstallPrompt}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 safe-area-inset-bottom">
          <div className="max-w-md mx-auto flex justify-around items-center">
            {[
              { id: 'landing' as AppView, icon: HomeIcon, label: 'Home' },
              { id: 'chat' as AppView, icon: ChatIcon, label: 'Chat' },
              { id: 'dashboard' as AppView, icon: ChartIcon, label: 'Dashboard' },
              { id: 'history' as AppView, icon: HistoryIcon, label: 'History' },
              { id: 'settings' as AppView, icon: SettingsIcon, label: 'Settings' },
              ...(user?.isSuperAdmin ? [{ id: 'admin' as AppView, icon: ShieldIcon, label: 'Admin' }] : [])
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
                  view === item.id ? 'text-green-600' : 'text-gray-400'
                }`}
              >
                <item.icon size={22} />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </>
    );
  };

  const ReportWorkspace = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500">Selected period</p>
            <h2 className="text-xl font-semibold text-gray-900">{reportPeriodLabel}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setReportMode('monthly')}
              className={`rounded-full border px-3 py-2 text-sm ${reportMode === 'monthly' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            >
              Month
            </button>
            <button
              onClick={() => setReportMode('yearly')}
              className={`rounded-full border px-3 py-2 text-sm ${reportMode === 'yearly' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            >
              Year
            </button>
            <button
              onClick={() => adjustReportPeriod(-1)}
              className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              onClick={() => adjustReportPeriod(1)}
              className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Revenue</p>
            <p className="mt-2 text-2xl font-bold text-green-600">{formatCurrency(activeReportSummary.totalRevenue)}</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Direct Expenses</p>
            <p className="mt-2 text-2xl font-bold text-amber-700">{formatCurrency(activeReportSummary.directExpenses)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Gross Profit</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(activeReportSummary.grossProfit)}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Indirect Expenses</p>
            <p className="mt-2 text-2xl font-bold text-red-600">{formatCurrency(activeReportSummary.indirectExpenses)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Net Profit</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(activeReportSummary.netProfit)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Transactions</p>
            <p className="text-2xl font-bold text-gray-900">{activeReportSummary.transactionCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-gray-500">Accounting format</p>
            <h3 className="text-xl font-semibold text-gray-900">Profit & Loss Statement</h3>
            <p className="text-sm text-gray-500">{reportStatementSubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handlePrintProfitLoss}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Print / Save PDF
            </button>
            <button
              onClick={handleDownloadProfitLoss}
              className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              Download PDF
            </button>
            <button
              onClick={handleDownloadProfitLossCsv}
              className="rounded-full border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-100"
            >
              Download CSV
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{user?.businessName || 'Akonta AI Business'}</p>
            <p className="text-xs text-gray-500">{reportPeriodLabel}</p>
          </div>

          <div className="px-4 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Income</p>
            <div className="space-y-2">
              {(incomeLines.length > 0 ? incomeLines : [{ label: 'No income recorded', amount: 0 }]).map((line) => (
                <div key={`income-${line.label}`} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{line.label}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(line.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                <span>Total Income</span>
                <span>{formatCurrency(activeReportSummary.totalRevenue)}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Less: Direct Expenses</p>
            <div className="space-y-2">
              {(directExpenseLines.length > 0 ? directExpenseLines : [{ label: 'No direct expenses recorded', amount: 0 }]).map((line) => (
                <div key={`direct-expense-${line.label}`} className="flex items-center justify-between text-sm">
                  <span className="pl-4 text-gray-700">{line.label}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(line.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                <span>Total Direct Expenses</span>
                <span>{formatCurrency(activeReportSummary.directExpenses)}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
              <span>Gross Profit</span>
              <span>{formatCurrency(activeReportSummary.grossProfit)}</span>
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Less: Indirect Business Expenses</p>
            <div className="space-y-2">
              {(indirectExpenseLines.length > 0 ? indirectExpenseLines : [{ label: 'No indirect expenses recorded', amount: 0 }]).map((line) => (
                <div key={`indirect-expense-${line.label}`} className="flex items-center justify-between text-sm">
                  <span className="pl-4 text-gray-700">{line.label}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(line.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                <span>Total Indirect Expenses</span>
                <span>{formatCurrency(activeReportSummary.indirectExpenses)}</span>
              </div>
            </div>
          </div>

          <div className="border-t-2 border-gray-900 bg-gray-50 px-4 py-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-gray-900">
              <span>Total Business Expenses</span>
              <span>{formatCurrency(activeReportSummary.totalExpenses)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-bold">
              <span>Net Profit / (Loss)</span>
              <span className={activeReportSummary.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}>
                {formatCurrency(activeReportSummary.netProfit)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Net margin: {activeReportSummary.totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : 'N/A'}
            </p>
          </div>

          <div className="border-t border-gray-200 px-4 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Accountant Review Note</p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
              {accountantReviewNote}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Cash movement only</p>
            <h3 className="text-xl font-semibold text-gray-900">Cash Flow Snapshot</h3>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
              {reportPeriodLabel}
            </span>
            <button
              onClick={handlePrintCashFlow}
              className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Print / Save PDF
            </button>
            <button
              onClick={handleDownloadCashFlow}
              className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
            >
              Download PDF
            </button>
            <button
              onClick={handleDownloadCashFlowCsv}
              className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100"
            >
              Download CSV
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <span className="text-gray-600">Operating cash inflow</span>
            <span className="font-semibold text-gray-900">{formatCurrency(activeReportSummary.cashFlow.operatingInflow)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <span className="text-gray-600">Operating cash outflow</span>
            <span className="font-semibold text-gray-900">{formatCurrency(activeReportSummary.cashFlow.operatingOutflow)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <span className="text-gray-600">Financing cash inflow</span>
            <span className="font-semibold text-gray-900">{formatCurrency(activeReportSummary.cashFlow.financingInflow)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <span className="text-gray-600">Financing cash outflow</span>
            <span className="font-semibold text-gray-900">{formatCurrency(activeReportSummary.cashFlow.financingOutflow)}</span>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-gray-900 bg-gray-50 px-4 py-4">
          <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
            <span>Total cash inflow</span>
            <span>{formatCurrency(activeReportSummary.cashFlow.totalCashInflow)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm font-semibold text-gray-900">
            <span>Total cash outflow</span>
            <span>{formatCurrency(activeReportSummary.cashFlow.totalCashOutflow)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-base font-bold">
            <span>Net Cash Flow</span>
            <span className={activeReportSummary.cashFlow.netCashFlow >= 0 ? 'text-green-700' : 'text-red-700'}>
              {formatCurrency(activeReportSummary.cashFlow.netCashFlow)}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Period guidance</h3>
          <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
            {reportMode === 'monthly' ? 'Monthly insights' : 'Year mode'}
          </span>
        </div>

        {reportMode === 'yearly' ? (
          <p className="text-sm text-gray-500">
            Monthly advisory is available in Month mode. Switch from Year to Month to view target pace, expense variance, and credit-readiness for a specific month.
          </p>
        ) : (selectedReportInsights ?? cachedReportInsights ?? (isSelectedCurrentMonth ? currentInsights : null)) ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Revenue pace</p>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  {(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.targetStatus.revenueStatus === 'behind'
                    ? 'Behind target'
                    : (selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.targetStatus.revenueStatus === 'ahead'
                      ? 'Ahead of target'
                      : 'On track'}
                </p>
                {(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.targetStatus.revenueGapToDate !== undefined && (
                  <p className="mt-1 text-xs text-gray-600">
                    Gap: {formatCurrency(Math.abs((selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.targetStatus.revenueGapToDate ?? 0))}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Expense variance</p>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  {(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.expenseOverrun.isOverrun ? 'Above pace' : 'Within pace'}
                </p>
                {(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.expenseOverrun.varianceByNow !== undefined && (
                  <p className="mt-1 text-xs text-gray-600">
                    Variance: {formatCurrency(Math.abs((selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.expenseOverrun.varianceByNow ?? 0))}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Credit readiness</p>
                <p className="mt-2 text-sm font-semibold text-gray-900 capitalize">
                  {(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.creditReadiness.level} ({(selectedReportInsights ?? cachedReportInsights ?? currentInsights)?.creditReadiness.score}/100)
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Insights are loading for this period. If this persists, try selecting the period again.</p>
        )}
      </div>

      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Sales & Profit Trend</h3>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line chart</span>
        </div>
        <SalesProfitTrendChart points={salesProfitTrendPoints} formatCurrency={formatCurrency} />
      </div>

      <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Expense breakdown</h3>
        {reportTopExpenseCategories.length > 0 ? (
          <div className="space-y-3">
            {reportTopExpenseCategories.map((cat, i) => {
              const percentage = activeReportSummary.totalExpenses > 0
                ? (cat.amount / activeReportSummary.totalExpenses) * 100
                : 0;
              const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500'];
              return (
                <div key={cat.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{cat.category}</span>
                    <span className="font-medium text-gray-900">{formatCurrency(cat.amount)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors[i]} rounded-full`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No expense categories available for this period.</p>
        )}
      </div>
    </div>
  );

  // Chat View
  if (view === 'attach') {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Attach supporting document</h1>
            <p className="text-sm text-gray-500">Add a receipt, invoice, or payment confirmation for this transaction.</p>
          </div>
          <button
            onClick={() => setView('chat')}
            className="rounded-full bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600"
          >
            Back to chat
          </button>
        </div>

        <div className="px-4 py-6">
          {attachmentTransaction ? (
            <div className="bg-white rounded-3xl p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-500">Transaction</p>
                  <p className="text-xl font-semibold text-gray-900">{attachmentTransaction.category || attachmentTransaction.type}</p>
                  <p className="text-sm text-gray-500">{attachmentTransaction.notes || 'No notes provided'}</p>
                </div>
                <p className={`text-xl font-bold ${attachmentTransaction.type === 'revenue' ? 'text-green-600' : 'text-red-600'}`}>
                  {attachmentTransaction.type === 'revenue' ? '+' : '-'}{formatCurrency(attachmentTransaction.amount)}
                </p>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                  <p className="text-gray-600 mb-3">Upload the supporting document for this transaction.</p>
                  <input
                    type="file"
                    className="mx-auto block"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && attachmentTransaction) {
                        const updated = { ...attachmentTransaction, attachmentName: file.name };
                        setAttachmentTransaction(updated);
                        if (user?.id) {
                          queryClient.setQueryData<Transaction[]>(['transactions', user.id], (previous = []) =>
                            previous.map((tx) => (tx.id === updated.id ? updated : tx))
                          );
                        }
                      }
                    }}
                  />
                </div>
                {attachmentTransaction.attachmentName && (
                  <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
                    <p className="text-sm text-blue-700">Attached document: {attachmentTransaction.attachmentName}</p>
                  </div>
                )}
                {attachmentTransaction.notes && (
                  <div className="rounded-2xl bg-green-50 border border-green-200 p-4">
                    <p className="text-sm text-green-700">{attachmentTransaction.notes}</p>
                  </div>
                )}
                <button
                  onClick={() => setView('chat')}
                  className="w-full rounded-full bg-green-500 px-4 py-3 text-sm font-semibold text-white hover:bg-green-600"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <p className="text-gray-600">No transaction selected. Return to chat to attach a document to a transaction.</p>
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  if (view === 'chat') {
    const handleMessageAction = (route?: string, transactionId?: string) => {
      if (!route || !transactionId) return;
      if (route.startsWith('/attach/')) {
        const tx = transactions.find((t) => t.id === transactionId);
        if (tx) {
          setAttachmentTransaction(tx);
          setView('attach');
        }
      }
    };

    const handleSend = async () => {
      if (!inputValue.trim()) return;
      const message = inputValue.trim();
      setInputValue('');
      await submitChatMessage(message);
    };

    return (
      <div className="min-h-screen bg-gray-100 pb-20">
        <DemoModeBanner />

        {/* Header */}
        <div className="bg-green-600 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5">
            <img src={brandMarkSrc} alt="Akonta AI logo mark" className="h-full w-full object-contain" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold">Akonta AI</p>
            <p className="text-green-100 text-xs">
              {pendingSyncCount > 0
                ? `${pendingSyncCount} pending sync entr${pendingSyncCount === 1 ? 'y' : 'ies'}${isOutboxSyncing ? ' (syncing...)' : ''}`
                : 'Web chatbot active — WhatsApp integration also available.'}
            </p>
          </div>
          <button className="p-2">
            <BellIcon className="text-white" size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="p-4 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${msg.type === 'user' ? 'order-2' : 'order-1'}`}>
                <div 
                  className={`px-4 py-2 rounded-2xl ${
                    msg.type === 'user' 
                      ? 'bg-green-500 text-white rounded-tr-sm' 
                      : 'bg-white text-gray-800 rounded-tl-sm shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.content.split('**').map((part, i) => 
                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                  )}</p>
                  {msg.actionLabel && msg.actionRoute && (
                    <button
                      onClick={() => handleMessageAction(msg.actionRoute, msg.actionTransactionId)}
                      className="mt-3 w-full rounded-full bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 transition-colors"
                    >
                      {msg.actionLabel}
                    </button>
                  )}
                </div>
                <p className={`text-xs text-gray-400 mt-1 ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>
                  {formatTime(msg.timestamp)}
                  {msg.type === 'user' && msg.syncStatus === 'pending' ? ' • Pending sync' : ''}
                  {msg.type === 'user' && msg.syncStatus === 'failed' ? ' • Sync failed' : ''}
                </p>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="fixed bottom-16 left-0 right-0 bg-gray-100 px-4 py-3">
          <div className="max-w-lg mx-auto flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-3 bg-white rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={handleSend}
              className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white hover:bg-green-600 transition-colors"
            >
              <SendIcon size={20} />
            </button>
          </div>
        </div>

        <BottomNav />
      </div>
    );
  }

  // Dashboard View
  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        {/* Header */}
        <div className="bg-gradient-to-br from-green-500 to-green-600 px-4 pt-6 pb-20">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-green-100 text-sm">Good {dashboardDayPart},</p>
              <h1 className="text-white text-xl font-bold">{user?.name || 'Kofi'}</h1>
            </div>
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <BellIcon className="text-white" size={20} />
            </div>
          </div>
        </div>

        <div className="px-4 -mt-14 space-y-6">
          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDashboardTab('overview')}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold ${dashboardTab === 'overview' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                Overview
              </button>
              <button
                onClick={() => {
                  if (!hasReportAccess) {
                    setReportLockNotice('Reports are locked after your 1-month free access. Subscribe to unlock.');
                    return;
                  }
                  setDashboardTab('reports');
                }}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                  hasReportAccess
                    ? dashboardTab === 'reports'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                Reports
              </button>
            </div>
          </div>

          {!hasReportAccess && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Reports are available only on active subscription.
            </div>
          )}
          {reportLockNotice && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {reportLockNotice}
            </div>
          )}

          <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl shadow-lg shadow-orange-200 p-4 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-amber-100">Daily streak</p>
                <p className="mt-1.5 text-2xl font-bold">
                  {dailyStreakCount} day{dailyStreakCount === 1 ? '' : 's'}
                </p>
                <p className="mt-2 text-sm text-amber-50">
                  {hasLoggedToday
                    ? 'Great consistency. You have logged today.'
                    : streakNeedsTodayCheckIn
                      ? 'Log today to keep your streak going.'
                      : 'Start your streak by logging today.'}
                </p>
              </div>
              <div className="rounded-xl bg-white/20 p-2">
                <CalendarIcon className="text-white" size={18} />
              </div>
            </div>
            <div className="mt-3 border-t border-white/25 pt-2.5 text-xs text-amber-100">
              Active days this month: {activeDaysThisMonth}
            </div>
          </div>

          {dashboardTab === 'reports' && hasReportAccess ? (
            <ReportWorkspace />
          ) : (
            <>
          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500">Weekly performance</p>
                <h2 className="text-xl font-semibold text-gray-900">Business overview</h2>
              </div>
              <span className="text-xs bg-green-100 text-green-600 px-3 py-1 rounded-full font-medium">
                Weekly
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUpIcon className="text-green-500" size={16} />
                  <span className="text-sm text-gray-500">Revenue</span>
                </div>
                <p className="text-lg font-bold text-green-600">{formatCurrency(activeWeeklySummary.totalRevenue)}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDownIcon className="text-red-500" size={16} />
                  <span className="text-sm text-gray-500">Expenses</span>
                </div>
                <p className="text-lg font-bold text-red-600">{formatCurrency(activeWeeklySummary.totalExpenses)}</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-sm text-gray-500 mb-1">Profit</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(activeWeeklySummary.profit)}</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-sm text-gray-500 mb-1">Transactions</p>
                <p className="text-lg font-bold text-gray-900">{activeWeeklySummary.transactionCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Monthly snapshot</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-sm text-gray-500">Revenue</p>
                <p className="mt-2 text-2xl font-bold text-green-600">{formatCurrency(activeMonthlySummary.totalRevenue)}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4">
                <p className="text-sm text-gray-500">Expenses</p>
                <p className="mt-2 text-2xl font-bold text-red-600">{formatCurrency(activeMonthlySummary.totalExpenses)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Month-to-date guidance</h3>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Live</span>
            </div>

            {currentInsights ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Revenue pace</p>
                    <p className="mt-2 text-sm font-semibold text-gray-900">
                      {currentInsights.targetStatus.revenueStatus === 'behind'
                        ? 'Behind target'
                        : currentInsights.targetStatus.revenueStatus === 'ahead'
                          ? 'Ahead of target'
                          : 'On track'}
                    </p>
                    {currentInsights.targetStatus.revenueGapToDate !== undefined && (
                      <p className="mt-1 text-xs text-gray-600">
                        Gap: {formatCurrency(Math.abs(currentInsights.targetStatus.revenueGapToDate))}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Expense control</p>
                    <p className="mt-2 text-sm font-semibold text-gray-900">
                      {currentInsights.expenseOverrun.isOverrun ? 'Needs attention' : 'Within pace'}
                    </p>
                    {currentInsights.expenseOverrun.varianceByNow !== undefined && (
                      <p className="mt-1 text-xs text-gray-600">
                        Variance: {formatCurrency(Math.abs(currentInsights.expenseOverrun.varianceByNow))}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Credit readiness</p>
                    <p className="mt-2 text-sm font-semibold text-gray-900 capitalize">
                      {currentInsights.creditReadiness.level} ({currentInsights.creditReadiness.score}/100)
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {currentInsights.creditReadiness.daysWithRecords} days with records this month
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {currentInsights.highlights.slice(0, 2).map((line, index) => (
                    <div key={`${line}-${index}`} className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Log entries and set targets to unlock live advisory guidance.</p>
            )}
          </div>

          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Category snapshot</h3>
            {dashboardTopExpenseCategories.length > 0 ? (
              <div className="space-y-3">
                {dashboardTopExpenseCategories.map((cat, i) => {
                  const percentage = activeMonthlySummary.totalExpenses > 0
                    ? (cat.amount / activeMonthlySummary.totalExpenses) * 100
                    : 0;
                  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500'];
                  return (
                    <div key={cat.category}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{cat.category}</span>
                        <span className="font-medium text-gray-900">{formatCurrency(cat.amount)}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${colors[i]} rounded-full`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No category data available yet.</p>
            )}
          </div>

          {user?.subscriptionStatus === 'trial' && hasReportAccess && (
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <ClockIcon className="text-white" size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold">1-Month Free Access Active</p>
                  <p className="text-amber-100 text-sm">
                    {subscriptionDaysRemaining !== null
                      ? `${subscriptionDaysRemaining} day${subscriptionDaysRemaining === 1 ? '' : 's'} left in your 1-month trial`
                      : 'Active this month'}
                  </p>
                </div>
                <button 
                  onClick={() => setView('settings')}
                  className="bg-white text-amber-600 px-4 py-2 rounded-full font-medium text-sm"
                >
                  Manage Plan
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  // Reports view is merged into Dashboard tabs.
  if (view === 'reports') return null;

  // History View
  if (view === 'history') {
    const historyStart = historyStartDate ? new Date(`${historyStartDate}T00:00:00`) : null;
    const historyEnd = historyEndDate ? new Date(`${historyEndDate}T23:59:59.999`) : null;

    const filteredTransactions = transactions
      .filter((tx) => {
        if (historyTransactionTypeFilter === 'all') return true;
        return tx.type === historyTransactionTypeFilter;
      })
      .filter((tx) => {
        const hasAttachment = Boolean(tx.attachmentName?.trim());
        if (historyAttachmentFilter === 'with') return hasAttachment;
        if (historyAttachmentFilter === 'without') return !hasAttachment;
        return true;
      })
      .filter((tx) => {
        const txDate = new Date(tx.date);
        if (historyStart && txDate < historyStart) return false;
        if (historyEnd && txDate > historyEnd) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const groupedTransactions = filteredTransactions.reduce((acc, tx) => {
      const parsed = new Date(tx.date);
      const dateKey = Number.isNaN(parsed.getTime())
        ? new Date().toISOString().slice(0, 10)
        : parsed.toISOString().slice(0, 10);
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(tx);
      return acc;
    }, {} as Record<string, Transaction[]>);

    const groupedEntries = Object.entries(groupedTransactions).sort(([a], [b]) => b.localeCompare(a));
    const hasActiveHistoryFilters = Boolean(
      historyStartDate ||
      historyEndDate ||
      historyTransactionTypeFilter !== 'all' ||
      historyAttachmentFilter !== 'all'
    );

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-gray-500 text-sm">Filter by date period, transaction type, and attachment status</p>
        </div>

        <div className="px-4 py-4 space-y-6">
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">Filters</p>
              {hasActiveHistoryFilters && (
                <button
                  onClick={() => {
                    applyHistoryDatePreset('all_time');
                    setHistoryTransactionTypeFilter('all');
                    setHistoryAttachmentFilter('all');
                  }}
                  className="text-xs font-semibold text-green-600 hover:text-green-700"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick Period</span>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'this_month' as const, label: 'This month' },
                  { id: 'last_month' as const, label: 'Last month' },
                  { id: 'last_90_days' as const, label: 'Last 90 days' },
                  { id: 'all_time' as const, label: 'All time' }
                ]).map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyHistoryDatePreset(preset.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      historyDatePreset === preset.id
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                {historyDatePreset === 'custom' && (
                  <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700">
                    Custom
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(event) => {
                    setHistoryStartDate(event.target.value);
                    setHistoryDatePreset('custom');
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(event) => {
                    setHistoryEndDate(event.target.value);
                    setHistoryDatePreset('custom');
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Transaction Type</span>
                <select
                  value={historyTransactionTypeFilter}
                  onChange={(event) => setHistoryTransactionTypeFilter(event.target.value as 'all' | 'revenue' | 'expense')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="revenue">Revenue only</option>
                  <option value="expense">Expense only</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Attachment</span>
                <select
                  value={historyAttachmentFilter}
                  onChange={(event) => setHistoryAttachmentFilter(event.target.value as 'all' | 'with' | 'without')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="with">With attachment</option>
                  <option value="without">Without attachment</option>
                </select>
              </label>
            </div>

            <p className="text-xs text-gray-500">
              Showing {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? '' : 's'}.
            </p>
          </div>

          {groupedEntries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm font-semibold text-gray-900">No transactions match your filters.</p>
              <p className="mt-1 text-sm text-gray-500">Try widening the date range or changing the filter options.</p>
            </div>
          ) : (
            groupedEntries.map(([dateKey, txs]) => (
              <div key={dateKey}>
                <h3 className="text-sm font-medium text-gray-500 mb-3">{formatDate(new Date(dateKey))}</h3>
                <div className="space-y-2">
                  {txs.map((tx) => (
                    <div
                      key={tx.id}
                      className="bg-white rounded-xl p-4 flex items-center justify-between shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          tx.type === 'revenue' ? 'bg-green-100' : 'bg-red-100'
                        }`}>
                          {tx.type === 'revenue' ? (
                            <TrendingUpIcon className="text-green-500" size={18} />
                          ) : (
                            <TrendingDownIcon className="text-red-500" size={18} />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 capitalize">{tx.category || tx.type}</p>
                          {tx.notes && <p className="text-sm text-gray-500">{tx.notes}</p>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className={`font-semibold ${
                          tx.type === 'revenue' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {tx.type === 'revenue' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </p>
                        <button
                          onClick={() => openTransactionAttachment(tx)}
                          className="text-xs font-semibold text-green-600 hover:text-green-700"
                        >
                          {tx.attachmentName ? 'View attachment' : 'Attach document'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  if (view === 'admin') {
    const refreshAdmin = async () => {
      if (!isSuperAdmin) return;
      setAdminError(null);
      const [analytics, provider, payment] = await Promise.all([
        adminAnalyticsQuery.refetch(),
        adminProviderQuery.refetch(),
        adminPaymentSettingsQuery.refetch()
      ]);
      if (analytics.error || provider.error || payment.error) {
        console.error('Unable to refresh admin analytics', analytics.error ?? provider.error ?? payment.error);
        setAdminError('Unable to refresh admin data.');
      }
    };

    const handleProviderUpdate = async (provider: WhatsAppProvider) => {
      setAdminError(null);
      try {
        await updateAdminProviderMutation.mutateAsync({ provider });
      } catch (error) {
        console.error('Unable to update provider setting', error);
        setAdminError('Unable to update WhatsApp provider.');
      }
    };

    const handleSaveWhatchimpSettings = async () => {
      if (!adminWhatchimpDraft) return;
      setAdminError(null);
      try {
        await updateAdminProviderMutation.mutateAsync({ whatchimp: adminWhatchimpDraft });
      } catch (error) {
        console.error('Unable to update Whatchimp settings', error);
        setAdminError('Unable to update Whatchimp settings.');
      }
    };

    const handleSavePaymentConfig = async () => {
      if (!adminPaymentDraft) return;
      setAdminError(null);
      try {
        await updateAdminPaymentMutation.mutateAsync(adminPaymentDraft);
      } catch (error) {
        console.error('Unable to update payment settings', error);
        setAdminError('Unable to update Paystack settings.');
      }
    };

    if (!isSuperAdmin) {
      return (
        <div className="min-h-screen bg-gray-50 pb-20">
          <div className="bg-white px-4 py-6 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
            <p className="text-sm text-gray-500">Access is restricted to super admin accounts.</p>
          </div>
          <div className="px-4 py-6">
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              You do not have super admin access for this account.
            </div>
          </div>
          <BottomNav />
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
              <p className="text-gray-500 text-sm">Subscriptions, referrals, business mix, and channel settings</p>
            </div>
            <button
              onClick={refreshAdmin}
              className="rounded-full border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          {adminError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {adminError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Total users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.total ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Subscribed users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.subscribed ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Paid users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.paid ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Free users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.free ?? '-'}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Daily subscriptions (last 14 days)</h2>
            <p className="mt-1 text-sm text-gray-500">Successful paid subscriptions and estimated revenue per day.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Total subscriptions</p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {adminAnalytics?.subscriptions.daily.reduce((sum, day) => sum + day.count, 0) ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Revenue</p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {formatCurrencyValue(
                    adminAnalytics?.subscriptions.daily.reduce((sum, day) => sum + day.revenue, 0) ?? 0,
                    adminPaymentDraft?.currencyCode ?? 'GHS'
                  )}
                </p>
              </div>
            </div>
            {adminAnalytics?.subscriptions.daily.length ? (
              <div className="mt-4 space-y-2">
                {adminAnalytics.subscriptions.daily.map((day) => {
                  const peak = Math.max(...adminAnalytics.subscriptions.daily.map((entry) => entry.count), 1);
                  const width = day.count > 0 ? Math.max(8, (day.count / peak) * 100) : 0;
                  return (
                    <div key={day.date}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                        <span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GH', { month: 'short', day: 'numeric' })}</span>
                        <span>{day.count} subs • {formatCurrencyValue(day.revenue, adminPaymentDraft?.currencyCode ?? 'GHS')}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-green-500" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">No subscription trend data yet.</p>
            )}
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">WhatsApp provider</h2>
            <p className="mt-1 text-sm text-gray-500">Global provider used for outbound WhatsApp messages.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {adminProviderInfo?.available.map((provider) => (
                <button
                  key={provider}
                  onClick={() => handleProviderUpdate(provider)}
                  disabled={isAdminSaving}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    adminProviderInfo.provider === provider
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {provider}
                </button>
              ))}
            </div>
            <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">Whatchimp API details</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Base URL</span>
                  <input
                    value={adminWhatchimpDraft?.baseUrl ?? ''}
                    onChange={(event) =>
                      setAdminWhatchimpDraft((prev) => ({
                        baseUrl: event.target.value,
                        apiKey: prev?.apiKey ?? '',
                        senderId: prev?.senderId ?? '',
                        sendPath: prev?.sendPath ?? '/api/messages/whatsapp',
                        authScheme: prev?.authScheme ?? 'Bearer'
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                    placeholder="https://api.whatchimp.com"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">API key</span>
                  <input
                    value={adminWhatchimpDraft?.apiKey ?? ''}
                    onChange={(event) =>
                      setAdminWhatchimpDraft((prev) => ({
                        baseUrl: prev?.baseUrl ?? '',
                        apiKey: event.target.value,
                        senderId: prev?.senderId ?? '',
                        sendPath: prev?.sendPath ?? '/api/messages/whatsapp',
                        authScheme: prev?.authScheme ?? 'Bearer'
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                    placeholder="whatchimp_api_key"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sender ID</span>
                  <input
                    value={adminWhatchimpDraft?.senderId ?? ''}
                    onChange={(event) =>
                      setAdminWhatchimpDraft((prev) => ({
                        baseUrl: prev?.baseUrl ?? '',
                        apiKey: prev?.apiKey ?? '',
                        senderId: event.target.value,
                        sendPath: prev?.sendPath ?? '/api/messages/whatsapp',
                        authScheme: prev?.authScheme ?? 'Bearer'
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                    placeholder="AKONTA"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Send path</span>
                  <input
                    value={adminWhatchimpDraft?.sendPath ?? ''}
                    onChange={(event) =>
                      setAdminWhatchimpDraft((prev) => ({
                        baseUrl: prev?.baseUrl ?? '',
                        apiKey: prev?.apiKey ?? '',
                        senderId: prev?.senderId ?? '',
                        sendPath: event.target.value,
                        authScheme: prev?.authScheme ?? 'Bearer'
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                    placeholder="/api/messages/whatsapp"
                  />
                </label>
              </div>
              <label className="space-y-1 block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Auth scheme</span>
                <select
                  value={adminWhatchimpDraft?.authScheme ?? 'Bearer'}
                  onChange={(event) =>
                    setAdminWhatchimpDraft((prev) => ({
                      baseUrl: prev?.baseUrl ?? '',
                      apiKey: prev?.apiKey ?? '',
                      senderId: prev?.senderId ?? '',
                      sendPath: prev?.sendPath ?? '/api/messages/whatsapp',
                      authScheme: event.target.value
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                >
                  <option value="Bearer">Bearer</option>
                  <option value="App">App</option>
                  <option value="Token">Token</option>
                  <option value="none">none</option>
                </select>
              </label>
              <button
                onClick={handleSaveWhatchimpSettings}
                disabled={isAdminSaving || !adminWhatchimpDraft}
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Save Whatchimp Settings
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Paystack subscription settings</h2>
            <p className="mt-1 text-sm text-gray-500">Used for MoMo/card subscription checkout and webhook verification.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Public key</span>
                <input
                  value={adminPaymentDraft?.paystackPublicKey ?? ''}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: event.target.value,
                      paystackSecretKey: prev?.paystackSecretKey ?? '',
                      paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                      premiumAmount: prev?.premiumAmount ?? 50,
                      currencyCode: prev?.currencyCode ?? 'GHS'
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  placeholder="pk_live_..."
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Secret key</span>
                <input
                  value={adminPaymentDraft?.paystackSecretKey ?? ''}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: prev?.paystackPublicKey ?? '',
                      paystackSecretKey: event.target.value,
                      paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                      premiumAmount: prev?.premiumAmount ?? 50,
                      currencyCode: prev?.currencyCode ?? 'GHS'
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  placeholder="sk_live_..."
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Webhook secret</span>
                <input
                  value={adminPaymentDraft?.paystackWebhookSecret ?? ''}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: prev?.paystackPublicKey ?? '',
                      paystackSecretKey: prev?.paystackSecretKey ?? '',
                      paystackWebhookSecret: event.target.value,
                      premiumAmount: prev?.premiumAmount ?? 50,
                      currencyCode: prev?.currencyCode ?? 'GHS'
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  placeholder="paystack_webhook_secret"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Currency code</span>
                <input
                  value={adminPaymentDraft?.currencyCode ?? 'GHS'}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: prev?.paystackPublicKey ?? '',
                      paystackSecretKey: prev?.paystackSecretKey ?? '',
                      paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                      premiumAmount: prev?.premiumAmount ?? 50,
                      currencyCode: event.target.value.toUpperCase()
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  placeholder="GHS"
                />
              </label>
            </div>
            <label className="mt-3 block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Premium amount (major unit)</span>
              <input
                type="number"
                min="1"
                value={adminPaymentDraft?.premiumAmount ?? 50}
                onChange={(event) =>
                  setAdminPaymentDraft((prev) => ({
                    paystackPublicKey: prev?.paystackPublicKey ?? '',
                    paystackSecretKey: prev?.paystackSecretKey ?? '',
                    paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                    premiumAmount: Number(event.target.value || 50),
                    currencyCode: prev?.currencyCode ?? 'GHS'
                  }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
              />
            </label>
            {adminPaymentSettings && (
              <p className="mt-3 text-xs text-gray-500">
                Current live price: {formatCurrencyValue(adminPaymentSettings.premiumAmount, adminPaymentSettings.currencyCode)} / month
              </p>
            )}
            <button
              onClick={handleSavePaymentConfig}
              disabled={isAdminSaving || !adminPaymentDraft}
              className="mt-4 rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Save Paystack Settings
            </button>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Business type distribution</h2>
            {adminAnalytics?.businessTypes.length ? (
              <div className="space-y-3">
                {adminAnalytics.businessTypes.map((entry) => {
                  const percentage = adminAnalytics.users.total > 0
                    ? (entry.count / adminAnalytics.users.total) * 100
                    : 0;
                  return (
                    <div key={entry.type}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-gray-700">{entry.type}</span>
                        <span className="font-semibold text-gray-900">{entry.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-green-500" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No business profile data yet.</p>
            )}
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Referral performance</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-gray-50 px-3 py-4">
                <p className="text-xs text-gray-500">Qualified</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{adminAnalytics?.referrals.qualifiedConversions ?? '-'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-3 py-4">
                <p className="text-xs text-gray-500">Rewards</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{adminAnalytics?.referrals.rewardsGranted ?? '-'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-3 py-4">
                <p className="text-xs text-gray-500">Free months</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{adminAnalytics?.referrals.freeMonthsGranted ?? '-'}</p>
              </div>
            </div>
          </div>
        </div>

        <BottomNav />
      </div>
    );
  }

  // Settings View
  if (view === 'settings') {
    const currentYear = new Date().getUTCFullYear();
    const currentMonth = new Date().getUTCMonth() + 1;

    const handleSaveBudget = async () => {
      if (!user || !budgetAmount) return;
      setError(null);

      try {
        const saved = await saveBudgetMutation.mutateAsync({
          userId: user.id,
          year: currentYear,
          month: currentMonth,
          targetType: budgetTargetType,
          amount: Number(budgetAmount)
        });
        queryClient.setQueryData<Budget[]>(['budgets', user.id], (previous = []) => {
          const existingIndex = previous.findIndex((budget) => (
            budget.targetType === saved.targetType && budget.periodStart === saved.periodStart
          ));
          if (existingIndex >= 0) {
            const next = [...previous];
            next[existingIndex] = saved;
            return next;
          }
          return [...previous, saved];
        });
      } catch (budgetSaveError) {
        console.error('Unable to save budget', budgetSaveError);
        setError('Unable to save budget. Please try again.');
      }
    };

    const handleSaveCurrency = async () => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      try {
        const updated = await updateUserMutation.mutateAsync({
          id: user.id,
          updates: { currencyCode: settingsCurrencyCode }
        });
        setUser(updated);
        setSettingsNotice('Currency preference saved.');
      } catch (currencyError) {
        console.error('Unable to update currency', currencyError);
        setError('Unable to save currency preference right now.');
      }
    };

    const handleStartPremiumCheckout = async () => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      try {
        const callbackUrl = `${window.location.origin}${window.location.pathname}`;
        const initialized = await initializeSubscriptionMutation.mutateAsync({
          userId: user.id,
          months: 1,
          callbackUrl
        });
        window.location.assign(initialized.authorizationUrl);
      } catch (subscriptionError) {
        console.error('Unable to initialize subscription checkout', subscriptionError);
        setError('Unable to start payment checkout right now.');
      }
    };

    const handleManualPremiumActivation = async () => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      try {
        const updated = await activateSubscriptionMutation.mutateAsync({
          userId: user.id,
          request: {
            status: 'premium',
            source: 'paid',
            months: 1,
            note: 'Manual premium activation'
          }
        });
        setUser(updated);
        await referralProgressQuery.refetch();
        setSettingsNotice('Premium manually activated for this account.');
      } catch (subscriptionError) {
        console.error('Unable to activate subscription', subscriptionError);
        setError('Unable to activate subscription.');
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              <p className="text-gray-500 text-sm">Preferences, referral rewards, and budget targets</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          {settingsNotice && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {settingsNotice}
            </div>
          )}

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Currency preference</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Default currency</label>
                <select
                  value={settingsCurrencyCode}
                  onChange={(event) => setSettingsCurrencyCode(event.target.value as typeof supportedCurrencies[number])}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  {supportedCurrencies.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Preview</p>
                <p className="mt-2 text-xl font-semibold text-gray-900">{formatCurrencyValue(4500, settingsCurrencyCode)}</p>
              </div>
            </div>
            <button
              onClick={handleSaveCurrency}
              disabled={isAnySettingsActionPending}
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {isSavingCurrency ? 'Saving...' : 'Save Currency'}
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Referral rewards</h2>
                <p className="text-sm text-gray-500">Every 3 referral signups unlocks 1 extra month of premium access.</p>
              </div>
              <button
                onClick={refreshReferralData}
                className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                <p className="text-xs text-gray-500">Qualified</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{referralProgress?.qualifiedReferrals ?? '-'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                <p className="text-xs text-gray-500">To next reward</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{referralProgress?.remainingForNextReward ?? '-'}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                <p className="text-xs text-gray-500">Free months</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{referralProgress?.totalRewardMonths ?? '-'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Your referral link</p>
              <p className="mt-2 break-all text-sm text-gray-800">{effectiveReferralLink ?? (isReferralLoading ? 'Loading...' : 'Unavailable')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={copyReferralLink}
                  disabled={!effectiveReferralLink}
                  className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Copy Link
                </button>
                <button
                  onClick={handleStartPremiumCheckout}
                  disabled={isAnySettingsActionPending}
                  className="rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {isStartingCheckout ? 'Redirecting...' : 'Subscribe Now (MoMo/Card)'}
                </button>
                {user?.isSuperAdmin && (
                  <button
                    onClick={handleManualPremiumActivation}
                    disabled={isAnySettingsActionPending}
                    className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isActivatingPremium ? 'Saving...' : 'Manual Premium (Admin)'}
                  </button>
                )}
              </div>
              {referralCopyMessage && <p className="mt-2 text-xs text-green-700">{referralCopyMessage}</p>}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Budget Target</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Budget type</label>
                <select
                  value={budgetTargetType}
                  onChange={(e) => setBudgetTargetType(e.target.value as BudgetTargetType)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  <option value="expense">Expense budget</option>
                  <option value="revenue">Revenue target</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount ({activeCurrencyCode})</label>
                <input
                  type="number"
                  min="0"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              onClick={handleSaveBudget}
              disabled={isAnySettingsActionPending || !budgetAmount}
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {isSavingBudget ? 'Saving...' : 'Save Budget'}
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Current monthly budgets</h2>
            {budgets.length === 0 ? (
              <p className="text-sm text-gray-500">No budget targets set yet for this month.</p>
            ) : (
              <div className="space-y-3">
                {budgets.map((budget) => (
                  <div key={budget.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm text-gray-500 capitalize">{budget.targetType} budget</p>
                    <p className="text-xl font-semibold text-gray-900">{formatCurrency(budget.amount)}</p>
                    {budget.category && <p className="text-sm text-gray-500">Category: {budget.category}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">How budgets work</h2>
            <div className="space-y-3 text-sm text-gray-600">
              <p>Set a monthly expense budget or revenue target and Akonta AI will watch your numbers.</p>
              <p>When you log entries, the chat bot will tell you if you are near or over budget.</p>
            </div>
          </div>

        </div>

        <BottomNav />
      </div>
    );
  }

  return null;
}
