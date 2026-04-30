import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppView,
  AuthSession,
  BusinessCategory,
  BalanceSheetSnapshot,
  BusinessPaymentMethod,
  BusinessSettingsProfile,
  Customer,
  LedgerAccount,
  LedgerJournalEntry,
  PendingTransactionApproval,
  ProductService,
  Supplier,
  User,
  ChatMessage,
  Transaction,
  SummaryPayload,
  WhatsAppProvider,
  Budget,
  BudgetTargetType,
  ReconciliationSession,
  MonthlyInsights,
  AdminPaymentSettings,
  AdminWhatsAppSettings,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceMembershipStatus
} from './types';
import { 
  ChartIcon, HistoryIcon,
  SendIcon, TrendingUpIcon, TrendingDownIcon, HomeIcon, 
  CalendarIcon, ArrowLeftIcon, CheckIcon, ClockIcon, BellIcon, ChatIcon, SettingsIcon
} from './components/Icons';
import { 
  mockTransactions, currentWeekSummary, currentMonthSummary, 
  chatMessages 
} from './data/mockData';
import SalesProfitTrendChart, { type SalesProfitTrendPoint } from './components/SalesProfitTrendChart';
import {
  activateUserSubscription,
  bootstrapBusinessDefaults,
  clearStoredAuthSession,
  createBusinessCategory,
  createCustomer,
  deactivateLedgerAccount,
  createLedgerAccount,
  createManualJournalEntry,
  createProductService,
  createSupplier,
  createUser,
  getBusinessCategories,
  getBusinessSettingsProfile,
  getCustomers,
  getLedgerAccounts,
  getBalanceSheetSnapshot,
  getLedgerJournalEntries,
  getReconciliationSessions,
  getStoredAuthSession,
  getProductsServices,
  getSuppliers,
  getAdminAnalytics,
  getAdminPaymentSettings,
  getAdminWhatsAppProvider,
  getCurrentBudgets,
  getCurrentInsights,
  getMonthlyInsights,
  getMonthlySummary,
  getPendingApprovals,
  getReferralProgress,
  getTelegramProviderStatus,
  getTransactions,
  getUser,
  getWeeklySummary,
  initializeSubscriptionPayment,
  isOfflineSyncError,
  postBudget,
  postChatEntry,
  registerDemoModeListener,
  createReconciliationSession,
  reviewPendingApproval,
  setAdminPaymentSettings,
  setAdminWhatsAppProvider,
  setLegacyUserContext,
  updateLedgerAccount,
  updateUser,
  verifySubscriptionPayment,
  updateBusinessSettingsProfile,
  updateTransaction,
  getWorkspaces,
  getWorkspaceMembers,
  inviteWorkspaceMember,
  logoutSession,
  refreshAuthSession,
  requestOtp,
  selectWorkspace,
  updateWorkspaceMember,
  verifyOtp
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
const PAID_SERVICE_GRACE_DAYS = 5;
const planEquivalentLabel = {
  basic: 'Approx: NGN 1,500 • ZMW 100 • USD 4',
  premium: 'Approx: NGN 5,000 • ZMW 330 • USD 13'
} as const;
const ADMIN_COCKPIT_PATH = '/admin';
const transactionEventOptions = [
  { value: 'cash_sale', label: 'Cash sale' },
  { value: 'momo_sale', label: 'MoMo sale' },
  { value: 'credit_sale', label: 'Credit sale' },
  { value: 'debtor_recovery', label: 'Debtor recovery' },
  { value: 'stock_purchase', label: 'Stock purchase' },
  { value: 'operating_expense', label: 'Operating expense' },
  { value: 'owner_withdrawal', label: 'Owner withdrawal' },
  { value: 'loan_received', label: 'Loan received' },
  { value: 'loan_repayment', label: 'Loan repayment' },
  { value: 'supplier_credit', label: 'Supplier credit' },
  { value: 'capital_introduced', label: 'Capital introduced' },
  { value: 'other', label: 'Other' }
] as const;

const isAdminCockpitPath = (pathname: string): boolean =>
  pathname === ADMIN_COCKPIT_PATH || pathname.startsWith(`${ADMIN_COCKPIT_PATH}/`);

const resolveViewFromPathname = (pathname: string): AppView =>
  isAdminCockpitPath(pathname) ? 'admin' : 'landing';

const hasActivePremiumWindow = (user: User | null): boolean => {
  if (!user) return false;
  if (user.subscriptionStatus === 'free') return false;
  const accessEnd = parseDateValue(user.subscriptionEndsAt ?? user.trialEndsAt ?? null);
  if (!accessEnd) return user.subscriptionStatus === 'basic' || user.subscriptionStatus === 'premium' || user.subscriptionStatus === 'trial';
  if (user.subscriptionStatus === 'trial') {
    return accessEnd.getTime() > Date.now();
  }
  const graceEnd = new Date(accessEnd);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + PAID_SERVICE_GRACE_DAYS);
  return graceEnd.getTime() > Date.now();
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
  },
  completeness: {
    totalRecords: currentWeekSummary.transactionCount,
    assignedSalesCount: 0,
    unassignedSalesCount: 0,
    assignedSalesAmount: 0,
    unassignedSalesAmount: 0,
    productAssignmentRatio: 1,
    lowConfidenceCount: 0,
    mediumConfidenceCount: 0,
    reviewFlaggedCount: 0,
    completenessScore: 1
  }
};

const emptySummaryPayload: SummaryPayload = {
  totalRevenue: 0, totalExpenses: 0, directExpenses: 0, indirectExpenses: 0, nonBusinessExpenses: 0,
  grossProfit: 0, netProfit: 0, profit: 0, transactionCount: 0, categoryBreakdown: {},
  directExpenseBreakdown: {}, indirectExpenseBreakdown: {}, dailyBreakdown: [],
  cashFlow: {
    operatingInflow: 0, operatingOutflow: 0, financingInflow: 0, financingOutflow: 0,
    totalCashInflow: 0, totalCashOutflow: 0, netCashFlow: 0
  },
  completeness: {
    totalRecords: 0,
    assignedSalesCount: 0,
    unassignedSalesCount: 0,
    assignedSalesAmount: 0,
    unassignedSalesAmount: 0,
    productAssignmentRatio: 1,
    lowConfidenceCount: 0,
    mediumConfidenceCount: 0,
    reviewFlaggedCount: 0,
    completenessScore: 1
  }
};

type ChatEntryResult = Awaited<ReturnType<typeof postChatEntry>>;
type PostBudgetPayload = Parameters<typeof postBudget>[0];
type ActivateSubscriptionPayload = Parameters<typeof activateUserSubscription>[1];

const toDateInputValue = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const INSTALL_PROMPT_DISMISS_KEY = 'akontaai-install-dismissed-at';
const INSTALL_PROMPT_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 3;
const walkthroughSeenStorageKey = (userId: string) => `akontaai-walkthrough-seen-${userId}`;

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
  const [view, setView] = useState<AppView>(() => {
    if (typeof window === 'undefined') return 'landing';
    return resolveViewFromPathname(window.location.pathname);
  });
  const [user, setUser] = useState<User | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authPhoneNumber, setAuthPhoneNumber] = useState('');
  const [authOtpCode, setAuthOtpCode] = useState('');
  const [authOtpExpiresAt, setAuthOtpExpiresAt] = useState<string | null>(null);
  const [authDevOtpCode, setAuthDevOtpCode] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState<'request' | 'verify'>('request');
  const [adminLoginRequested, setAdminLoginRequested] = useState(false);
  const [workspaceSelectionId, setWorkspaceSelectionId] = useState<string>('');
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
  const [historyQualityFilter, setHistoryQualityFilter] = useState<'all' | 'flagged' | 'low_confidence' | 'needs_review'>('all');
  const [historyReviewTarget, setHistoryReviewTarget] = useState<Transaction | null>(null);
  const [historyReviewAmount, setHistoryReviewAmount] = useState('');
  const [historyReviewDate, setHistoryReviewDate] = useState('');
  const [historyReviewCategory, setHistoryReviewCategory] = useState('');
  const [historyReviewNotes, setHistoryReviewNotes] = useState('');
  const [historyReviewEventType, setHistoryReviewEventType] = useState<Transaction['eventType']>('other');
  const [focusedJournalEntryId, setFocusedJournalEntryId] = useState<string | null>(null);
  const [reconciliationAsOfDate, setReconciliationAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashActualBalanceInput, setCashActualBalanceInput] = useState('');
  const [cashReconciliationNotes, setCashReconciliationNotes] = useState('');
  const [momoActualBalanceInput, setMomoActualBalanceInput] = useState('');
  const [momoReconciliationNotes, setMomoReconciliationNotes] = useState('');
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [walkthroughStage, setWalkthroughStage] = useState<'idle' | 'awaiting_opt_in' | 'awaiting_channel_help' | 'done'>('idle');
  const [settingsSection, setSettingsSection] = useState<'profile' | 'categories' | 'products' | 'customers' | 'suppliers' | 'ledger' | 'team' | 'advanced'>('profile');
  const [settingsBusinessName, setSettingsBusinessName] = useState('');
  const [settingsBusinessType, setSettingsBusinessType] = useState('');
  const [settingsCurrencyCode, setSettingsCurrencyCode] = useState<'GHS' | 'USD' | 'NGN' | 'KES' | 'EUR' | 'GBP'>('GHS');
  const [settingsTimezone, setSettingsTimezone] = useState('Africa/Accra');
  const [settingsPreferredTime, setSettingsPreferredTime] = useState<'morning' | 'afternoon' | 'evening'>('evening');
  const [settingsPaymentMethods, setSettingsPaymentMethods] = useState<BusinessPaymentMethod[]>(['cash', 'momo']);
  const [teamNotice, setTeamNotice] = useState<string | null>(null);
  const [teamInviteName, setTeamInviteName] = useState('');
  const [teamInvitePhone, setTeamInvitePhone] = useState('');
  const [teamInviteEmail, setTeamInviteEmail] = useState('');
  const [teamInviteRole, setTeamInviteRole] = useState<WorkspaceRole>('cashier');
  const [teamRoleDrafts, setTeamRoleDrafts] = useState<Record<string, WorkspaceRole>>({});
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isOutboxSyncing, setIsOutboxSyncing] = useState(false);
  const [setupCategoryKind, setSetupCategoryKind] = useState<'sales' | 'expense'>('expense');
  const [setupCategoryName, setSetupCategoryName] = useState('');
  const [setupProductName, setSetupProductName] = useState('');
  const [setupProductType, setSetupProductType] = useState<'product' | 'service'>('product');
  const [setupProductCategoryId, setSetupProductCategoryId] = useState<string>('');
  const [setupProductDefaultPrice, setSetupProductDefaultPrice] = useState('');
  const [setupProductEstimatedCost, setSetupProductEstimatedCost] = useState('');
  const [setupCustomerName, setSetupCustomerName] = useState('');
  const [setupCustomerPhone, setSetupCustomerPhone] = useState('');
  const [setupCustomerOpening, setSetupCustomerOpening] = useState('');
  const [setupSupplierName, setSetupSupplierName] = useState('');
  const [setupSupplierPhone, setSetupSupplierPhone] = useState('');
  const [setupSupplierType, setSetupSupplierType] = useState('');
  const [setupSupplierOpening, setSetupSupplierOpening] = useState('');
  const [customLedgerCode, setCustomLedgerCode] = useState('');
  const [customLedgerName, setCustomLedgerName] = useState('');
  const [customLedgerAccountType, setCustomLedgerAccountType] = useState<'asset' | 'liability' | 'equity' | 'income' | 'expense'>('expense');
  const [customLedgerParentId, setCustomLedgerParentId] = useState('');
  const [editingLedgerId, setEditingLedgerId] = useState<string | null>(null);
  const [editingLedgerCode, setEditingLedgerCode] = useState('');
  const [editingLedgerName, setEditingLedgerName] = useState('');
  const [editingLedgerParentId, setEditingLedgerParentId] = useState('');
  const [manualJournalDate, setManualJournalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualJournalDescription, setManualJournalDescription] = useState('');
  const [manualJournalLines, setManualJournalLines] = useState<Array<{
    id: string;
    accountId: string;
    debitAmount: string;
    creditAmount: string;
    memo: string;
  }>>([
    { id: 'line-1', accountId: '', debitAmount: '', creditAmount: '', memo: '' },
    { id: 'line-2', accountId: '', debitAmount: '', creditAmount: '', memo: '' }
  ]);

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
    currencyCode: 'GHS' | 'USD' | 'NGN' | 'KES' | 'EUR' | 'GBP';
    paymentMethods: BusinessPaymentMethod[];
    preferredTime: 'morning' | 'afternoon' | 'evening';
  }>({
    name: '',
    phoneNumber: '',
    businessName: '',
    businessType: '',
    currencyCode: 'GHS',
    paymentMethods: ['cash', 'momo'],
    preferredTime: 'evening'
  });
  const [onboardingReferralCode, setOnboardingReferralCode] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const invalidateUserDataQueries = useCallback((userId: string, options?: { includeBudgets?: boolean }) => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['weekly-summary'] });
    queryClient.invalidateQueries({ queryKey: ['monthly-summary'] });
    queryClient.invalidateQueries({ queryKey: ['current-insights'] });
    queryClient.invalidateQueries({ queryKey: ['referrals', userId] });
    queryClient.invalidateQueries({ queryKey: ['selected-report'] });
    queryClient.invalidateQueries({ queryKey: ['settings-journal-entries'] });
    queryClient.invalidateQueries({ queryKey: ['settings-balance-sheet'] });
    if (options?.includeBudgets) {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    }
  }, [queryClient]);

  const postChatEntryMutation = useMutation({
    mutationFn: (payload: { userId: string; message: string; channel: 'web' | 'whatsapp' | 'telegram' }) =>
      postChatEntry(payload.userId, payload.message, payload.channel)
  });

  const saveBudgetMutation = useMutation({
    mutationFn: (payload: PostBudgetPayload) => postBudget(payload),
    onSuccess: (_savedBudget, payload) => {
      invalidateUserDataQueries(payload.userId, { includeBudgets: true });
    }
  });

  const reviewTransactionMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      updates: {
        type?: 'revenue' | 'expense';
        eventType?: Transaction['eventType'];
        amount?: number;
        date?: string;
        category?: string | null;
        notes?: string | null;
        requiresReview?: boolean;
        correctionReason?: string | null;
      };
    }) => updateTransaction(payload.id, payload.updates)
  });

  const createUserMutation = useMutation({
    mutationFn: (payload: Partial<User>) => createUser(payload)
  });

  const requestOtpMutation = useMutation({
    mutationFn: (phoneNumber: string) => requestOtp(phoneNumber)
  });

  const verifyOtpMutation = useMutation({
    mutationFn: (payload: { phoneNumber: string; code: string; businessId?: string }) => verifyOtp(payload)
  });

  const selectWorkspaceMutation = useMutation({
    mutationFn: (businessId: string) => selectWorkspace(businessId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['workspace-memberships', user?.id] });
      if (user?.id) {
        invalidateUserDataQueries(user.id, { includeBudgets: true });
      }
    }
  });

  const logoutMutation = useMutation({
    mutationFn: () => logoutSession()
  });

  const initializeSubscriptionMutation = useMutation({
    mutationFn: (payload: {
      userId: string;
      plan?: 'basic' | 'premium';
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
  const isRequestingOtp = requestOtpMutation.isPending;
  const isVerifyingOtp = verifyOtpMutation.isPending;
  const isSwitchingWorkspace = selectWorkspaceMutation.isPending;
  const isLoggingOut = logoutMutation.isPending;
  const isSavingBudget = saveBudgetMutation.isPending;
  const isStartingCheckout = initializeSubscriptionMutation.isPending;
  const isActivatingPremium = activateSubscriptionMutation.isPending;

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
    queryKey: ['transactions', authSession?.businessId, user?.id],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getTransactions(user!.id)
  });

  const weeklySummaryQuery = useQuery({
    queryKey: ['weekly-summary', authSession?.businessId, user?.id, currentPeriodContext.weekStart, currentPeriodContext.weekEnd],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getWeeklySummary(user!.id, currentPeriodContext.weekStart, currentPeriodContext.weekEnd)
  });

  const monthlySummaryQuery = useQuery({
    queryKey: ['monthly-summary', authSession?.businessId, user?.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getMonthlySummary(user!.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth)
  });

  const currentInsightsQuery = useQuery({
    queryKey: ['current-insights', authSession?.businessId, user?.id, currentPeriodContext.currentYear, currentPeriodContext.currentMonth],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getCurrentInsights(user!.id)
  });

  const referralProgressQuery = useQuery({
    queryKey: ['referrals', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getReferralProgress(user!.id)
  });

  const budgetsQuery = useQuery({
    queryKey: ['budgets', authSession?.businessId, user?.id],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getCurrentBudgets(user!.id)
  });

  const selectedReportDataQuery = useQuery({
    queryKey: ['selected-report', authSession?.businessId, user?.id, selectedReportYear, selectedReportMonth],
    enabled: Boolean(user?.id && authSession?.businessId) && reportMode === 'monthly',
    queryFn: async () => {
      const [monthly, insights] = await Promise.all([
        getMonthlySummary(user!.id, selectedReportYear, selectedReportMonth),
        getMonthlyInsights(user!.id, selectedReportYear, selectedReportMonth)
      ]);
      return { monthly, insights };
    }
  });

  const workspaceMembershipsQuery = useQuery({
    queryKey: ['workspace-memberships', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getWorkspaces()
  });

  const workspaceMembersQuery = useQuery({
    queryKey: ['workspace-members', user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => getWorkspaceMembers()
  });

  const telegramStatusQuery = useQuery({
    queryKey: ['telegram-status', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const [provider, latestUser] = await Promise.all([
        getTelegramProviderStatus(),
        getUser(user!.id)
      ]);
      return {
        ...provider,
        telegramChatId: latestUser.telegramChatId ?? null,
        telegramUsername: latestUser.telegramUsername ?? null
      };
    },
    refetchOnWindowFocus: false
  });

  const settingsProfileQuery = useQuery({
    queryKey: ['settings-profile', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getBusinessSettingsProfile()
  });

  const settingsCategoriesQuery = useQuery({
    queryKey: ['settings-categories', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getBusinessCategories()
  });

  const settingsProductsQuery = useQuery({
    queryKey: ['settings-products-services', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getProductsServices()
  });

  const settingsCustomersQuery = useQuery({
    queryKey: ['settings-customers', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getCustomers()
  });

  const settingsSuppliersQuery = useQuery({
    queryKey: ['settings-suppliers', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getSuppliers()
  });

  const settingsLedgerAccountsQuery = useQuery({
    queryKey: ['settings-ledger-accounts', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getLedgerAccounts()
  });

  const settingsJournalEntriesQuery = useQuery({
    queryKey: ['settings-journal-entries', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getLedgerJournalEntries()
  });

  const settingsBalanceSheetQuery = useQuery({
    queryKey: ['settings-balance-sheet', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getBalanceSheetSnapshot()
  });

  const reconciliationSessionsQuery = useQuery({
    queryKey: ['settings-reconciliation-sessions', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId),
    queryFn: () => getReconciliationSessions({ limit: 8 })
  });

  const canReviewApprovals = ['owner', 'manager', 'bookkeeper', 'accountant'].includes(
    workspaceMembershipsQuery.data?.find((membership) => membership.status === 'active')?.role ?? ''
  );

  const pendingApprovalsQuery = useQuery({
    queryKey: ['pending-approvals', authSession?.businessId],
    enabled: Boolean(user?.id && authSession?.businessId && canReviewApprovals),
    queryFn: () => getPendingApprovals(),
    refetchOnWindowFocus: true
  });

  const inviteWorkspaceMemberMutation = useMutation({
    mutationFn: (payload: {
      fullName: string;
      phoneNumber?: string;
      email?: string;
      role: WorkspaceRole;
    }) => inviteWorkspaceMember(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['workspace-memberships', user?.id] });
    }
  });

  const updateWorkspaceMemberMutation = useMutation({
    mutationFn: (payload: {
      membershipId: string;
      updates: { role?: WorkspaceRole; status?: WorkspaceMembershipStatus };
    }) => updateWorkspaceMember(payload.membershipId, payload.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['workspace-memberships', user?.id] });
    }
  });

  const updateBusinessProfileMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateBusinessSettingsProfile>[0]) => updateBusinessSettingsProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const updateUserProfileMutation = useMutation({
    mutationFn: (payload: { userId: string; updates: Parameters<typeof updateUser>[1] }) =>
      updateUser(payload.userId, payload.updates)
  });

  const bootstrapDefaultsMutation = useMutation({
    mutationFn: () => bootstrapBusinessDefaults(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-categories', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-ledger-accounts', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-journal-entries', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-balance-sheet', authSession?.businessId] });
    }
  });

  const createCategoryMutation = useMutation({
    mutationFn: (payload: { kind: 'sales' | 'expense'; name: string }) => createBusinessCategory(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-categories', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const createProductMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      type: 'product' | 'service';
      defaultPrice?: number | null;
      estimatedCost?: number | null;
      categoryId?: string | null;
    }) => createProductService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-products-services', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const createCustomerMutation = useMutation({
    mutationFn: (payload: { name: string; phoneNumber?: string | null; openingReceivable?: number | null }) =>
      createCustomer(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-customers', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const createSupplierMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      phoneNumber?: string | null;
      supplyType?: string | null;
      openingPayable?: number | null;
    }) => createSupplier(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-suppliers', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const createLedgerAccountMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
      parentId?: string | null;
    }) => createLedgerAccount(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-ledger-accounts', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-profile', authSession?.businessId] });
    }
  });

  const updateLedgerAccountMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      updates: { code?: string; name?: string; parentId?: string | null; isActive?: boolean };
    }) => updateLedgerAccount(payload.id, payload.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-ledger-accounts', authSession?.businessId] });
    }
  });

  const deactivateLedgerAccountMutation = useMutation({
    mutationFn: (ledgerId: string) => deactivateLedgerAccount(ledgerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-ledger-accounts', authSession?.businessId] });
    }
  });

  const createManualJournalEntryMutation = useMutation({
    mutationFn: (payload: {
      entryDate?: string;
      description?: string | null;
      lines: Array<{ accountId: string; debitAmount?: number; creditAmount?: number; memo?: string | null }>;
    }) => createManualJournalEntry(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-journal-entries', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-balance-sheet', authSession?.businessId] });
    }
  });

  const createReconciliationSessionMutation = useMutation({
    mutationFn: (payload: {
      channel: 'cash' | 'momo';
      asOf?: string;
      bookBalance: number;
      countedBalance: number;
      notes?: string | null;
    }) => createReconciliationSession(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-reconciliation-sessions', authSession?.businessId] });
    }
  });

  const reviewPendingApprovalMutation = useMutation({
    mutationFn: (payload: { approvalId: string; action: 'approve' | 'reject'; note?: string }) =>
      reviewPendingApproval(payload.approvalId, { action: payload.action, note: payload.note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', authSession?.businessId, user?.id] });
      queryClient.invalidateQueries({ queryKey: ['settings-journal-entries', authSession?.businessId] });
      queryClient.invalidateQueries({ queryKey: ['settings-balance-sheet', authSession?.businessId] });
      if (user?.id) {
        invalidateUserDataQueries(user.id, { includeBudgets: true });
      }
    }
  });

  const isAnySettingsActionPending =
    isSavingBudget
    || isStartingCheckout
    || isActivatingPremium
    || updateBusinessProfileMutation.isPending
    || updateUserProfileMutation.isPending
    || bootstrapDefaultsMutation.isPending
    || createCategoryMutation.isPending
    || createProductMutation.isPending
    || createCustomerMutation.isPending
    || createSupplierMutation.isPending
    || createLedgerAccountMutation.isPending
    || updateLedgerAccountMutation.isPending
    || deactivateLedgerAccountMutation.isPending
    || createManualJournalEntryMutation.isPending
    || createReconciliationSessionMutation.isPending
    || reviewPendingApprovalMutation.isPending
    || reviewTransactionMutation.isPending;

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
  const workspaceMemberships = workspaceMembershipsQuery.data ?? [];
  const workspaceMembers = workspaceMembersQuery.data ?? [];
  const telegramStatus = telegramStatusQuery.data ?? null;
  const settingsProfile = settingsProfileQuery.data ?? null;
  const settingsCategories = settingsCategoriesQuery.data ?? [];
  const settingsProducts = settingsProductsQuery.data ?? [];
  const settingsCustomers = settingsCustomersQuery.data ?? [];
  const settingsSuppliers = settingsSuppliersQuery.data ?? [];
  const settingsLedgerAccounts = settingsLedgerAccountsQuery.data ?? [];
  const settingsJournalEntries = settingsJournalEntriesQuery.data ?? [];
  const settingsBalanceSheet = settingsBalanceSheetQuery.data ?? null;
  const reconciliationSessions = reconciliationSessionsQuery.data ?? [];
  const pendingApprovals = pendingApprovalsQuery.data ?? [];
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
  const activeWorkspaceMembership = workspaceMemberships.find((membership) => membership.status === 'active') ?? null;
  const pendingApprovalCount = pendingApprovals.length;
  const isWorkspacePremiumPlan = user?.subscriptionStatus === 'premium';
  const canManageWorkspaceMembers = activeWorkspaceMembership?.role === 'owner' && isWorkspacePremiumPlan;
  const hasPaidChannelAccess = user?.subscriptionStatus === 'basic' || user?.subscriptionStatus === 'premium';
  const ledgerAccountTypeLabels: Record<LedgerAccount['accountType'], string> = {
    asset: 'Assets',
    liability: 'Liabilities',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expenses'
  };
  const groupedLedgerAccounts = (['asset', 'liability', 'equity', 'income', 'expense'] as const)
    .map((accountType) => ({
      accountType,
      label: ledgerAccountTypeLabels[accountType],
      accounts: settingsLedgerAccounts.filter((entry) => entry.accountType === accountType)
    }))
    .filter((group) => group.accounts.length > 0);
  const customLedgerParentCandidates = settingsLedgerAccounts.filter(
    (entry) => entry.isActive && entry.accountType === customLedgerAccountType
  );
  const editingLedger = settingsLedgerAccounts.find((entry) => entry.id === editingLedgerId) ?? null;
  const editingLedgerParentCandidates = editingLedger
    ? settingsLedgerAccounts.filter(
      (entry) => entry.isActive && entry.accountType === editingLedger.accountType && entry.id !== editingLedger.id
    )
    : [];
  const manualJournalDebitTotal = manualJournalLines.reduce(
    (total, line) => total + Number(line.debitAmount || 0),
    0
  );
  const manualJournalCreditTotal = manualJournalLines.reduce(
    (total, line) => total + Number(line.creditAmount || 0),
    0
  );
  const ledgerDiagnosticTransactions = transactions
    .filter((tx) => tx.ledgerPostingStatus && tx.ledgerPostingStatus !== 'posted')
    .slice(0, 12);
  const ledgerDiagnosticCounts = {
    notConfigured: transactions.filter((tx) => tx.ledgerPostingStatus === 'not_configured').length,
    failed: transactions.filter((tx) => tx.ledgerPostingStatus === 'failed').length,
    skipped: transactions.filter((tx) => tx.ledgerPostingStatus === 'skipped').length,
    pending: transactions.filter((tx) => tx.ledgerPostingStatus === 'pending').length,
    needsReview: settingsJournalEntries.filter((entry) => entry.status === 'needs_review').length
  };
  const formatJournalLine = (line: LedgerJournalEntry['lines'][number]) => (
    `${line.account.code} ${line.account.name}: Dr ${formatCurrency(line.debitAmount)} / Cr ${formatCurrency(line.creditAmount)}`
  );
  const describeLedgerDiagnostic = (transaction: Transaction): string => {
    switch (transaction.ledgerPostingStatus) {
      case 'not_configured':
        return 'Posting could not run because required ledger accounts are missing for this workspace.';
      case 'failed':
        return 'Posting failed and should be reviewed by an owner or bookkeeper.';
      case 'skipped':
        return transaction.status === 'draft'
          ? 'Draft transactions are intentionally not posted until they are confirmed.'
          : 'This transaction is currently excluded from ledger posting.';
      case 'pending':
        return 'Posting is still pending and should complete after the transaction update finishes.';
      default:
        return 'This transaction needs accounting attention.';
    }
  };
  const ledgerDiagnosticTone = (status?: Transaction['ledgerPostingStatus']) => {
    if (status === 'failed') return 'bg-rose-100 text-rose-700';
    if (status === 'not_configured') return 'bg-amber-100 text-amber-700';
    if (status === 'pending') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-200 text-gray-700';
  };
  const cashBookBalance = settingsBalanceSheet?.assets.lines.find((line) => line.code === '1000')?.balance ?? 0;
  const momoBookBalance = settingsBalanceSheet?.assets.lines.find((line) => line.code === '1010')?.balance ?? 0;
  const parsedCashActualBalance = cashActualBalanceInput.trim() === '' ? null : Number(cashActualBalanceInput);
  const parsedMomoActualBalance = momoActualBalanceInput.trim() === '' ? null : Number(momoActualBalanceInput);
  const cashVariance = parsedCashActualBalance === null || Number.isNaN(parsedCashActualBalance)
    ? null
    : Math.round((parsedCashActualBalance - cashBookBalance) * 100) / 100;
  const momoVariance = parsedMomoActualBalance === null || Number.isNaN(parsedMomoActualBalance)
    ? null
    : Math.round((parsedMomoActualBalance - momoBookBalance) * 100) / 100;
  const recentCashTransactions = transactions
    .filter((tx) => ['cash_sale', 'debtor_recovery', 'operating_expense', 'owner_withdrawal', 'loan_received', 'loan_repayment', 'stock_purchase', 'capital_introduced'].includes(tx.eventType ?? 'other'))
    .slice(0, 5);
  const recentMomoTransactions = transactions
    .filter((tx) => tx.eventType === 'momo_sale')
    .slice(0, 5);
  const recentCashReconciliationSessions = reconciliationSessions.filter((entry) => entry.channel === 'cash').slice(0, 4);
  const recentMomoReconciliationSessions = reconciliationSessions.filter((entry) => entry.channel === 'momo').slice(0, 4);
  const varianceTone = (variance: number | null) => {
    if (variance === null) return 'bg-gray-100 text-gray-700';
    if (variance === 0) return 'bg-emerald-100 text-emerald-700';
    if (variance > 0) return 'bg-blue-100 text-blue-700';
    return 'bg-rose-100 text-rose-700';
  };
  const varianceLabel = (variance: number | null) => {
    if (variance === null) return 'Awaiting actual balance';
    if (variance === 0) return 'Balanced';
    if (variance > 0) return `Over by ${formatCurrency(Math.abs(variance))}`;
    return `Short by ${formatCurrency(Math.abs(variance))}`;
  };
  const saveReconciliationSession = useCallback(async (channel: 'cash' | 'momo') => {
    const countedValue = channel === 'cash' ? parsedCashActualBalance : parsedMomoActualBalance;
    const bookValue = channel === 'cash' ? cashBookBalance : momoBookBalance;
    const notesValue = channel === 'cash' ? cashReconciliationNotes : momoReconciliationNotes;

    if (countedValue === null || Number.isNaN(countedValue)) {
      setError(`Enter the actual ${channel === 'cash' ? 'cash counted' : 'wallet balance'} before saving.`);
      return;
    }

    setError(null);
    setSettingsNotice(null);

    try {
      await createReconciliationSessionMutation.mutateAsync({
        channel,
        asOf: `${reconciliationAsOfDate}T23:59:59.999Z`,
        bookBalance: bookValue,
        countedBalance: countedValue,
        notes: notesValue.trim() || null
      });
      setSettingsNotice(`${channel === 'cash' ? 'Cash' : 'MoMo'} reconciliation saved.`);
    } catch (saveError) {
      console.error('Unable to save reconciliation session', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save reconciliation session right now.');
    }
  }, [
    cashBookBalance,
    cashReconciliationNotes,
    createReconciliationSessionMutation,
    momoBookBalance,
    momoReconciliationNotes,
    parsedCashActualBalance,
    parsedMomoActualBalance,
    reconciliationAsOfDate
  ]);
  const renderBalanceSheetSection = (label: string, section: BalanceSheetSnapshot['assets']) => (
    <div className="rounded-2xl border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{label}</h4>
        <span className="text-sm font-bold text-gray-900">{formatCurrency(section.total)}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {section.lines.length === 0 ? (
          <div className="px-4 py-3 text-sm text-gray-500">No balances yet.</div>
        ) : (
          section.lines.map((line) => (
            <div key={line.accountId} className="grid gap-2 px-4 py-3 sm:grid-cols-[100px_1fr_auto] sm:items-center">
              <p className="text-sm font-semibold text-gray-900">{line.code}</p>
              <p className="text-sm text-gray-700">{line.name}</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(line.balance)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderBalanceSheetSnapshotCard = () => (
    <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Balance Sheet Snapshot</h3>
          <p className="text-sm text-gray-500">Ledger-based position as of {settingsBalanceSheet ? formatDate(new Date(settingsBalanceSheet.asOf)) : 'today'}.</p>
        </div>
        <button
          onClick={() => void settingsBalanceSheetQuery.refetch()}
          disabled={settingsBalanceSheetQuery.isFetching}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {settingsBalanceSheetQuery.isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {settingsBalanceSheetQuery.isLoading ? (
        <p className="text-sm text-gray-500">Loading balance sheet...</p>
      ) : settingsBalanceSheetQuery.isError || !settingsBalanceSheet ? (
        <p className="text-sm text-red-600">Unable to load balance sheet right now.</p>
      ) : (
        <div className="space-y-4">
          {renderBalanceSheetSection('Assets', settingsBalanceSheet.assets)}
          {renderBalanceSheetSection('Liabilities', settingsBalanceSheet.liabilities)}
          {renderBalanceSheetSection('Equity', settingsBalanceSheet.equity)}

          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
              <span>Current earnings</span>
              <span>{formatCurrency(settingsBalanceSheet.currentEarnings.balance)}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Current period earnings remain separate until formal closing/retained earnings is introduced.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-900 bg-gray-50 px-4 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
              <span>Total Assets</span>
              <span>{formatCurrency(settingsBalanceSheet.totals.assets)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm font-semibold text-gray-900">
              <span>Total Liabilities + Equity</span>
              <span>{formatCurrency(settingsBalanceSheet.totals.liabilitiesAndEquity)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const ApprovalBellButton = ({ solid = false }: { solid?: boolean }) => (
    <button
      onClick={() => setView('approvals')}
      className={`relative ${solid ? 'w-10 h-10 bg-white/20 rounded-full flex items-center justify-center' : 'p-2'}`}
      aria-label="Approval notifications"
    >
      <BellIcon className="text-white" size={20} />
      {canReviewApprovals && pendingApprovalCount > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-green-950">
          {pendingApprovalCount > 9 ? '9+' : pendingApprovalCount}
        </span>
      )}
    </button>
  );

  const activeWeeklySummary = weeklySummary ?? (user ? emptySummaryPayload : defaultWeeklySummary);
  const activeMonthlySummary = monthlySummary ?? (user ? emptySummaryPayload : {
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
    },
    completeness: {
      totalRecords: currentMonthSummary.transactionCount,
      assignedSalesCount: 0,
      unassignedSalesCount: 0,
      assignedSalesAmount: 0,
      unassignedSalesAmount: 0,
      productAssignmentRatio: 1,
      lowConfidenceCount: 0,
      mediumConfidenceCount: 0,
      reviewFlaggedCount: 0,
      completenessScore: 1
    }
  });
  const isOverviewLoading = Boolean(user) && (
    transactionsQuery.isLoading
    || weeklySummaryQuery.isLoading
    || monthlySummaryQuery.isLoading
    || currentInsightsQuery.isLoading
  );
  const overviewLoadError = [transactionsQuery.error, weeklySummaryQuery.error, monthlySummaryQuery.error, currentInsightsQuery.error]
    .find(Boolean);

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

  const handleApprovalReview = useCallback(async (
    approval: PendingTransactionApproval,
    action: 'approve' | 'reject'
  ) => {
    setError(null);
    try {
      await reviewPendingApprovalMutation.mutateAsync({ approvalId: approval.id, action });
    } catch (reviewError) {
      console.error('Unable to review approval request', reviewError);
      setError(reviewError instanceof Error ? reviewError.message : 'Unable to review approval right now.');
    }
  }, [reviewPendingApprovalMutation]);

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

  const appendBotMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'bot',
        content,
        timestamp: new Date()
      }
    ]);
  }, []);

  const markWalkthroughSeen = useCallback((userId: string) => {
    try {
      window.localStorage.setItem(walkthroughSeenStorageKey(userId), '1');
    } catch {
      // best-effort only
    }
  }, []);

  const isProfitIntent = (message: string): { period: 'last_week' | 'last_month' } | null => {
    const normalized = message.toLowerCase();
    if (!normalized.includes('profit')) return null;
    if (normalized.includes('last week') || normalized.includes('week')) {
      return { period: 'last_week' };
    }
    if (normalized.includes('last month') || normalized.includes('month')) {
      return { period: 'last_month' };
    }
    return null;
  };

  const buildProfitSummaryReply = (period: 'last_week' | 'last_month'): string => {
    const summary = period === 'last_week' ? activeWeeklySummary : activeMonthlySummary;
    const label = period === 'last_week' ? 'last week' : 'last month';
    const inflow = summary.totalRevenue ?? 0;
    const outflow = summary.totalExpenses ?? 0;
    const profit = inflow - outflow;
    const trend = profit >= 0 ? 'profit' : 'loss';
    return [
      `Here is your ${label} summary:`,
      `Inflow: ${formatCurrency(inflow)}`,
      `Outflow: ${formatCurrency(outflow)}`,
      `Profit: ${formatCurrency(profit)} (${trend})`,
      '',
      'Formula: Inflow - Outflow = Profit'
    ].join('\n');
  };

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

    const normalizedMessage = message.trim().toLowerCase();
    const yesIntent = ['yes', 'y', 'okay', 'ok', 'sure'].includes(normalizedMessage);
    const noIntent = ['no', 'n', 'later', 'not now'].includes(normalizedMessage);
    const walkthroughIntent = normalizedMessage === 'walkthrough' || normalizedMessage === 'help me start';

    if (walkthroughStage === 'awaiting_opt_in') {
      if (yesIntent) {
        appendBotMessage([
          'Great. Quick tips to use Akonta smoothly:',
          '1. To record money in: start with "Inflow ..." (example: Inflow 1200 cash sale).',
          '2. To record money out: start with "Outflow ..." (example: Outflow 300 transport).',
          '3. To get performance quickly: ask "how much profit did we make last week" or "last month".',
          '',
          'Do you need help setting up Telegram or WhatsApp now? Reply YES or NO.'
        ].join('\n'));
        setWalkthroughStage('awaiting_channel_help');
      } else if (noIntent) {
        appendBotMessage('No problem. You can type "walkthrough" anytime and I will guide you step by step.');
        setWalkthroughStage('done');
        markWalkthroughSeen(user.id);
      } else {
        appendBotMessage('Reply YES to start the quick walkthrough, or NO to skip for now.');
      }
      return;
    }

    if (walkthroughStage === 'awaiting_channel_help') {
      if (yesIntent || normalizedMessage.includes('telegram') || normalizedMessage.includes('whatsapp')) {
        const telegramCommand = user.phoneNumber ? `/link ${user.phoneNumber}` : '/link +233XXXXXXXXX';
        appendBotMessage([
          'Setup directions:',
          `1. Telegram: open Settings > Advanced > copy this command and send it to Akonta bot: ${telegramCommand}`,
          '2. WhatsApp: available on paid plans (Basic/Premium). Go to Settings > Referral rewards and choose your upgrade.',
          '',
          'After setup, send a test message: "Inflow 100 cash sale".'
        ].join('\n'));
        setWalkthroughStage('done');
        markWalkthroughSeen(user.id);
      } else if (noIntent) {
        appendBotMessage('Alright. You can open Settings > Advanced any time for Telegram/WhatsApp setup guidance.');
        setWalkthroughStage('done');
        markWalkthroughSeen(user.id);
      } else {
        appendBotMessage('Reply YES if you want channel setup help now, or NO to continue without it.');
      }
      return;
    }

    if (walkthroughIntent) {
      appendBotMessage([
        'Quick walkthrough:',
        'Use keyword "Inflow" for money coming in and "Outflow" for payments you make.',
        'Example: "Inflow 490 cash sale" or "Outflow 200 water".',
        'For reports, ask: "how much profit did we make last week/month".'
      ].join('\n'));
      setWalkthroughStage('awaiting_channel_help');
      return;
    }

    const profitIntent = isProfitIntent(message);
    if (profitIntent) {
      appendBotMessage(buildProfitSummaryReply(profitIntent.period));
      return;
    }

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
  }, [
    activeMonthlySummary,
    activeWeeklySummary,
    appendBotMessage,
    applyChatEntryResult,
    formatCurrency,
    markWalkthroughSeen,
    postChatEntryMutation,
    refreshPendingSyncCount,
    user,
    walkthroughStage
  ]);

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

  const resolvePostLoginView = useCallback((nextUser: User | null): AppView => {
    if (adminLoginRequested) {
      return 'admin';
    }
    if (typeof window !== 'undefined' && isAdminCockpitPath(window.location.pathname)) {
      return 'admin';
    }
    return 'chat';
  }, [adminLoginRequested]);

  useEffect(() => {
    if (view !== 'auth' && view !== 'admin' && adminLoginRequested) {
      setAdminLoginRequested(false);
    }
  }, [adminLoginRequested, view]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const currentPath = window.location.pathname;
    const onAdminPath = isAdminCockpitPath(currentPath);
    if (view === 'admin' && !onAdminPath) {
      window.history.replaceState({}, '', ADMIN_COCKPIT_PATH);
      return;
    }

    if (view !== 'admin' && onAdminPath) {
      window.history.replaceState({}, '', '/');
    }
  }, [view]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      const resolved = resolveViewFromPathname(window.location.pathname);
      setView((previous) => (previous === resolved ? previous : resolved));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referral = params.get('ref');
    if (referral && referral.trim()) {
      setOnboardingReferralCode(referral.trim());
      setView('onboarding');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      const savedUser = window.localStorage.getItem('akontaai-user');
      const storedSession = getStoredAuthSession();

      if (storedSession) {
        setAuthSession(storedSession);
      }

      if (!savedUser) return;

      try {
        const parsedUser = JSON.parse(savedUser) as User;
        if (storedSession) {
          const refreshed = await refreshAuthSession();
          if (!refreshed) {
            clearStoredAuthSession();
            if (!cancelled) {
              setAuthSession(null);
            }
            return;
          }

          if (!cancelled) {
            setAuthSession(getStoredAuthSession());
            setUser(parsedUser);
            setView(resolvePostLoginView(parsedUser));
          }
          return;
        }

        // Legacy fallback for dev mode while OTP auth is rolling out.
        if (!cancelled) {
          setLegacyUserContext(parsedUser.id);
          setUser(parsedUser);
          setView(resolvePostLoginView(parsedUser));
        }
      } catch (error) {
        console.error('Failed to restore user from storage', error);
      }
    };

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [resolvePostLoginView]);

  useEffect(() => {
    if (user) {
      window.localStorage.setItem('akontaai-user', JSON.stringify(user));
    } else {
      window.localStorage.removeItem('akontaai-user');
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setWalkthroughStage('idle');
      return;
    }
    setWalkthroughStage('idle');
  }, [user?.id]);

  useEffect(() => {
    if (!authSession) {
      setLegacyUserContext(user?.id ?? null);
    }
  }, [authSession, user?.id]);

  useEffect(() => {
    if (!workspaceMembers.length) return;
    setTeamRoleDrafts((previous) => {
      const next = { ...previous };
      workspaceMembers.forEach((member) => {
        if (!next[member.membershipId]) {
          next[member.membershipId] = member.role;
        }
      });
      return next;
    });
  }, [workspaceMembers]);

  useEffect(() => {
    if (workspaceMemberships.length === 0) return;
    const active = workspaceMemberships.find((membership) => membership.status === 'active');
    if (active) {
      setWorkspaceSelectionId(active.businessId);
      return;
    }
    if (!workspaceSelectionId) {
      setWorkspaceSelectionId(workspaceMemberships[0].businessId);
    }
  }, [workspaceMemberships, workspaceSelectionId]);

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
    if (!settingsProfile) return;
    setSettingsBusinessName(settingsProfile.businessName ?? '');
    setSettingsBusinessType(settingsProfile.businessType ?? '');
    setSettingsCurrencyCode((settingsProfile.currencyCode as 'GHS' | 'USD' | 'NGN' | 'KES' | 'EUR' | 'GBP') ?? 'GHS');
    setSettingsTimezone(settingsProfile.timezone ?? 'Africa/Accra');
    setSettingsPreferredTime(user?.preferredTime ?? 'evening');
    if (Array.isArray(settingsProfile.enabledPaymentMethods) && settingsProfile.enabledPaymentMethods.length > 0) {
      setSettingsPaymentMethods(settingsProfile.enabledPaymentMethods);
    }
  }, [settingsProfile, user?.preferredTime]);

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
    if (!user || view !== 'chat' || walkthroughStage !== 'idle') return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(walkthroughSeenStorageKey(user.id)) === '1';
    } catch {
      seen = false;
    }
    if (seen) {
      setWalkthroughStage('done');
      return;
    }
    appendBotMessage(
      'Welcome. Would you like a quick walkthrough to get started smoothly? Reply YES or NO.'
    );
    setWalkthroughStage('awaiting_opt_in');
  }, [appendBotMessage, user, view, walkthroughStage]);

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
          setSettingsNotice('Subscription payment confirmed. Your paid plan is now active.');
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

  const openHistoryReview = useCallback((transaction: Transaction) => {
    setHistoryReviewTarget(transaction);
    setHistoryReviewAmount(String(transaction.amount));
    setHistoryReviewDate(new Date(transaction.date).toISOString().slice(0, 10));
    setHistoryReviewCategory(transaction.category ?? '');
    setHistoryReviewNotes(transaction.notes ?? '');
    setHistoryReviewEventType(transaction.eventType ?? 'other');
    setError(null);
  }, []);

  const closeHistoryReview = useCallback(() => {
    setHistoryReviewTarget(null);
    setHistoryReviewAmount('');
    setHistoryReviewDate('');
    setHistoryReviewCategory('');
    setHistoryReviewNotes('');
    setHistoryReviewEventType('other');
  }, []);

  const openTransactionDrilldown = useCallback((transactionId: string) => {
    const transaction = transactions.find((entry) => entry.id === transactionId);
    if (!transaction) {
      setError('We could not find that source transaction in this workspace.');
      return;
    }

    applyHistoryDatePreset('all_time');
    setHistoryTransactionTypeFilter('all');
    setHistoryAttachmentFilter('all');
    setHistoryQualityFilter('all');
    openHistoryReview(transaction);
    setView('history');
  }, [applyHistoryDatePreset, openHistoryReview, transactions]);

  const openJournalEntryDrilldown = useCallback((transactionId: string) => {
    const journalEntry = settingsJournalEntries.find((entry) => entry.transaction?.id === transactionId);
    if (!journalEntry) {
      setError('No linked journal entry was found for that transaction yet.');
      return;
    }

    setFocusedJournalEntryId(journalEntry.id);
    setSettingsSection('ledger');
    setView('settings');
  }, [settingsJournalEntries]);

  const handleHistoryReviewSave = useCallback(async () => {
    if (!user || !historyReviewTarget) return;

    const amount = Number(historyReviewAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount before saving this review.');
      return;
    }

    setError(null);
    setSettingsNotice(null);
    setTeamNotice(null);

    try {
      const result = await reviewTransactionMutation.mutateAsync({
        id: historyReviewTarget.id,
        updates: {
          type: historyReviewTarget.type,
          eventType: historyReviewEventType ?? 'other',
          amount,
          date: historyReviewDate,
          category: historyReviewCategory.trim() || null,
          notes: historyReviewNotes.trim() || null,
          requiresReview: false,
          correctionReason: 'Reviewed and updated from history'
        }
      });

      invalidateUserDataQueries(user.id, { includeBudgets: true });
      setSettingsNotice(
        'id' in result
          ? 'Record updated and removed from needs-review.'
          : 'Historical record submitted for approval. It will update once approved.'
      );
      closeHistoryReview();
    } catch (reviewError) {
      console.error('Unable to review transaction', reviewError);
      setError(reviewError instanceof Error ? reviewError.message : 'Unable to save this review right now.');
    }
  }, [
    closeHistoryReview,
    historyReviewAmount,
    historyReviewCategory,
    historyReviewDate,
    historyReviewEventType,
    historyReviewNotes,
    historyReviewTarget,
    invalidateUserDataQueries,
    reviewTransactionMutation,
    user
  ]);

  const handleRequestOtp = async () => {
    const normalizedPhone = authPhoneNumber.trim();
    if (!normalizedPhone) {
      setError('Enter the phone number linked to your workspace account.');
      return;
    }

    setError(null);
    setAuthNotice(null);
    setAuthDevOtpCode(null);

    try {
      const response = await requestOtpMutation.mutateAsync(normalizedPhone);
      setAuthStep('verify');
      setAuthOtpCode('');
      setAuthOtpExpiresAt(response.expiresAt);
      setAuthDevOtpCode(response.devOtpCode ?? null);
      setAuthNotice('OTP requested. Enter the 6-digit code to continue.');
    } catch (requestError) {
      console.error('Unable to request OTP', requestError);
      const message = requestError instanceof Error ? requestError.message : 'Unable to request OTP right now.';
      setError(message);
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedPhone = authPhoneNumber.trim();
    const normalizedOtp = authOtpCode.trim();
    if (!normalizedPhone || !normalizedOtp) {
      setError('Both phone number and OTP code are required.');
      return;
    }

    setError(null);
    setAuthNotice(null);
    try {
      const response = await verifyOtpMutation.mutateAsync({
        phoneNumber: normalizedPhone,
        code: normalizedOtp
      });
      setUser(response.user);
      setAuthSession(getStoredAuthSession());
      setWorkspaceSelectionId(response.session.businessId);
      setAuthOtpCode('');
      setAuthDevOtpCode(null);
      const nextView = resolvePostLoginView(response.user);
      setView(nextView);
      setAdminLoginRequested(false);
    } catch (verifyError) {
      console.error('Unable to verify OTP', verifyError);
      const message = verifyError instanceof Error ? verifyError.message : 'OTP verification failed.';
      setError(message);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setSettingsNotice(null);
    setTeamNotice(null);
    try {
      await logoutMutation.mutateAsync();
    } catch (logoutError) {
      console.error('Unable to logout session cleanly', logoutError);
    } finally {
      clearStoredAuthSession();
      setAuthSession(null);
      setLegacyUserContext(null);
      setUser(null);
      setMessages(chatMessages);
      setAdminLoginRequested(false);
      setView('landing');
    }
  };

  const handleWorkspaceSwitch = async () => {
    if (!workspaceSelectionId) {
      setError('Select a workspace first.');
      return;
    }

    setError(null);
    setSettingsNotice(null);
    setTeamNotice(null);

    try {
      await selectWorkspaceMutation.mutateAsync(workspaceSelectionId);
      setAuthSession(getStoredAuthSession());
      const refreshedMemberships = await workspaceMembershipsQuery.refetch();
      const selected = refreshedMemberships.data?.find((entry) => entry.businessId === workspaceSelectionId);
      if (selected) {
        setTeamNotice(`Switched to ${selected.businessName}.`);
      } else {
        setTeamNotice('Workspace switched.');
      }
    } catch (switchError) {
      console.error('Unable to switch workspace', switchError);
      const message = switchError instanceof Error ? switchError.message : 'Unable to switch workspace.';
      setError(message);
    }
  };

  if (view === 'landing') {
    return <LandingView setView={setView} heroSlide={heroSlide} setHeroSlide={setHeroSlide} appCopyrightNotice={appCopyrightNotice} />;
  }

  if (view === 'auth') {
    const otpExpiresLabel = authOtpExpiresAt
      ? new Date(authOtpExpiresAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
      : null;

    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 px-4 py-8">
        <div className="mx-auto max-w-md">
          <button
            onClick={() => {
              if (adminLoginRequested) {
                setView('admin');
                return;
              }
              setView('landing');
            }}
            className="mb-6 inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeftIcon size={16} className="mr-1 text-gray-500" />
            Back
          </button>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900">
              {adminLoginRequested ? 'Admin Login' : 'Sign in to your workspace'}
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {adminLoginRequested
                ? 'Use your super admin phone number. We will verify with OTP before opening the control room.'
                : 'Use your team phone number. We will verify with OTP and open your workspace role.'}
            </p>
            <div className={`mt-4 grid gap-2 ${adminLoginRequested ? '' : 'sm:grid-cols-2'}`}>
              <div className="rounded-2xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <p className="font-semibold">{adminLoginRequested ? 'Super admin account' : 'Existing user'}</p>
                <p>
                  {adminLoginRequested
                    ? 'Enter your phone and request OTP to continue to /admin.'
                    : 'Enter your phone and request OTP to sign in.'}
                </p>
              </div>
              {!adminLoginRequested && (
                <button
                  onClick={() => setView('onboarding')}
                  className="rounded-2xl border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  <p className="font-semibold">New business owner</p>
                  <p>Create account to set up your workspace.</p>
                </button>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Phone number</span>
                <input
                  value={authPhoneNumber}
                  onChange={(event) => setAuthPhoneNumber(event.target.value)}
                  placeholder="233240000001"
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 focus:border-green-500 focus:outline-none"
                />
              </label>

              {authStep === 'verify' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">OTP code</span>
                  <input
                    value={authOtpCode}
                    onChange={(event) => setAuthOtpCode(event.target.value.replace(/\D+/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 focus:border-green-500 focus:outline-none"
                  />
                </label>
              )}

              {otpExpiresLabel && authStep === 'verify' && (
                <p className="text-xs text-gray-500">OTP expires at {otpExpiresLabel}.</p>
              )}

              {authDevOtpCode && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Dev OTP code: <span className="font-semibold">{authDevOtpCode}</span>
                </p>
              )}
              {authNotice && (
                <p className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">{authNotice}</p>
              )}
              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}

              {authStep === 'request' ? (
                <button
                  onClick={handleRequestOtp}
                  disabled={isRequestingOtp}
                  className="w-full rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                >
                  {isRequestingOtp ? 'Requesting OTP...' : 'Request OTP'}
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp}
                    className="w-full rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    {isVerifyingOtp ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                  <button
                    onClick={handleRequestOtp}
                    disabled={isRequestingOtp}
                    className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {isRequestingOtp ? 'Sending...' : 'Resend OTP'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {!adminLoginRequested && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
              Need a new workspace?{' '}
              <button onClick={() => setView('onboarding')} className="font-semibold text-green-700 hover:text-green-800">
                Create account
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Onboarding Flow
  if (view === 'onboarding') {
    const paymentMethodOptions: Array<{ value: BusinessPaymentMethod; label: string }> = [
      { value: 'cash', label: 'Cash' },
      { value: 'momo', label: 'MoMo' },
      { value: 'bank', label: 'Bank transfer' },
      { value: 'card', label: 'Card / POS' },
      { value: 'credit', label: 'Credit sales' }
    ];

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
        title: 'What currency should we use?',
        subtitle: 'You can change this later in settings',
        field: 'currencyCode',
        options: ['GHS', 'NGN', 'USD', 'KES', 'EUR', 'GBP']
      },
      {
        title: 'Which payment methods do you use?',
        subtitle: 'Select at least one. This helps Akonta classify entries better.',
        field: 'paymentMethods'
      }
    ];

    const currentStep = steps[onboardingStep] as {
      title: string;
      subtitle: string;
      field: keyof typeof formData;
      placeholder?: string;
      options?: string[];
    };

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
          currencyCode: formData.currencyCode,
          paymentMethods: formData.paymentMethods,
          referralCode: onboardingReferralCode ?? undefined,
          subscriptionStatus: 'trial'
        });

        setUser(null);
        setAuthPhoneNumber(savedUser.phoneNumber);
        setAuthOtpCode('');
        setAuthStep('request');
        setAuthNotice('Account created. Request OTP to sign in as workspace owner.');
        setError(null);
        if (onboardingReferralCode) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete('ref');
          window.history.replaceState({}, '', nextUrl.toString());
          setOnboardingReferralCode(null);
        }
        setAdminLoginRequested(false);
        setView('auth');
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

            {currentStep.field === 'paymentMethods' ? (
              <div className="space-y-3">
                {paymentMethodOptions.map((option) => {
                  const selected = formData.paymentMethods.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        const next = selected
                          ? formData.paymentMethods.filter((entry) => entry !== option.value)
                          : [...formData.paymentMethods, option.value];
                        setFormData({ ...formData, paymentMethods: next });
                      }}
                      className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${
                        selected ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">{option.label}</span>
                        {selected && <CheckIcon className="text-green-500" size={20} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : currentStep.options ? (
              <div className="space-y-3">
                {currentStep.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => setFormData({ ...formData, [currentStep.field]: option as never })}
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
              disabled={
                (currentStep.field === 'paymentMethods'
                  ? formData.paymentMethods.length === 0
                  : !formData[currentStep.field as keyof typeof formData])
                || isOnboardingSubmitting
              }
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
              { id: 'settings' as AppView, icon: SettingsIcon, label: 'Settings' }
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

      {renderBalanceSheetSnapshotCard()}
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

        <div className="mx-auto min-h-screen w-full max-w-md bg-gray-100 lg:border-x lg:border-gray-200">
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
                  : hasPaidChannelAccess
                    ? 'Web + Telegram active • WhatsApp channel is active on your plan.'
                    : 'Web + Telegram active • Upgrade to Basic or Premium for WhatsApp channel.'}
              </p>
            </div>
            <ApprovalBellButton />
          </div>

          {/* Messages */}
          <div className="p-4 pb-28 space-y-3">
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
        </div>

        {/* Input */}
        <div className="fixed bottom-16 left-0 right-0 z-20">
          <div className="mx-auto w-full max-w-md bg-gray-100 px-4 py-3 lg:border-x lg:border-gray-200">
            <div className="flex gap-2">
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
            <ApprovalBellButton solid />
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
          {dashboardTab === 'overview' && isOverviewLoading && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Refreshing overview for the current workspace...
            </div>
          )}
          {dashboardTab === 'overview' && overviewLoadError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Overview could not load live workspace data. Refresh the page or switch workspace again if this persists.
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
              <h3 className="font-semibold text-gray-900">Report quality</h3>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                {Math.round((activeMonthlySummary.completeness?.completenessScore ?? 1) * 100)}%
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Product assignment</p>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  {Math.round((activeMonthlySummary.completeness?.productAssignmentRatio ?? 1) * 100)}% of sales assigned
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Unassigned sales: {formatCurrency(activeMonthlySummary.completeness?.unassignedSalesAmount ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Interpretation confidence</p>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  Low confidence: {activeMonthlySummary.completeness?.lowConfidenceCount ?? 0}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Needs review: {activeMonthlySummary.completeness?.reviewFlaggedCount ?? 0}
                </p>
              </div>
            </div>
            {(activeMonthlySummary.completeness?.unassignedSalesAmount ?? 0) > 0 && (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Product-level insights are partial because some sales are still unassigned.
              </p>
            )}
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
        if (historyQualityFilter === 'all') return true;
        if (historyQualityFilter === 'flagged') return tx.parseConfidence === 'low' || Boolean(tx.requiresReview);
        if (historyQualityFilter === 'low_confidence') return tx.parseConfidence === 'low';
        if (historyQualityFilter === 'needs_review') return Boolean(tx.requiresReview);
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
      historyAttachmentFilter !== 'all' ||
      historyQualityFilter !== 'all'
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
                    setHistoryQualityFilter('all');
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quality</span>
                <select
                  value={historyQualityFilter}
                  onChange={(event) =>
                    setHistoryQualityFilter(
                      event.target.value as 'all' | 'flagged' | 'low_confidence' | 'needs_review'
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
                >
                  <option value="all">All quality levels</option>
                  <option value="flagged">Any flagged</option>
                  <option value="low_confidence">Low confidence only</option>
                  <option value="needs_review">Needs review only</option>
                </select>
              </label>
            </div>

            <p className="text-xs text-gray-500">
              Showing {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? '' : 's'}.
            </p>
            <p className="text-xs text-gray-500">
              Flagged records can be opened here, corrected, and marked as reviewed. Historical changes will route through approval automatically.
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
                          {(tx.parseConfidence === 'low' || tx.parseConfidence === 'medium' || tx.requiresReview) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {tx.parseConfidence === 'low' && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                  Low confidence
                                </span>
                              )}
                              {tx.parseConfidence === 'medium' && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                  Medium confidence
                                </span>
                              )}
                              {tx.requiresReview && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                  Needs review
                                </span>
                              )}
                            </div>
                          )}
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
                        <button
                          onClick={() => openHistoryReview(tx)}
                          className="text-xs font-semibold text-gray-700 hover:text-gray-900"
                        >
                          {tx.requiresReview || tx.parseConfidence === 'low' || tx.parseConfidence === 'medium'
                            ? 'Review & update'
                            : 'Edit record'}
                        </button>
                        {tx.ledgerPostingStatus === 'posted' && (
                          <button
                            onClick={() => openJournalEntryDrilldown(tx.id)}
                            className="text-xs font-semibold text-green-700 hover:text-green-800"
                          >
                            View linked journal
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {historyReviewTarget && (
            <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-6 pt-16 sm:items-center">
              <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Review record</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Update the classification, amount, or notes, then save to clear the review flag.
                    </p>
                  </div>
                  <button
                    onClick={closeHistoryReview}
                    className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={historyReviewAmount}
                      onChange={(event) => setHistoryReviewAmount(event.target.value)}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date</span>
                    <input
                      type="date"
                      value={historyReviewDate}
                      onChange={(event) => setHistoryReviewDate(event.target.value)}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Type</span>
                    <input
                      value={historyReviewTarget.type === 'revenue' ? 'Revenue' : 'Expense'}
                      disabled
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event</span>
                    <select
                      value={historyReviewEventType ?? 'other'}
                      onChange={(event) => setHistoryReviewEventType(event.target.value as Transaction['eventType'])}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                    >
                      {transactionEventOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Category</span>
                    <select
                      value={historyReviewCategory}
                      onChange={(event) => setHistoryReviewCategory(event.target.value)}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                    >
                      <option value="">No category</option>
                      {settingsCategories
                        .filter((entry) => entry.isActive && entry.kind === (historyReviewTarget.type === 'revenue' ? 'sales' : 'expense'))
                        .map((entry) => (
                          <option key={entry.id} value={entry.name}>{entry.name}</option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
                    <textarea
                      value={historyReviewNotes}
                      onChange={(event) => setHistoryReviewNotes(event.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  Records from earlier dates will create an approval request instead of changing immediately.
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {historyReviewTarget.ledgerPostingStatus === 'posted' && (
                    <button
                      onClick={() => openJournalEntryDrilldown(historyReviewTarget.id)}
                      className="rounded-2xl border border-green-300 bg-white px-4 py-3 text-sm font-semibold text-green-700 hover:bg-green-50"
                    >
                      View linked journal
                    </button>
                  )}
                  <button
                    onClick={closeHistoryReview}
                    className="rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleHistoryReviewSave()}
                    disabled={reviewTransactionMutation.isPending}
                    className="rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {reviewTransactionMutation.isPending ? 'Saving...' : 'Save review'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  if (view === 'approvals') {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Approval Notifications</h1>
              <p className="text-sm text-gray-500">Historical edits and deletes appear here for owner or accounting review.</p>
            </div>
            <button
              onClick={() => setView('dashboard')}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          {!canReviewApprovals ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              Your current role does not have approval review access for historical changes.
            </div>
          ) : pendingApprovalsQuery.isLoading ? (
            <div className="rounded-3xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
              Loading approval notifications...
            </div>
          ) : pendingApprovalsQuery.isError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              Unable to load approval notifications right now.
            </div>
          ) : pendingApprovals.length === 0 ? (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
              No pending historical updates right now. You are all caught up.
            </div>
          ) : (
            pendingApprovals.map((approval) => (
              <div key={approval.id} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {approval.transaction.category || approval.transaction.eventType?.replace(/_/g, ' ') || approval.transaction.type}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Requested by {approval.requestedByUser?.fullName || approval.requestedByUser?.name || 'Team member'} on {formatDate(new Date(approval.requestedAt))}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                    Pending approval
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-gray-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Amount</p>
                    <p className="mt-2 text-sm font-semibold text-gray-900">{formatCurrency(approval.transaction.amount)}</p>
                  </div>
                  <div className="rounded-2xl bg-gray-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Original date</p>
                    <p className="mt-2 text-sm font-semibold text-gray-900">{formatDate(new Date(approval.transaction.date))}</p>
                  </div>
                  <div className="rounded-2xl bg-gray-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Event</p>
                    <p className="mt-2 text-sm font-semibold capitalize text-gray-900">
                      {(approval.transaction.eventType ?? 'other').replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>

                {approval.reason && (
                  <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    {approval.reason.startsWith('PATCH_JSON:')
                      ? 'Historical record update requested. Open the source transaction to inspect the current record before approving.'
                      : approval.reason.startsWith('DELETE_REQUEST:')
                        ? 'Historical delete request is waiting for approval.'
                        : approval.reason}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => openTransactionDrilldown(approval.transaction.id)}
                    className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Open source transaction
                  </button>
                  <button
                    onClick={() => void handleApprovalReview(approval, 'reject')}
                    disabled={reviewPendingApprovalMutation.isPending}
                    className="rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => void handleApprovalReview(approval, 'approve')}
                    disabled={reviewPendingApprovalMutation.isPending}
                    className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {reviewPendingApprovalMutation.isPending ? 'Saving...' : 'Approve'}
                  </button>
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

    if (!user) {
      return (
        <div className="min-h-screen bg-slate-50">
          <div className="bg-white px-4 py-6 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-900">Admin Cockpit</h1>
            <p className="text-sm text-gray-500">Super admin login is required to access this area.</p>
          </div>
          <div className="mx-auto w-full max-w-md px-4 py-8">
            <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6 text-sm text-blue-800">
              Sign in with your super admin phone number to continue to the control room.
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => {
                  setError(null);
                  setAuthNotice(null);
                  setAuthDevOtpCode(null);
                  setAuthOtpCode('');
                  setAuthStep('request');
                  setAdminLoginRequested(true);
                  setView('auth');
                }}
                className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700"
              >
                Admin Login
              </button>
              <button
                onClick={() => {
                  setAdminLoginRequested(false);
                  setView('landing');
                }}
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back To Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (!isSuperAdmin) {
      return (
        <div className="min-h-screen bg-slate-50">
          <div className="bg-white px-4 py-6 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-900">Admin Cockpit</h1>
            <p className="text-sm text-gray-500">Access is restricted to super admin accounts.</p>
          </div>
          <div className="px-4 py-6 space-y-4">
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              You do not have super admin access for this account.
            </div>
            <button
              onClick={() => {
                setAdminLoginRequested(false);
                setView('dashboard');
              }}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Back To Workspace
            </button>
          </div>
        </div>
      );
    }

    const adminCurrencyCode = adminPaymentDraft?.currencyCode ?? adminPaymentSettings?.currencyCode ?? 'GHS';
    const userTotalForTier = Math.max(adminAnalytics?.users.total ?? 0, 1);
    const businessTotalForLocation = Math.max(adminAnalytics?.businesses.total ?? 0, 1);
    const topLocations = (adminAnalytics?.locations ?? []).slice(0, 8);
    const topBusinessTypes = (adminAnalytics?.businessTypes ?? []).slice(0, 8);
    const recentActivity = adminAnalytics?.activity.recent ?? [];
    const subscriptionCurrencyCode = adminAnalytics?.subscriptions.inflows.currencyCode ?? adminCurrencyCode;
    const upcomingRenewals = adminAnalytics?.subscriptions.upcomingRenewals.list ?? [];

    return (
      <div className="min-h-screen bg-slate-50">
        <div className="border-b border-gray-200 bg-white px-4 py-6">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Control Room</p>
              <h1 className="text-2xl font-bold text-gray-900">Super Admin Cockpit</h1>
              <p className="text-sm text-gray-500">Global visibility across tiers, locations, operations, and billing signals.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView('dashboard')}
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Open Workspace
              </button>
              <button
                onClick={refreshAdmin}
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
          {adminError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {adminError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Total users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.total ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Total workspaces</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.businesses.total ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Paid users</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{adminAnalytics?.users.paid ?? '-'}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Net (last 30 days)</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatCurrencyValue(adminAnalytics?.activity.last30Days.net ?? 0, adminCurrencyCode)}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Renewals (Next 30 Days)</h2>
            <p className="mt-1 text-sm text-gray-500">Forecasted renewal inflows and auto-renew readiness by workspace.</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Due in 7 days</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{adminAnalytics?.subscriptions.upcomingRenewals.next7DaysCount ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Due in 30 days</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{adminAnalytics?.subscriptions.upcomingRenewals.next30DaysCount ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Expected 7-day inflow</p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {formatCurrencyValue(adminAnalytics?.subscriptions.upcomingRenewals.expectedRevenueNext7Days ?? 0, subscriptionCurrencyCode)}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Auto-renew ready</p>
                <p className="mt-1 text-xl font-bold text-gray-900">
                  {adminAnalytics?.subscriptions.upcomingRenewals.autoRenewReadyCount ?? 0}
                </p>
              </div>
            </div>

            {upcomingRenewals.length ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-200">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <span>Workspace</span>
                    <span>Plan</span>
                    <span>Renewal Date</span>
                    <span>Expected</span>
                    <span>Auto-Renew</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {upcomingRenewals.slice(0, 12).map((item) => (
                      <div key={`${item.businessId}-${item.renewalDate}`} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] px-4 py-3 text-sm">
                        <div>
                          <p className="font-semibold text-gray-900">{item.businessName}</p>
                          <p className="text-xs text-gray-500">{item.ownerName}</p>
                        </div>
                        <span className="capitalize text-gray-700">{item.plan}</span>
                        <span className="text-gray-700">
                          {new Date(item.renewalDate).toLocaleDateString('en-GH', { month: 'short', day: 'numeric', year: 'numeric' })}
                          <span className="ml-1 text-xs text-gray-500">({item.daysUntilRenewal}d)</span>
                        </span>
                        <span className="text-gray-900">{formatCurrencyValue(item.expectedAmount, item.currencyCode || subscriptionCurrencyCode)}</span>
                        <span className={item.autoRenewReady ? 'font-semibold text-green-700' : 'font-semibold text-amber-700'}>
                          {item.autoRenewReady ? 'Ready' : 'Missing auth'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No upcoming renewals in the next 30 days.</p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900">Daily subscriptions (last 14 days)</h2>
              <p className="mt-1 text-sm text-gray-500">Successful paid subscriptions and estimated revenue per day.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                      subscriptionCurrencyCode
                    )}
                  </p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Inflows (last 30 days)</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">
                    {formatCurrencyValue(adminAnalytics?.subscriptions.inflows.last30Days ?? 0, subscriptionCurrencyCode)}
                  </p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Inflows (MTD)</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">
                    {formatCurrencyValue(adminAnalytics?.subscriptions.inflows.monthToDate ?? 0, subscriptionCurrencyCode)}
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
                          <span>{day.count} subs • {formatCurrencyValue(day.revenue, subscriptionCurrencyCode)}</span>
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
              <h2 className="text-lg font-semibold text-gray-900">Price Tier Mix</h2>
              <p className="mt-1 text-sm text-gray-500">User distribution by active plan tier.</p>
              <div className="mt-4 space-y-3">
                {[
                  { label: 'Free', value: adminAnalytics?.tiers.free ?? 0, color: 'bg-gray-500' },
                  { label: 'Trial', value: adminAnalytics?.tiers.trial ?? 0, color: 'bg-amber-500' },
                  { label: 'Basic', value: adminAnalytics?.tiers.basic ?? 0, color: 'bg-blue-500' },
                  { label: 'Premium', value: adminAnalytics?.tiers.premium ?? 0, color: 'bg-green-500' }
                ].map((row) => {
                  const width = Math.max(3, (row.value / userTotalForTier) * 100);
                  return (
                    <div key={row.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-700">{row.label}</span>
                        <span className="text-gray-500">{row.value}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${row.color}`} style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Workspace Locations</h2>
              <p className="mt-1 text-sm text-gray-500">Distribution by configured timezone/location.</p>
              {topLocations.length ? (
                <div className="mt-4 space-y-3">
                  {topLocations.map((entry) => {
                    const width = Math.max(3, (entry.count / businessTotalForLocation) * 100);
                    return (
                      <div key={entry.location}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-semibold text-gray-700">{entry.location}</span>
                          <span className="text-gray-500">{entry.count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500">No location signals yet.</p>
              )}
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Channel Activity (30d)</h2>
              <p className="mt-1 text-sm text-gray-500">Where accounting events are being captured.</p>
              <div className="mt-4 space-y-3">
                {[
                  { label: 'App', value: adminAnalytics?.channels.app ?? 0, color: 'bg-indigo-500' },
                  { label: 'WhatsApp', value: adminAnalytics?.channels.whatsapp ?? 0, color: 'bg-green-500' },
                  { label: 'System', value: adminAnalytics?.channels.system ?? 0, color: 'bg-gray-500' }
                ].map((channel) => {
                  const totalChannels = Math.max(
                    (adminAnalytics?.channels.app ?? 0)
                    + (adminAnalytics?.channels.whatsapp ?? 0)
                    + (adminAnalytics?.channels.system ?? 0),
                    1
                  );
                  const width = Math.max(3, (channel.value / totalChannels) * 100);
                  return (
                    <div key={channel.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-700">{channel.label}</span>
                        <span className="text-gray-500">{channel.value}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${channel.color}`} style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-3 text-xs">
                <div>
                  <p className="text-gray-500">Transactions (30d)</p>
                  <p className="font-semibold text-gray-900">{adminAnalytics?.activity.last30Days.transactions ?? 0}</p>
                </div>
                <div>
                  <p className="text-gray-500">Net (30d)</p>
                  <p className="font-semibold text-gray-900">
                    {formatCurrencyValue(adminAnalytics?.activity.last30Days.net ?? 0, adminCurrencyCode)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Business Type Mix</h2>
              <p className="mt-1 text-sm text-gray-500">Top business categories using Akonta AI.</p>
              {topBusinessTypes.length ? (
                <div className="mt-4 space-y-3">
                  {topBusinessTypes.map((entry) => {
                    const percentage = (entry.count / userTotalForTier) * 100;
                    return (
                      <div key={entry.type}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-semibold text-gray-700">{entry.type}</span>
                          <span className="text-gray-500">{entry.count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(3, percentage)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500">No business profile data yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activity Feed</h2>
            <p className="mt-1 text-sm text-gray-500">Latest events across all workspaces.</p>
            {recentActivity.length ? (
              <div className="mt-4 space-y-3">
                {recentActivity.slice(0, 20).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold capitalize text-gray-900">{item.title}</p>
                      <span className="text-xs text-gray-500">
                        {formatDate(item.occurredAt)} {formatTime(item.occurredAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{item.description}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.businessName} • {item.actorName}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">No activity events yet.</p>
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
                      basicAmount: prev?.basicAmount ?? 60,
                      premiumAmount: prev?.premiumAmount ?? 200,
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
                      basicAmount: prev?.basicAmount ?? 60,
                      premiumAmount: prev?.premiumAmount ?? 200,
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
                      basicAmount: prev?.basicAmount ?? 60,
                      premiumAmount: prev?.premiumAmount ?? 200,
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
                      basicAmount: prev?.basicAmount ?? 60,
                      premiumAmount: prev?.premiumAmount ?? 200,
                      currencyCode: event.target.value.toUpperCase()
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  placeholder="GHS"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Basic amount (major unit)</span>
                <input
                  type="number"
                  min="1"
                  value={adminPaymentDraft?.basicAmount ?? 60}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: prev?.paystackPublicKey ?? '',
                      paystackSecretKey: prev?.paystackSecretKey ?? '',
                      paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                      basicAmount: Number(event.target.value || 60),
                      premiumAmount: prev?.premiumAmount ?? 200,
                      currencyCode: prev?.currencyCode ?? 'GHS'
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Premium amount (major unit)</span>
                <input
                  type="number"
                  min="1"
                  value={adminPaymentDraft?.premiumAmount ?? 200}
                  onChange={(event) =>
                    setAdminPaymentDraft((prev) => ({
                      paystackPublicKey: prev?.paystackPublicKey ?? '',
                      paystackSecretKey: prev?.paystackSecretKey ?? '',
                      paystackWebhookSecret: prev?.paystackWebhookSecret ?? '',
                      basicAmount: prev?.basicAmount ?? 60,
                      premiumAmount: Number(event.target.value || 200),
                      currencyCode: prev?.currencyCode ?? 'GHS'
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700"
                />
              </label>
            </div>
            {adminPaymentSettings && (
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                <p>Current live Basic: {formatCurrencyValue(adminPaymentSettings.basicAmount, adminPaymentSettings.currencyCode)} / month</p>
                <p>Current live Premium: {formatCurrencyValue(adminPaymentSettings.premiumAmount, adminPaymentSettings.currencyCode)} / month</p>
              </div>
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
      </div>
    );
  }

  // Settings View
  if (view === 'settings') {
    const currentYear = new Date().getUTCFullYear();
    const currentMonth = new Date().getUTCMonth() + 1;
    const inviteRoles: WorkspaceRole[] = ['cashier', 'manager', 'bookkeeper', 'viewer', 'accountant'];
    const roleLabel: Record<WorkspaceRole, string> = {
      owner: 'Owner',
      cashier: 'Cashier',
      manager: 'Manager',
      bookkeeper: 'Bookkeeper',
      viewer: 'Viewer',
      accountant: 'Accountant'
    };
    const basicMonthlyPrice = adminPaymentSettings?.basicAmount ?? adminPaymentDraft?.basicAmount ?? 60;
    const premiumMonthlyPrice = adminPaymentSettings?.premiumAmount ?? adminPaymentDraft?.premiumAmount ?? 200;
    const billingCurrencyCode = adminPaymentSettings?.currencyCode ?? adminPaymentDraft?.currencyCode ?? 'GHS';
    const setupPaymentOptions: Array<{ value: BusinessPaymentMethod; label: string }> = [
      { value: 'cash', label: 'Cash' },
      { value: 'momo', label: 'MoMo' },
      { value: 'bank', label: 'Bank transfer' },
      { value: 'card', label: 'Card / POS' },
      { value: 'credit', label: 'Credit' }
    ];

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

    const handleSaveBusinessProfile = async () => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);
      try {
        const normalizedCurrencyCode = settingsCurrencyCode.toUpperCase() as 'GHS' | 'USD' | 'NGN' | 'KES' | 'EUR' | 'GBP';
        const [updatedProfile, updatedUser] = await Promise.all([
          updateBusinessProfileMutation.mutateAsync({
            businessName: settingsBusinessName.trim() || undefined,
            businessType: settingsBusinessType.trim() || null,
            currencyCode: normalizedCurrencyCode,
            timezone: settingsTimezone.trim() || 'Africa/Accra',
            enabledPaymentMethods: settingsPaymentMethods,
            onboardingCompleted: true
          }),
          updateUserProfileMutation.mutateAsync({
            userId: user.id,
            updates: {
              businessName: settingsBusinessName.trim() || user.businessName,
              businessType: settingsBusinessType.trim() || user.businessType,
              timezone: settingsTimezone.trim() || 'Africa/Accra',
              currencyCode: normalizedCurrencyCode,
              preferredTime: settingsPreferredTime
            }
          })
        ]);
        setSettingsNotice('Business profile saved.');
        setUser({
          ...updatedUser,
          businessName: updatedProfile.businessName,
          businessType: updatedProfile.businessType ?? updatedUser.businessType,
          currencyCode: updatedProfile.currencyCode,
          timezone: updatedProfile.timezone,
          preferredTime: updatedUser.preferredTime ?? settingsPreferredTime
        });
      } catch (profileError) {
        console.error('Unable to save business profile', profileError);
        setError(profileError instanceof Error ? profileError.message : 'Unable to save business profile right now.');
      }
    };

    const handleBootstrapDefaults = async () => {
      setError(null);
      setSettingsNotice(null);
      try {
        await bootstrapDefaultsMutation.mutateAsync();
        setSettingsNotice('Default categories and ledgers are ready.');
      } catch (bootstrapError) {
        console.error('Unable to bootstrap defaults', bootstrapError);
        setError(bootstrapError instanceof Error ? bootstrapError.message : 'Unable to load default setup.');
      }
    };

    const handleCreateCategory = async () => {
      if (!setupCategoryName.trim()) return;
      setError(null);
      try {
        await createCategoryMutation.mutateAsync({
          kind: setupCategoryKind,
          name: setupCategoryName.trim()
        });
        setSetupCategoryName('');
        setSettingsNotice('Category saved.');
      } catch (categoryError) {
        console.error('Unable to save category', categoryError);
        setError(categoryError instanceof Error ? categoryError.message : 'Unable to save category.');
      }
    };

    const handleCreateProduct = async () => {
      if (!setupProductName.trim()) return;
      setError(null);
      try {
        await createProductMutation.mutateAsync({
          name: setupProductName.trim(),
          type: setupProductType,
          categoryId: setupProductCategoryId || null,
          defaultPrice: setupProductDefaultPrice ? Number(setupProductDefaultPrice) : null,
          estimatedCost: setupProductEstimatedCost ? Number(setupProductEstimatedCost) : null
        });
        setSetupProductName('');
        setSetupProductDefaultPrice('');
        setSetupProductEstimatedCost('');
        setSetupProductCategoryId('');
        setSettingsNotice('Product/service saved.');
      } catch (productError) {
        console.error('Unable to save product/service', productError);
        setError(productError instanceof Error ? productError.message : 'Unable to save product/service.');
      }
    };

    const handleCreateCustomer = async () => {
      if (!setupCustomerName.trim()) return;
      setError(null);
      try {
        await createCustomerMutation.mutateAsync({
          name: setupCustomerName.trim(),
          phoneNumber: setupCustomerPhone.trim() || null,
          openingReceivable: setupCustomerOpening ? Number(setupCustomerOpening) : 0
        });
        setSetupCustomerName('');
        setSetupCustomerPhone('');
        setSetupCustomerOpening('');
        setSettingsNotice('Customer saved.');
      } catch (customerError) {
        console.error('Unable to save customer', customerError);
        setError(customerError instanceof Error ? customerError.message : 'Unable to save customer.');
      }
    };

    const handleCreateSupplier = async () => {
      if (!setupSupplierName.trim()) return;
      setError(null);
      try {
        await createSupplierMutation.mutateAsync({
          name: setupSupplierName.trim(),
          phoneNumber: setupSupplierPhone.trim() || null,
          supplyType: setupSupplierType.trim() || null,
          openingPayable: setupSupplierOpening ? Number(setupSupplierOpening) : 0
        });
        setSetupSupplierName('');
        setSetupSupplierPhone('');
        setSetupSupplierType('');
        setSetupSupplierOpening('');
        setSettingsNotice('Supplier saved.');
      } catch (supplierError) {
        console.error('Unable to save supplier', supplierError);
        setError(supplierError instanceof Error ? supplierError.message : 'Unable to save supplier.');
      }
    };

    const handleCreateCustomLedger = async () => {
      if (!customLedgerCode.trim() || !customLedgerName.trim()) return;
      setError(null);
      try {
        await createLedgerAccountMutation.mutateAsync({
          code: customLedgerCode.trim().toUpperCase(),
          name: customLedgerName.trim(),
          accountType: customLedgerAccountType,
          parentId: customLedgerParentId || null
        });
        setCustomLedgerCode('');
        setCustomLedgerName('');
        setCustomLedgerParentId('');
        setSettingsNotice('Custom ledger created.');
      } catch (ledgerError) {
        console.error('Unable to create custom ledger', ledgerError);
        setError(ledgerError instanceof Error ? ledgerError.message : 'Unable to create custom ledger.');
      }
    };

    const beginLedgerEdit = (ledger: LedgerAccount) => {
      setEditingLedgerId(ledger.id);
      setEditingLedgerCode(ledger.code);
      setEditingLedgerName(ledger.name);
      setEditingLedgerParentId(ledger.parentId ?? '');
      setSettingsNotice(null);
      setError(null);
    };

    const cancelLedgerEdit = () => {
      setEditingLedgerId(null);
      setEditingLedgerCode('');
      setEditingLedgerName('');
      setEditingLedgerParentId('');
    };

    const handleSaveLedgerEdit = async () => {
      if (!editingLedgerId || !editingLedgerCode.trim() || !editingLedgerName.trim()) return;
      setError(null);
      try {
        await updateLedgerAccountMutation.mutateAsync({
          id: editingLedgerId,
          updates: {
            code: editingLedgerCode.trim().toUpperCase(),
            name: editingLedgerName.trim(),
            parentId: editingLedgerParentId || null
          }
        });
        setSettingsNotice('Custom ledger updated.');
        cancelLedgerEdit();
      } catch (ledgerEditError) {
        console.error('Unable to update custom ledger', ledgerEditError);
        setError(ledgerEditError instanceof Error ? ledgerEditError.message : 'Unable to update custom ledger.');
      }
    };

    const handleDeactivateCustomLedger = async (ledger: LedgerAccount) => {
      setError(null);
      try {
        await deactivateLedgerAccountMutation.mutateAsync(ledger.id);
        if (editingLedgerId === ledger.id) cancelLedgerEdit();
        setSettingsNotice('Custom ledger deactivated.');
      } catch (ledgerDeactivateError) {
        console.error('Unable to deactivate custom ledger', ledgerDeactivateError);
        setError(ledgerDeactivateError instanceof Error ? ledgerDeactivateError.message : 'Unable to deactivate custom ledger.');
      }
    };

    const addManualJournalLine = () => {
      setManualJournalLines((previous) => ([
        ...previous,
        { id: `line-${Date.now()}-${previous.length + 1}`, accountId: '', debitAmount: '', creditAmount: '', memo: '' }
      ]));
    };

    const removeManualJournalLine = (lineId: string) => {
      setManualJournalLines((previous) => (
        previous.length <= 2 ? previous : previous.filter((line) => line.id !== lineId)
      ));
    };

    const updateManualJournalLine = (
      lineId: string,
      field: 'accountId' | 'debitAmount' | 'creditAmount' | 'memo',
      value: string
    ) => {
      setManualJournalLines((previous) => previous.map((line) => (
        line.id === lineId ? { ...line, [field]: value } : line
      )));
    };

    const handleCreateManualJournalEntry = async () => {
      if (manualJournalLines.some((line) => !line.accountId)) {
        setError('Choose accounts for every journal line.');
        return;
      }

      const totalsBalanced = Math.abs(manualJournalDebitTotal - manualJournalCreditTotal) < 0.0001;
      if (!totalsBalanced || manualJournalDebitTotal <= 0 || manualJournalCreditTotal <= 0) {
        setError('Manual entry must be balanced with non-zero debit and credit totals.');
        return;
      }

      setError(null);
      try {
        await createManualJournalEntryMutation.mutateAsync({
          entryDate: `${manualJournalDate}T12:00:00.000Z`,
          description: manualJournalDescription.trim() || null,
          lines: manualJournalLines.map((line) => ({
            accountId: line.accountId,
            debitAmount: Number(line.debitAmount || 0),
            creditAmount: Number(line.creditAmount || 0),
            memo: line.memo.trim() || null
          }))
        });
        setManualJournalDescription('');
        setManualJournalLines([
          { id: 'line-1', accountId: '', debitAmount: '', creditAmount: '', memo: '' },
          { id: 'line-2', accountId: '', debitAmount: '', creditAmount: '', memo: '' }
        ]);
        setSettingsNotice(
          'Manual journal entry submitted. Non-owner entries are posted as needs review until approved.'
        );
      } catch (entryError) {
        console.error('Unable to post manual journal entry', entryError);
        setError(entryError instanceof Error ? entryError.message : 'Unable to post manual journal entry.');
      }
    };

    const telegramLinkCommand = user?.phoneNumber ? `/link ${user.phoneNumber}` : '/link +233XXXXXXXXX';
    const isTelegramLinked = Boolean(telegramStatus?.telegramChatId);

    const handleCopyTelegramLinkCommand = async () => {
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);
      if (!navigator?.clipboard) {
        setError('Clipboard is unavailable in this browser.');
        return;
      }
      try {
        await navigator.clipboard.writeText(telegramLinkCommand);
        setSettingsNotice('Telegram link command copied.');
      } catch (copyError) {
        console.error('Unable to copy Telegram link command', copyError);
        setError('Unable to copy Telegram link command.');
      }
    };

    const handleRefreshTelegramLinkStatus = async () => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);
      try {
        const latestUser = await getUser(user.id);
        setUser(latestUser);
        await telegramStatusQuery.refetch();
        setSettingsNotice(
          latestUser.telegramChatId
            ? 'Telegram linked and ready for this account.'
            : 'Telegram is not linked yet. Use the /link command in Telegram.'
        );
      } catch (refreshError) {
        console.error('Unable to refresh Telegram status', refreshError);
        setError('Unable to refresh Telegram status right now.');
      }
    };

    const handleStartCheckout = async (plan: 'basic' | 'premium') => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);
      try {
        const callbackUrl = `${window.location.origin}${window.location.pathname}`;
        const initialized = await initializeSubscriptionMutation.mutateAsync({
          userId: user.id,
          plan,
          months: 1,
          callbackUrl
        });
        window.location.assign(initialized.authorizationUrl);
      } catch (subscriptionError) {
        console.error('Unable to initialize subscription checkout', subscriptionError);
        setError('Unable to start payment checkout right now.');
      }
    };

    const handleManualPlanActivation = async (status: 'basic' | 'premium') => {
      if (!user) return;
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);
      try {
        const updated = await activateSubscriptionMutation.mutateAsync({
          userId: user.id,
          request: {
            status,
            source: 'paid',
            months: 1,
            note: `Manual ${status} activation`
          }
        });
        setUser(updated);
        await referralProgressQuery.refetch();
        setSettingsNotice(`${status === 'premium' ? 'Premium' : 'Basic'} manually activated for this account.`);
      } catch (subscriptionError) {
        console.error('Unable to activate subscription', subscriptionError);
        setError('Unable to activate subscription.');
      }
    };

    const handleInviteWorkspaceMember = async () => {
      if (!canManageWorkspaceMembers) return;
      const normalizedName = teamInviteName.trim();
      const normalizedPhone = teamInvitePhone.trim();
      const normalizedEmail = teamInviteEmail.trim();

      if (!normalizedName || (!normalizedPhone && !normalizedEmail)) {
        setError('Team invite requires full name and either phone number or email.');
        return;
      }

      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);

      try {
        await inviteWorkspaceMemberMutation.mutateAsync({
          fullName: normalizedName,
          phoneNumber: normalizedPhone || undefined,
          email: normalizedEmail || undefined,
          role: teamInviteRole
        });
        setTeamInviteName('');
        setTeamInvitePhone('');
        setTeamInviteEmail('');
        setTeamInviteRole('cashier');
        setTeamNotice(`${normalizedName} invited as ${roleLabel[teamInviteRole]}.`);
      } catch (inviteError) {
        console.error('Unable to invite workspace member', inviteError);
        setError(inviteError instanceof Error ? inviteError.message : 'Unable to invite this team member right now.');
      }
    };

    const handleWorkspaceRoleSave = async (member: WorkspaceMember) => {
      if (!canManageWorkspaceMembers || member.role === 'owner') return;
      const nextRole = teamRoleDrafts[member.membershipId];
      if (!nextRole || nextRole === member.role) return;

      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);

      try {
        await updateWorkspaceMemberMutation.mutateAsync({
          membershipId: member.membershipId,
          updates: { role: nextRole }
        });
        setTeamNotice(`Updated ${member.user.fullName ?? member.user.name} to ${roleLabel[nextRole]}.`);
      } catch (roleError) {
        console.error('Unable to update member role', roleError);
        setError(roleError instanceof Error ? roleError.message : 'Unable to update member role right now.');
      }
    };

    const handleWorkspaceStatusToggle = async (member: WorkspaceMember) => {
      if (!canManageWorkspaceMembers || member.role === 'owner') return;

      const nextStatus: WorkspaceMembershipStatus = member.status === 'active' ? 'inactive' : 'active';
      setError(null);
      setSettingsNotice(null);
      setTeamNotice(null);

      try {
        await updateWorkspaceMemberMutation.mutateAsync({
          membershipId: member.membershipId,
          updates: { status: nextStatus }
        });
        setTeamNotice(
          `${member.user.fullName ?? member.user.name} is now ${nextStatus === 'active' ? 'active' : 'inactive'}.`
        );
      } catch (statusError) {
        console.error('Unable to update member status', statusError);
        setError(statusError instanceof Error ? statusError.message : 'Unable to update member status right now.');
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              <p className="text-gray-500 text-sm">Workspace profile, accounting setup, messaging channels, and referral rewards</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isLoggingOut ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          {settingsNotice && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {settingsNotice}
            </div>
          )}
          {teamNotice && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {teamNotice}
            </div>
          )}

          <div className="bg-white rounded-3xl border border-gray-200 p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'profile', label: 'Business Profile' },
                { id: 'categories', label: 'Categories' },
                { id: 'products', label: 'Products & Services' },
                { id: 'customers', label: 'Customers' },
                { id: 'suppliers', label: 'Suppliers' },
                { id: 'ledger', label: 'Accounting Setup' },
                { id: 'team', label: 'Team' },
                { id: 'advanced', label: 'Advanced' }
              ].map((section) => (
                <button
                  key={section.id}
                  onClick={() => setSettingsSection(section.id as typeof settingsSection)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                    settingsSection === section.id
                      ? 'bg-green-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {settingsSection === 'profile' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Business Profile</h2>
                  <p className="text-sm text-gray-500">Complete onboarding basics and payment context.</p>
                </div>
                <button
                  onClick={handleBootstrapDefaults}
                  disabled={bootstrapDefaultsMutation.isPending}
                  className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {bootstrapDefaultsMutation.isPending ? 'Preparing...' : 'Load Defaults'}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={settingsBusinessName}
                  onChange={(event) => setSettingsBusinessName(event.target.value)}
                  placeholder="Business name"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={settingsBusinessType}
                  onChange={(event) => setSettingsBusinessType(event.target.value)}
                  placeholder="Business type"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={settingsTimezone}
                  onChange={(event) => setSettingsTimezone(event.target.value)}
                  placeholder="Timezone"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <select
                  value={settingsCurrencyCode}
                  onChange={(event) => setSettingsCurrencyCode(event.target.value as typeof settingsCurrencyCode)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  {['GHS', 'USD', 'NGN', 'KES', 'EUR', 'GBP'].map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <select
                  value={settingsPreferredTime}
                  onChange={(event) => setSettingsPreferredTime(event.target.value as typeof settingsPreferredTime)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  <option value="morning">Morning check-in</option>
                  <option value="afternoon">Afternoon check-in</option>
                  <option value="evening">Evening check-in</option>
                </select>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Preferred check-up time</p>
                <p className="text-sm text-gray-500">Akonta uses this to decide when to nudge the owner to review or update records.</p>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Methods</p>
                <div className="flex flex-wrap gap-2">
                  {setupPaymentOptions.map((option) => {
                    const selected = settingsPaymentMethods.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSettingsPaymentMethods((previous) => (
                            previous.includes(option.value)
                              ? previous.filter((entry) => entry !== option.value)
                              : [...previous, option.value]
                          ));
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          selected ? 'bg-green-600 text-white' : 'border border-gray-300 bg-white text-gray-700'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                  <p className="text-xs text-gray-500">Products</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{settingsProfile?.setupCounts.products ?? '-'}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                  <p className="text-xs text-gray-500">Customers</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{settingsProfile?.setupCounts.customers ?? '-'}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-3 py-3 text-center">
                  <p className="text-xs text-gray-500">Suppliers</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{settingsProfile?.setupCounts.suppliers ?? '-'}</p>
                </div>
              </div>
              <button
                onClick={handleSaveBusinessProfile}
                disabled={isAnySettingsActionPending || settingsPaymentMethods.length === 0}
                className="mt-4 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              >
                Save Business Profile
              </button>
            </div>
          )}

          {settingsSection === 'categories' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Categories</h2>
              <p className="mb-4 text-sm text-gray-500">Sales and expense categories used for cleaner classification and reports.</p>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
                <select
                  value={setupCategoryKind}
                  onChange={(event) => setSetupCategoryKind(event.target.value as 'sales' | 'expense')}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  <option value="sales">Sales</option>
                  <option value="expense">Expense</option>
                </select>
                <input
                  value={setupCategoryName}
                  onChange={(event) => setSetupCategoryName(event.target.value)}
                  placeholder="Category name"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <button
                  onClick={handleCreateCategory}
                  disabled={createCategoryMutation.isPending || !setupCategoryName.trim()}
                  className="rounded-2xl bg-green-500 px-4 py-3 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {settingsCategories.map((category) => (
                  <div key={category.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <span className="font-semibold">{category.name}</span>
                    <span className="ml-2 text-xs text-gray-500 uppercase">{category.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {settingsSection === 'products' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Products & Services</h2>
              <p className="mb-4 text-sm text-gray-500">Optional setup to improve product/service profitability insights.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={setupProductName}
                  onChange={(event) => setSetupProductName(event.target.value)}
                  placeholder="Name (e.g. Braids, Meat Pie)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <select
                  value={setupProductType}
                  onChange={(event) => setSetupProductType(event.target.value as 'product' | 'service')}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
                <input
                  value={setupProductDefaultPrice}
                  onChange={(event) => setSetupProductDefaultPrice(event.target.value)}
                  placeholder="Default price (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupProductEstimatedCost}
                  onChange={(event) => setSetupProductEstimatedCost(event.target.value)}
                  placeholder="Estimated cost (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <select
                  value={setupProductCategoryId}
                  onChange={(event) => setSetupProductCategoryId(event.target.value)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm sm:col-span-2"
                >
                  <option value="">No category</option>
                  {settingsCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name} ({category.kind})</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleCreateProduct}
                disabled={createProductMutation.isPending || !setupProductName.trim()}
                className="mt-4 rounded-2xl bg-green-500 px-4 py-3 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              >
                Add Product/Service
              </button>
              <div className="mt-4 space-y-2">
                {settingsProducts.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <span className="font-semibold">{entry.name}</span>
                    <span className="ml-2 text-xs uppercase text-gray-500">{entry.type}</span>
                    {entry.defaultPrice ? <span className="ml-2 text-xs text-gray-500">Price: {formatCurrencyValue(entry.defaultPrice, activeCurrencyCode)}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {settingsSection === 'customers' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Customers</h2>
              <p className="mb-4 text-sm text-gray-500">Optional customer setup for debtor tracking and cleaner chat interpretation.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={setupCustomerName}
                  onChange={(event) => setSetupCustomerName(event.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupCustomerPhone}
                  onChange={(event) => setSetupCustomerPhone(event.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupCustomerOpening}
                  onChange={(event) => setSetupCustomerOpening(event.target.value)}
                  placeholder="Opening amount owed (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
              </div>
              <button
                onClick={handleCreateCustomer}
                disabled={createCustomerMutation.isPending || !setupCustomerName.trim()}
                className="mt-4 rounded-2xl bg-green-500 px-4 py-3 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              >
                Add Customer
              </button>
              <div className="mt-4 space-y-2">
                {settingsCustomers.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <span className="font-semibold">{entry.name}</span>
                    {entry.phoneNumber ? <span className="ml-2 text-xs text-gray-500">{entry.phoneNumber}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {settingsSection === 'suppliers' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Suppliers</h2>
              <p className="mb-4 text-sm text-gray-500">Optional supplier setup for payables and supplier-credit classifications.</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <input
                  value={setupSupplierName}
                  onChange={(event) => setSetupSupplierName(event.target.value)}
                  placeholder="Supplier name"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupSupplierPhone}
                  onChange={(event) => setSetupSupplierPhone(event.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupSupplierType}
                  onChange={(event) => setSetupSupplierType(event.target.value)}
                  placeholder="What they supply (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={setupSupplierOpening}
                  onChange={(event) => setSetupSupplierOpening(event.target.value)}
                  placeholder="Opening amount owed (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
              </div>
              <button
                onClick={handleCreateSupplier}
                disabled={createSupplierMutation.isPending || !setupSupplierName.trim()}
                className="mt-4 rounded-2xl bg-green-500 px-4 py-3 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              >
                Add Supplier
              </button>
              <div className="mt-4 space-y-2">
                {settingsSuppliers.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <span className="font-semibold">{entry.name}</span>
                    {entry.supplyType ? <span className="ml-2 text-xs text-gray-500">{entry.supplyType}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {settingsSection === 'ledger' && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Accounting Setup</h2>
                  <p className="text-sm text-gray-500">Default ledgers, monthly budgets, reconciliations, and journal visibility for this workspace.</p>
                </div>
                <button
                  onClick={() => void settingsLedgerAccountsQuery.refetch()}
                  disabled={settingsLedgerAccountsQuery.isFetching}
                  className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {settingsLedgerAccountsQuery.isFetching ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Active ledgers</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{settingsLedgerAccounts.length}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">System defaults</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {settingsLedgerAccounts.filter((entry) => entry.isSystemDefault).length}
                  </p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Custom ledgers</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {settingsLedgerAccounts.filter((entry) => !entry.isSystemDefault).length}
                  </p>
                </div>
              </div>

              <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold text-gray-900">Add Custom Ledger</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Create additional ledgers for this business without touching system defaults.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    value={customLedgerCode}
                    onChange={(event) => setCustomLedgerCode(event.target.value)}
                    placeholder="Code (e.g. 1150)"
                    className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                  />
                  <input
                    value={customLedgerName}
                    onChange={(event) => setCustomLedgerName(event.target.value)}
                    placeholder="Ledger name"
                    className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                  />
                  <select
                    value={customLedgerAccountType}
                    onChange={(event) => {
                      setCustomLedgerAccountType(event.target.value as typeof customLedgerAccountType);
                      setCustomLedgerParentId('');
                    }}
                    className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                  <select
                    value={customLedgerParentId}
                    onChange={(event) => setCustomLedgerParentId(event.target.value)}
                    className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                  >
                    <option value="">No parent</option>
                    {customLedgerParentCandidates.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.code} {entry.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => void handleCreateCustomLedger()}
                  disabled={createLedgerAccountMutation.isPending || !customLedgerCode.trim() || !customLedgerName.trim()}
                  className="mt-3 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {createLedgerAccountMutation.isPending ? 'Creating...' : 'Create Custom Ledger'}
                </button>
              </div>

              {editingLedger && (
                <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <h3 className="text-sm font-semibold text-gray-900">Edit Custom Ledger</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      value={editingLedgerCode}
                      onChange={(event) => setEditingLedgerCode(event.target.value)}
                      placeholder="Code"
                      className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                    />
                    <input
                      value={editingLedgerName}
                      onChange={(event) => setEditingLedgerName(event.target.value)}
                      placeholder="Ledger name"
                      className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                    />
                    <input
                      value={editingLedger.accountType}
                      disabled
                      className="w-full rounded-2xl border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-600"
                    />
                    <select
                      value={editingLedgerParentId}
                      onChange={(event) => setEditingLedgerParentId(event.target.value)}
                      className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                    >
                      <option value="">No parent</option>
                      {editingLedgerParentCandidates.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.code} {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleSaveLedgerEdit()}
                      disabled={updateLedgerAccountMutation.isPending || !editingLedgerCode.trim() || !editingLedgerName.trim()}
                      className="rounded-2xl bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {updateLedgerAccountMutation.isPending ? 'Saving...' : 'Save changes'}
                    </button>
                    <button
                      onClick={cancelLedgerEdit}
                      className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {settingsLedgerAccountsQuery.isLoading ? (
                <p className="text-sm text-gray-500">Loading accounting setup...</p>
              ) : settingsLedgerAccountsQuery.isError ? (
                <p className="text-sm text-red-600">Unable to load chart of accounts right now.</p>
              ) : groupedLedgerAccounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                  No ledger accounts found yet. Use `Load Defaults` in Business Profile to seed the default chart.
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedLedgerAccounts.map((group) => (
                    <div key={group.accountType} className="rounded-2xl border border-gray-200">
                      <div className="border-b border-gray-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{group.label}</h3>
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                            {group.accounts.length} account{group.accounts.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {group.accounts.map((account) => (
                          <div key={account.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[100px_1fr_auto] sm:items-center">
                            <p className="text-sm font-semibold text-gray-900">{account.code}</p>
                            <div>
                              <p className="text-sm text-gray-900">{account.name}</p>
                              <p className="text-xs text-gray-500">
                                {account.parentId ? 'Child ledger' : 'Primary ledger'}
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                account.isSystemDefault
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {account.isSystemDefault ? 'Default' : 'Custom'}
                              </span>
                              {!account.isSystemDefault && (
                                <>
                                  <button
                                    onClick={() => beginLedgerEdit(account)}
                                    className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => void handleDeactivateCustomLedger(account)}
                                    disabled={deactivateLedgerAccountMutation.isPending}
                                    className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    Deactivate
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This is the safe first release of accounting visibility. Posted journals now flow into a read-only balance sheet snapshot.
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Monthly Budget Target</h3>
                    <p className="text-sm text-gray-500">Keep revenue targets and expense limits inside the accounting workflow.</p>
                  </div>
                </div>

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

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <h4 className="text-sm font-semibold text-gray-900">Current monthly budgets</h4>
                  {budgets.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No budget targets set yet for this month.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {budgets.map((budget) => (
                        <div key={budget.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                          <p className="text-sm text-gray-500 capitalize">{budget.targetType} budget</p>
                          <p className="text-xl font-semibold text-gray-900">{formatCurrency(budget.amount)}</p>
                          {budget.category && <p className="text-sm text-gray-500">Category: {budget.category}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                  Set a monthly expense budget or revenue target and Akonta AI will watch your numbers while you record transactions.
                </div>
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-gray-900">Cash and MoMo Reconciliation</h3>
                  <p className="text-sm text-gray-500">Compare posted book balances against the actual cash counted or wallet balance observed right now.</p>
                </div>

                <label className="mb-4 block max-w-xs">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Reconciliation date</span>
                  <input
                    type="date"
                    value={reconciliationAsOfDate}
                    onChange={(event) => setReconciliationAsOfDate(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                  />
                </label>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Cash reconciliation</h4>
                        <p className="mt-1 text-xs text-gray-500">Book balance comes from ledger `1000 Cash`.</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${varianceTone(cashVariance)}`}>
                        {varianceLabel(cashVariance)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Book balance</p>
                        <p className="mt-2 text-xl font-bold text-gray-900">{formatCurrency(cashBookBalance)}</p>
                      </div>
                      <label className="rounded-2xl bg-gray-50 px-4 py-3">
                        <span className="text-xs uppercase tracking-wide text-gray-500">Actual counted cash</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashActualBalanceInput}
                          onChange={(event) => setCashActualBalanceInput(event.target.value)}
                          placeholder="Enter counted cash"
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-2xl border border-gray-200 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-gray-600">Variance</p>
                        <p className="text-sm font-bold text-gray-900">
                          {cashVariance === null ? '-' : formatCurrency(cashVariance)}
                        </p>
                      </div>
                    </div>

                    <label className="mt-3 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
                      <textarea
                        value={cashReconciliationNotes}
                        onChange={(event) => setCashReconciliationNotes(event.target.value)}
                        rows={3}
                        placeholder="Count notes, shortages, overages, or follow-up actions"
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      />
                    </label>

                    <button
                      onClick={() => void saveReconciliationSession('cash')}
                      disabled={createReconciliationSessionMutation.isPending}
                      className="mt-3 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {createReconciliationSessionMutation.isPending ? 'Saving...' : 'Save cash reconciliation'}
                    </button>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent cash-impact transactions</p>
                      <div className="mt-2 space-y-2">
                        {recentCashTransactions.length === 0 ? (
                          <p className="text-sm text-gray-500">No recent cash-impact transactions found.</p>
                        ) : (
                          recentCashTransactions.map((tx) => (
                            <div key={tx.id} className="rounded-2xl bg-gray-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{tx.eventType?.replace(/_/g, ' ') || tx.type}</p>
                                  <p className="text-xs text-gray-500">{formatDate(new Date(tx.date))}</p>
                                </div>
                                <button
                                  onClick={() => openTransactionDrilldown(tx.id)}
                                  className="text-xs font-semibold text-green-700 hover:text-green-800"
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saved cash reconciliations</p>
                      <div className="mt-2 space-y-2">
                        {recentCashReconciliationSessions.length === 0 ? (
                          <p className="text-sm text-gray-500">No saved cash reconciliations yet.</p>
                        ) : (
                          recentCashReconciliationSessions.map((session) => (
                            <div key={session.id} className="rounded-2xl bg-gray-50 px-3 py-3 text-sm text-gray-700">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-medium text-gray-900">{formatDate(new Date(session.asOf))}</p>
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${varianceTone(session.variance)}`}>
                                  {varianceLabel(session.variance)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                Book {formatCurrency(session.bookBalance)} • Counted {formatCurrency(session.countedBalance)}
                              </p>
                              {session.notes && <p className="mt-2 text-xs text-gray-600">{session.notes}</p>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">MoMo reconciliation</h4>
                        <p className="mt-1 text-xs text-gray-500">Book balance comes from ledger `1010 Mobile Money`.</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${varianceTone(momoVariance)}`}>
                        {varianceLabel(momoVariance)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-gray-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Book balance</p>
                        <p className="mt-2 text-xl font-bold text-gray-900">{formatCurrency(momoBookBalance)}</p>
                      </div>
                      <label className="rounded-2xl bg-gray-50 px-4 py-3">
                        <span className="text-xs uppercase tracking-wide text-gray-500">Actual wallet balance</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={momoActualBalanceInput}
                          onChange={(event) => setMomoActualBalanceInput(event.target.value)}
                          placeholder="Enter wallet balance"
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-2xl border border-gray-200 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-gray-600">Variance</p>
                        <p className="text-sm font-bold text-gray-900">
                          {momoVariance === null ? '-' : formatCurrency(momoVariance)}
                        </p>
                      </div>
                    </div>

                    <label className="mt-3 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
                      <textarea
                        value={momoReconciliationNotes}
                        onChange={(event) => setMomoReconciliationNotes(event.target.value)}
                        rows={3}
                        placeholder="Provider statement notes, pending transfers, or follow-up actions"
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      />
                    </label>

                    <button
                      onClick={() => void saveReconciliationSession('momo')}
                      disabled={createReconciliationSessionMutation.isPending}
                      className="mt-3 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {createReconciliationSessionMutation.isPending ? 'Saving...' : 'Save MoMo reconciliation'}
                    </button>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent MoMo-impact transactions</p>
                      <div className="mt-2 space-y-2">
                        {recentMomoTransactions.length === 0 ? (
                          <p className="text-sm text-gray-500">No recent MoMo transactions found.</p>
                        ) : (
                          recentMomoTransactions.map((tx) => (
                            <div key={tx.id} className="rounded-2xl bg-gray-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{tx.eventType?.replace(/_/g, ' ') || tx.type}</p>
                                  <p className="text-xs text-gray-500">{formatDate(new Date(tx.date))}</p>
                                </div>
                                <button
                                  onClick={() => openTransactionDrilldown(tx.id)}
                                  className="text-xs font-semibold text-green-700 hover:text-green-800"
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saved MoMo reconciliations</p>
                      <div className="mt-2 space-y-2">
                        {recentMomoReconciliationSessions.length === 0 ? (
                          <p className="text-sm text-gray-500">No saved MoMo reconciliations yet.</p>
                        ) : (
                          recentMomoReconciliationSessions.map((session) => (
                            <div key={session.id} className="rounded-2xl bg-gray-50 px-3 py-3 text-sm text-gray-700">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-medium text-gray-900">{formatDate(new Date(session.asOf))}</p>
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${varianceTone(session.variance)}`}>
                                  {varianceLabel(session.variance)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                Book {formatCurrency(session.bookBalance)} • Counted {formatCurrency(session.countedBalance)}
                              </p>
                              {session.notes && <p className="mt-2 text-xs text-gray-600">{session.notes}</p>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Posting Diagnostics</h3>
                    <p className="text-sm text-gray-500">Exceptions and review items that may stop the books from reflecting a transaction correctly.</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-2xl bg-amber-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-amber-700">Not configured</p>
                    <p className="mt-2 text-2xl font-bold text-amber-900">{ledgerDiagnosticCounts.notConfigured}</p>
                  </div>
                  <div className="rounded-2xl bg-rose-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-rose-700">Failed</p>
                    <p className="mt-2 text-2xl font-bold text-rose-900">{ledgerDiagnosticCounts.failed}</p>
                  </div>
                  <div className="rounded-2xl bg-gray-100 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-gray-600">Skipped</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{ledgerDiagnosticCounts.skipped}</p>
                  </div>
                  <div className="rounded-2xl bg-blue-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-blue-700">Pending</p>
                    <p className="mt-2 text-2xl font-bold text-blue-900">{ledgerDiagnosticCounts.pending}</p>
                  </div>
                  <div className="rounded-2xl bg-purple-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-purple-700">Needs review</p>
                    <p className="mt-2 text-2xl font-bold text-purple-900">{ledgerDiagnosticCounts.needsReview}</p>
                  </div>
                </div>

                {ledgerDiagnosticTransactions.length === 0 && ledgerDiagnosticCounts.needsReview === 0 ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                    No posting exceptions right now. Confirmed transactions are flowing into the journals as expected.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {ledgerDiagnosticTransactions.map((transaction) => (
                      <div key={transaction.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {transaction.category || transaction.eventType?.replace(/_/g, ' ') || transaction.type}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {formatDate(new Date(transaction.date))} • {formatCurrency(transaction.amount)}
                            </p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ledgerDiagnosticTone(transaction.ledgerPostingStatus)}`}>
                            {(transaction.ledgerPostingStatus ?? 'unknown').replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-gray-600">{describeLedgerDiagnostic(transaction)}</p>
                        <div className="mt-3">
                          <button
                            onClick={() => openTransactionDrilldown(transaction.id)}
                            className="text-xs font-semibold text-green-700 hover:text-green-800"
                          >
                            Open source transaction
                          </button>
                        </div>
                      </div>
                    ))}

                    {ledgerDiagnosticCounts.needsReview > 0 && (
                      <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-4 text-sm text-purple-900">
                        {ledgerDiagnosticCounts.needsReview} journal entr{ledgerDiagnosticCounts.needsReview === 1 ? 'y is' : 'ies are'} marked
                        {' '}`needs review`. These are posted but still deserve accounting attention because the source transaction was flagged for review.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-gray-900">Manual Ledger Entry</h3>
                  <p className="text-sm text-gray-500">
                    Post a direct double-entry adjustment, for example moving funds from MoMo to cash or capturing a skipped transaction.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Entry date</span>
                      <input
                        type="date"
                        value={manualJournalDate}
                        onChange={(event) => setManualJournalDate(event.target.value)}
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Description</span>
                      <input
                        value={manualJournalDescription}
                        onChange={(event) => setManualJournalDescription(event.target.value)}
                        placeholder="Fund transfer, correction, or adjustment"
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      />
                    </label>
                  </div>

                  <div className="mt-4 space-y-3">
                    {manualJournalLines.map((line, index) => (
                      <div key={line.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line {index + 1}</p>
                          {manualJournalLines.length > 2 && (
                            <button
                              onClick={() => removeManualJournalLine(line.id)}
                              className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <div className="mt-2 space-y-2">
                          <select
                            value={line.accountId}
                            onChange={(event) => updateManualJournalLine(line.id, 'accountId', event.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">Select account</option>
                            {settingsLedgerAccounts.filter((entry) => entry.isActive).map((entry) => (
                              <option key={entry.id} value={entry.id}>{entry.code} {entry.name}</option>
                            ))}
                          </select>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.debitAmount}
                              onChange={(event) => updateManualJournalLine(line.id, 'debitAmount', event.target.value)}
                              placeholder="Debit"
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.creditAmount}
                              onChange={(event) => updateManualJournalLine(line.id, 'creditAmount', event.target.value)}
                              placeholder="Credit"
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                          <input
                            value={line.memo}
                            onChange={(event) => updateManualJournalLine(line.id, 'memo', event.target.value)}
                            placeholder="Memo (optional)"
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={addManualJournalLine}
                      className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Add line
                    </button>
                  </div>

                  <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
                    Debits: <span className="font-semibold">{formatCurrency(manualJournalDebitTotal || 0)}</span>
                    {' '}• Credits: <span className="font-semibold">{formatCurrency(manualJournalCreditTotal || 0)}</span>
                    {' '}• Status:{' '}
                    <span className={`font-semibold ${
                      Math.abs(manualJournalDebitTotal - manualJournalCreditTotal) < 0.0001 && manualJournalDebitTotal > 0
                        ? 'text-green-700'
                        : 'text-amber-700'
                    }`}>
                      {Math.abs(manualJournalDebitTotal - manualJournalCreditTotal) < 0.0001 && manualJournalDebitTotal > 0
                        ? 'Balanced'
                        : 'Not balanced'}
                    </span>
                  </div>

                  <button
                    onClick={() => void handleCreateManualJournalEntry()}
                    disabled={createManualJournalEntryMutation.isPending}
                    className="mt-3 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {createManualJournalEntryMutation.isPending ? 'Posting...' : 'Post Manual Entry'}
                  </button>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Recent Journal Entries</h3>
                    <p className="text-sm text-gray-500">Auto-generated postings from confirmed transactions.</p>
                  </div>
                  <button
                    onClick={() => void settingsJournalEntriesQuery.refetch()}
                    disabled={settingsJournalEntriesQuery.isFetching}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {settingsJournalEntriesQuery.isFetching ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {settingsJournalEntriesQuery.isLoading ? (
                  <p className="text-sm text-gray-500">Loading journal entries...</p>
                ) : settingsJournalEntriesQuery.isError ? (
                  <p className="text-sm text-red-600">Unable to load journal entries right now.</p>
                ) : settingsJournalEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                    No journal entries yet. Confirm a transaction to generate accounting postings.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {settingsJournalEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-2xl border p-4 ${
                          focusedJournalEntryId === entry.id
                            ? 'border-green-400 bg-green-50 shadow-sm shadow-green-100'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{entry.description || 'Journal entry'}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {formatDate(new Date(entry.entryDate))}
                              {entry.transaction ? ` • ${entry.transaction.eventType.replace(/_/g, ' ')}` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              entry.status === 'posted'
                                ? 'bg-green-100 text-green-700'
                                : entry.status === 'needs_review'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-200 text-gray-700'
                            }`}>
                              {entry.status.replace(/_/g, ' ')}
                            </span>
                            {entry.transaction && (
                              <p className="mt-2 text-xs text-gray-500">
                                Tx {entry.transaction.ledgerPostingStatus}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {entry.lines.map((line) => (
                            <div key={line.id} className="rounded-xl bg-white px-3 py-2 text-xs text-gray-700">
                              {formatJournalLine(line)}
                            </div>
                          ))}
                        </div>
                        {entry.transaction && (
                          <div className="mt-3">
                            <button
                              onClick={() => openTransactionDrilldown(entry.transaction!.id)}
                              className="text-xs font-semibold text-green-700 hover:text-green-800"
                            >
                              Open source transaction
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {settingsSection === 'team' && (
          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Team Workspace</h2>
                <p className="text-sm text-gray-500">Invite teammates and manage who can access this business workspace.</p>
              </div>
              <button
                onClick={() => {
                  void workspaceMembersQuery.refetch();
                  void workspaceMembershipsQuery.refetch();
                }}
                className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>

            <div className="mb-4 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-800">Current role: </span>
              {activeWorkspaceMembership ? roleLabel[activeWorkspaceMembership.role] : 'Unknown'}
              {' · '}
              <span className="font-semibold text-gray-800">Workspace: </span>
              {activeWorkspaceMembership?.businessName ?? 'Not available'}
            </div>

            {workspaceMemberships.length > 1 && (
              <div className="mb-5 grid gap-2 rounded-2xl border border-gray-200 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Switch workspace</span>
                  <select
                    value={workspaceSelectionId}
                    onChange={(event) => setWorkspaceSelectionId(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm"
                  >
                    {workspaceMemberships.map((membership) => (
                      <option key={membership.membershipId} value={membership.businessId}>
                        {membership.businessName} ({roleLabel[membership.role]})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={handleWorkspaceSwitch}
                  disabled={
                    isSwitchingWorkspace
                    || !workspaceSelectionId
                    || workspaceSelectionId === activeWorkspaceMembership?.businessId
                  }
                  className="rounded-2xl border border-gray-300 bg-white px-4 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isSwitchingWorkspace ? 'Switching...' : 'Switch Workspace'}
                </button>
              </div>
            )}

            {canManageWorkspaceMembers ? (
              <div className="mb-5 grid gap-3 rounded-2xl border border-gray-200 p-4 sm:grid-cols-2">
                <input
                  value={teamInviteName}
                  onChange={(event) => setTeamInviteName(event.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <select
                  value={teamInviteRole}
                  onChange={(event) => setTeamInviteRole(event.target.value as WorkspaceRole)}
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                >
                  {inviteRoles.map((role) => (
                    <option key={role} value={role}>{roleLabel[role]}</option>
                  ))}
                </select>
                <input
                  value={teamInvitePhone}
                  onChange={(event) => setTeamInvitePhone(event.target.value)}
                  placeholder="Phone number (recommended)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <input
                  value={teamInviteEmail}
                  onChange={(event) => setTeamInviteEmail(event.target.value)}
                  placeholder="Email (optional)"
                  className="w-full rounded-2xl border-gray-200 bg-white px-4 py-3 text-sm"
                />
                <button
                  onClick={handleInviteWorkspaceMember}
                  disabled={inviteWorkspaceMemberMutation.isPending}
                  className="sm:col-span-2 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
                >
                  {inviteWorkspaceMemberMutation.isPending ? 'Sending invite...' : 'Invite Team Member'}
                </button>
              </div>
            ) : activeWorkspaceMembership?.role === 'owner' ? (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-semibold">Premium is required for multi-user workspace access.</p>
                <p className="mt-1">Upgrade to Premium to invite and manage team members.</p>
                <button
                  onClick={() => void handleStartCheckout('premium')}
                  disabled={isAnySettingsActionPending}
                  className="mt-3 rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {isStartingCheckout ? 'Redirecting...' : `Upgrade to Premium (${formatCurrencyValue(premiumMonthlyPrice, billingCurrencyCode)}/mo)`}
                </button>
              </div>
            ) : (
              <p className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Only workspace owners can invite or edit team members.
              </p>
            )}

            {workspaceMembersQuery.isLoading ? (
              <p className="text-sm text-gray-500">Loading team members...</p>
            ) : workspaceMembersQuery.isError ? (
              <p className="text-sm text-red-600">Unable to load workspace members.</p>
            ) : workspaceMembers.length === 0 ? (
              <p className="text-sm text-gray-500">No team members yet.</p>
            ) : (
              <div className="space-y-3">
                {workspaceMembers.map((member) => {
                  const roleDraft = teamRoleDrafts[member.membershipId] ?? member.role;
                  const canEditMember = canManageWorkspaceMembers && member.role !== 'owner';
                  const displayName = member.user.fullName || member.user.name;
                  return (
                    <div key={member.membershipId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{displayName}</p>
                          <p className="text-xs text-gray-500">{member.user.phoneNumber}</p>
                          {member.user.email && <p className="text-xs text-gray-500">{member.user.email}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{roleLabel[member.role]}</p>
                          <p className="text-xs text-gray-500">Status: {member.status}</p>
                        </div>
                      </div>
                      {canEditMember && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <select
                            value={roleDraft}
                            onChange={(event) => {
                              const nextRole = event.target.value as WorkspaceRole;
                              setTeamRoleDrafts((previous) => ({ ...previous, [member.membershipId]: nextRole }));
                            }}
                            className="w-full rounded-xl border-gray-200 bg-white px-3 py-2 text-xs"
                          >
                            {inviteRoles.map((role) => (
                              <option key={role} value={role}>{roleLabel[role]}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleWorkspaceRoleSave(member)}
                            disabled={updateWorkspaceMemberMutation.isPending || roleDraft === member.role}
                            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          >
                            Save Role
                          </button>
                          <button
                            onClick={() => handleWorkspaceStatusToggle(member)}
                            disabled={updateWorkspaceMemberMutation.isPending}
                            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {member.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {settingsSection === 'advanced' && (
          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Messaging Channels</h2>
                <p className="text-sm text-gray-500">Use both WhatsApp and Telegram for the same business account.</p>
              </div>
              <button
                onClick={handleRefreshTelegramLinkStatus}
                disabled={telegramStatusQuery.isFetching}
                className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {telegramStatusQuery.isFetching ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Web Chat</p>
                <p className="mt-2 text-sm font-semibold text-green-700">Active</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">WhatsApp</p>
                <p className={`mt-2 text-sm font-semibold ${hasPaidChannelAccess ? 'text-green-700' : 'text-amber-700'}`}>
                  {hasPaidChannelAccess ? 'Active on your plan' : 'Paid plans only (Basic/Premium)'}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Telegram</p>
                <p className={`mt-2 text-sm font-semibold ${isTelegramLinked ? 'text-green-700' : 'text-gray-700'}`}>
                  {isTelegramLinked ? 'Linked and active' : 'Not linked yet'}
                </p>
                {telegramStatus?.telegramUsername && (
                  <p className="mt-1 text-xs text-gray-500">@{telegramStatus.telegramUsername}</p>
                )}
              </div>
            </div>

            {!telegramStatus?.enabled && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Telegram bot is not configured on this environment yet. Set TELEGRAM_BOT_TOKEN on backend first.
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-sm font-semibold text-gray-900">Link Telegram to this account</p>
              <p className="mt-1 text-sm text-gray-600">
                In Telegram, start the Akonta bot and send the command below once:
              </p>
              <div className="mt-3 rounded-xl bg-gray-900 px-3 py-2 text-sm font-mono text-green-300">
                {telegramLinkCommand}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleCopyTelegramLinkCommand}
                  className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700"
                >
                  Copy /link Command
                </button>
                <button
                  onClick={handleRefreshTelegramLinkStatus}
                  disabled={telegramStatusQuery.isFetching}
                  className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Check Link Again
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              You can use both channels for one business. Each channel has its own chat thread, but all confirmed records go to the same workspace books.
            </div>
          </div>
          )}

          {settingsSection === 'advanced' && (
          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Referral rewards</h2>
                <p className="text-sm text-gray-500">Every 3 referral signups unlocks 1 extra month of Basic access.</p>
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
                  onClick={() => void handleStartCheckout('basic')}
                  disabled={isAnySettingsActionPending}
                  className="rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {isStartingCheckout ? 'Redirecting...' : `Start Basic (${formatCurrencyValue(basicMonthlyPrice, billingCurrencyCode)}/mo)`}
                </button>
                <button
                  onClick={() => void handleStartCheckout('premium')}
                  disabled={isAnySettingsActionPending}
                  className="rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isStartingCheckout ? 'Redirecting...' : `Upgrade Premium (${formatCurrencyValue(premiumMonthlyPrice, billingCurrencyCode)}/mo)`}
                </button>
                {user?.isSuperAdmin && (
                  <button
                    onClick={() => void handleManualPlanActivation('premium')}
                    disabled={isAnySettingsActionPending}
                    className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isActivatingPremium ? 'Saving...' : 'Manual Premium (Admin)'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {planEquivalentLabel.basic} · {planEquivalentLabel.premium}
              </p>
              {referralCopyMessage && <p className="mt-2 text-xs text-green-700">{referralCopyMessage}</p>}
            </div>
          </div>
          )}

        </div>

        <BottomNav />
      </div>
    );
  }

  return null;
}
