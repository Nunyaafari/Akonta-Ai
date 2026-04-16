import { useState, useEffect, useRef } from 'react';
import { AppView, User, ChatMessage, Transaction, SummaryPayload, WhatsAppProvider, Budget, BudgetTargetType, MonthlyInsights, PremiumInsight, ReferralProgress, AdminAnalytics } from './types';
import { 
  WhatsAppIcon, ChartIcon, HistoryIcon,
  SendIcon, TrendingUpIcon, TrendingDownIcon, HomeIcon, 
  CalendarIcon, ArrowLeftIcon, CheckIcon, ClockIcon, BellIcon, ChatIcon, SettingsIcon, ShieldIcon
} from './components/Icons';
import { 
  mockTransactions, currentWeekSummary, currentMonthSummary, 
  premiumInsights, chatMessages 
} from './data/mockData';
import SummaryChart from './components/SummaryChart';
import {
  activateUserSubscription,
  createUser,
  getAdminAnalytics,
  getAdminWhatsAppProvider,
  getCurrentBudgets,
  getCurrentInsights,
  getMonthlyInsights,
  getMonthlySummary,
  getReferralProgress,
  getTransactions,
  getWeeklySummary,
  postBudget,
  postChatEntry,
  registerDemoModeListener,
  setAdminWhatsAppProvider,
  updateUser
} from './lib/api';

// Format currency
const formatCurrencyValue = (amount: number, currencyCode = 'GHS') => {
  try {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
};

// Format date
const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('en-GH', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
};

// Format time
const formatTime = (date: Date) => {
  return new Date(date).toLocaleTimeString('en-GH', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
};

const brandLogoSrc = '/brand/fav.svg';
const brandMarkSrc = '/brand/fav.svg';
const appCopyrightNotice = `© ${new Date().getFullYear()} All rights reserved. Amagold Technologies Ltd.`;
const supportedCurrencies = ['GHS', 'USD', 'NGN', 'KES', 'EUR', 'GBP'] as const;

const defaultWeeklySummary: SummaryPayload = {
  totalRevenue: currentWeekSummary.totalRevenue,
  totalExpenses: currentWeekSummary.totalExpenses,
  profit: currentWeekSummary.profit,
  transactionCount: currentWeekSummary.transactionCount,
  categoryBreakdown: {},
  dailyBreakdown: currentWeekSummary.dailyBreakdown.map((day) => ({
    date: day.date.toISOString().slice(0, 10),
    revenue: day.revenue,
    expenses: day.expenses
  }))
};

const emptySummaryPayload: SummaryPayload = {
  totalRevenue: 0,
  totalExpenses: 0,
  profit: 0,
  transactionCount: 0,
  categoryBreakdown: {},
  dailyBreakdown: []
};

const createSummaryFromTransactions = (transactions: Transaction[]): SummaryPayload => {
  const categoryBreakdown: Record<string, { revenue: number; expense: number; total: number }> = {};
  const dailyMap: Record<string, { revenue: number; expenses: number }> = {};
  let totalRevenue = 0;
  let totalExpenses = 0;

  transactions.forEach((tx) => {
    if (tx.type === 'revenue') {
      totalRevenue += tx.amount;
    } else {
      totalExpenses += tx.amount;
    }

    const category = tx.category || 'Other';
    const categoryEntry = categoryBreakdown[category] ?? { revenue: 0, expense: 0, total: 0 };
    if (tx.type === 'revenue') {
      categoryEntry.revenue += tx.amount;
    } else {
      categoryEntry.expense += tx.amount;
    }
    categoryEntry.total = categoryEntry.revenue - categoryEntry.expense;
    categoryBreakdown[category] = categoryEntry;

    const txDate = new Date(tx.date);
    const dateKey = Number.isNaN(txDate.getTime())
      ? new Date().toISOString().slice(0, 10)
      : txDate.toISOString().slice(0, 10);
    const dailyEntry = dailyMap[dateKey] ?? { revenue: 0, expenses: 0 };
    if (tx.type === 'revenue') {
      dailyEntry.revenue += tx.amount;
    } else {
      dailyEntry.expenses += tx.amount;
    }
    dailyMap[dateKey] = dailyEntry;
  });

  return {
    totalRevenue,
    totalExpenses,
    profit: totalRevenue - totalExpenses,
    transactionCount: transactions.length,
    categoryBreakdown,
    dailyBreakdown: Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, revenue: values.revenue, expenses: values.expenses }))
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeFileName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

const buildProfitLossLines = (summary: SummaryPayload): {
  incomeLines: Array<{ label: string; amount: number }>;
  expenseLines: Array<{ label: string; amount: number }>;
} => {
  const entries = Object.entries(summary.categoryBreakdown);

  const incomeLines = entries
    .map(([category, values]) => ({ label: category, amount: values.revenue ?? 0 }))
    .filter((line) => line.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const expenseLines = entries
    .map(([category, values]) => ({ label: category, amount: values.expense ?? 0 }))
    .filter((line) => line.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  if (incomeLines.length === 0 && summary.totalRevenue > 0) {
    incomeLines.push({ label: 'Business Income', amount: summary.totalRevenue });
  }
  if (expenseLines.length === 0 && summary.totalExpenses > 0) {
    expenseLines.push({ label: 'Business Expenses', amount: summary.totalExpenses });
  }

  return { incomeLines, expenseLines };
};

type HistoryDatePreset = 'this_month' | 'last_month' | 'last_90_days' | 'all_time' | 'custom';

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages);
  const [inputValue, setInputValue] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions);
  const [weeklySummary, setWeeklySummary] = useState<SummaryPayload | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<SummaryPayload | null>(null);
  const [currentInsights, setCurrentInsights] = useState<MonthlyInsights | null>(null);
  const [reportMode, setReportMode] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedReportYear, setSelectedReportYear] = useState<number>(new Date().getUTCFullYear());
  const [selectedReportMonth, setSelectedReportMonth] = useState<number>(new Date().getUTCMonth() + 1);
  const [selectedReportSummary, setSelectedReportSummary] = useState<SummaryPayload | null>(null);
  const [selectedReportInsights, setSelectedReportInsights] = useState<MonthlyInsights | null>(null);
  const [reportSummaryCache, setReportSummaryCache] = useState<Record<string, SummaryPayload>>({});
  const [reportInsightsCache, setReportInsightsCache] = useState<Record<string, MonthlyInsights>>({});
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'reports'>('overview');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [referralProgress, setReferralProgress] = useState<ReferralProgress | null>(null);
  const [isReferralLoading, setIsReferralLoading] = useState(false);
  const [referralCopyMessage, setReferralCopyMessage] = useState<string | null>(null);
  const [adminAnalytics, setAdminAnalytics] = useState<AdminAnalytics | null>(null);
  const [adminProviderInfo, setAdminProviderInfo] = useState<{ provider: WhatsAppProvider; available: WhatsAppProvider[] } | null>(null);
  const [isAdminSaving, setIsAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [budgetTargetType, setBudgetTargetType] = useState<BudgetTargetType>('expense');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botContext, setBotContext] = useState<{ customer?: string; objective?: string; revenueTarget?: number; expenseTarget?: number; cashBalance?: number; cashSales?: number; momoSales?: number; creditSales?: number; debtRecovery?: number; expenseCategory?: string; personalExpense?: number; salesAmount?: number; expenseAmount?: number; closingBalance?: number }>({});
  const [followUpStep, setFollowUpStep] = useState<'customer' | 'targets' | 'cash' | 'sales' | 'salesBreakdown' | 'debtRecovery' | 'expense' | 'expenseCategory' | 'supportingDoc' | 'confirmRecord' | 'closingBalance' | 'confirmImpact' | null>(null);
  const [impactTransaction, setImpactTransaction] = useState<Transaction | null>(null);
  const [supportTransaction, setSupportTransaction] = useState<Transaction | null>(null);
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

  const activeCurrencyCode = user?.currencyCode ?? 'GHS';
  const formatCurrency = (amount: number) => formatCurrencyValue(amount, activeCurrencyCode);
  
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

  const activeWeeklySummary = weeklySummary ?? defaultWeeklySummary;
  const activeMonthlySummary = monthlySummary ?? {
    totalRevenue: currentMonthSummary.totalRevenue,
    totalExpenses: currentMonthSummary.totalExpenses,
    profit: currentMonthSummary.profit,
    transactionCount: currentMonthSummary.transactionCount,
    categoryBreakdown: {},
    dailyBreakdown: []
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

  const dashboardTopExpenseCategories = Object.keys(activeMonthlySummary.categoryBreakdown).length
    ? Object.entries(activeMonthlySummary.categoryBreakdown)
        .map(([category, values]) => ({
          category,
          amount: values.expense ?? values.total ?? 0
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    : currentMonthSummary.topExpenseCategories;

  const reportTopExpenseCategories = Object.entries(activeReportSummary.categoryBreakdown)
    .map(([category, values]) => ({
      category,
      amount: values.expense ?? values.total ?? 0
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const { incomeLines, expenseLines } = buildProfitLossLines(activeReportSummary);
  const netMargin = activeReportSummary.totalRevenue > 0
    ? (activeReportSummary.profit / activeReportSummary.totalRevenue) * 100
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
    : activeReportSummary.profit >= 0
      ? 'The business remained profitable in the selected year. Maintain controls on expense-heavy categories.'
      : 'The selected year shows a loss position. Review pricing, sales mix, and controllable expenses.'
  const statementPeriodKey = reportMode === 'yearly'
    ? `${selectedReportYear}`
    : `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
  const statementBusinessKey = sanitizeFileName(user?.businessName ?? 'akonta-ai');

  const buildProfitLossStatementHtml = () => {
    const businessName = user?.businessName || 'Akonta AI Business';
    const ownerName = user?.name || 'Business Owner';
    const preparedOn = new Date().toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' });
    const incomeRows = incomeLines.length > 0
      ? incomeLines.map((line) => `
        <tr>
          <td>${escapeHtml(line.label)}</td>
          <td class="amount">${formatCurrency(line.amount)}</td>
        </tr>
      `).join('')
      : `
        <tr>
          <td>No income recorded</td>
          <td class="amount">${formatCurrency(0)}</td>
        </tr>
      `;
    const expenseRows = expenseLines.length > 0
      ? expenseLines.map((line) => `
        <tr class="expense-line">
          <td>${escapeHtml(line.label)}</td>
          <td class="amount">${formatCurrency(line.amount)}</td>
        </tr>
      `).join('')
      : `
        <tr>
          <td>No expenses recorded</td>
          <td class="amount">${formatCurrency(0)}</td>
        </tr>
      `;

    return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Profit and Loss Statement</title>
  <style>
    body { font-family: "Times New Roman", Georgia, serif; color: #111827; margin: 40px; }
    .sheet { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 30px; margin: 0; letter-spacing: 0.02em; text-transform: uppercase; }
    h2 { margin: 8px 0 0; font-size: 16px; font-weight: 500; color: #374151; }
    .meta { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
    .label { color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; display: block; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
    thead th { text-align: left; border-bottom: 2px solid #111827; padding: 8px 0; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: #4b5563; }
    tbody td { border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
    .expense-line td:first-child { padding-left: 22px; }
    td.amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .section { margin-top: 22px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; font-weight: 700; }
    .totals tr td { font-weight: 700; border-bottom: 0; padding-top: 10px; }
    .net-profit { color: ${activeReportSummary.profit >= 0 ? '#047857' : '#b91c1c'}; }
    .review { margin-top: 20px; border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; background: #f9fafb; font-size: 13px; line-height: 1.5; }
    .review .label { margin-bottom: 6px; }
    .sign-grid { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .sign-card { border-top: 1px solid #111827; padding-top: 8px; }
    .sign-name { font-size: 13px; font-weight: 600; }
    .sign-role { font-size: 12px; color: #6b7280; margin-top: 3px; }
    .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
    @page { size: A4; margin: 18mm; }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Profit and Loss Statement</h1>
    <h2>${escapeHtml(reportStatementSubtitle)}</h2>

    <div class="meta">
      <div><span class="label">Business</span>${escapeHtml(businessName)}</div>
      <div><span class="label">Prepared For</span>${escapeHtml(ownerName)}</div>
      <div><span class="label">Reporting Period</span>${escapeHtml(reportPeriodLabel)}</div>
      <div><span class="label">Statement Basis</span>${escapeHtml(reportMode === 'yearly' ? 'Annual Management Statement' : 'Monthly Management Statement')}</div>
      <div><span class="label">Prepared By</span>${escapeHtml(statementPreparedBy)}</div>
      <div><span class="label">Prepared On</span>${escapeHtml(preparedOn)}</div>
    </div>

    <div class="section">Income</div>
    <table>
      <thead>
        <tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr>
      </thead>
      <tbody>
        ${incomeRows}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Income</td><td class="amount">${formatCurrency(activeReportSummary.totalRevenue)}</td></tr>
      </tbody>
    </table>

    <div class="section">Less: Business Expenses</div>
    <table>
      <thead>
        <tr><th>Account</th><th class="amount">Amount (${escapeHtml(activeCurrencyCode)})</th></tr>
      </thead>
      <tbody>
        ${expenseRows}
      </tbody>
      <tbody class="totals">
        <tr><td>Total Expenses</td><td class="amount">${formatCurrency(activeReportSummary.totalExpenses)}</td></tr>
      </tbody>
    </table>

    <table>
      <tbody class="totals">
        <tr class="net-profit"><td>Net Profit / (Loss)</td><td class="amount">${formatCurrency(activeReportSummary.profit)}</td></tr>
        <tr><td>Net Margin</td><td class="amount">${activeReportSummary.totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : 'N/A'}</td></tr>
      </tbody>
    </table>

    <div class="review">
      <span class="label">Accountant Review Note</span>
      ${escapeHtml(accountantReviewNote)}
    </div>

    <div class="sign-grid">
      <div class="sign-card">
        <div class="sign-name">${escapeHtml(statementPreparedBy)}</div>
        <div class="sign-role">Prepared by</div>
      </div>
      <div class="sign-card">
        <div class="sign-name">${escapeHtml(ownerName)}</div>
        <div class="sign-role">Reviewed/Approved by</div>
      </div>
    </div>

    <p class="footer">Generated by Akonta AI accounting workflow engine for ${escapeHtml(reportPeriodLabel)}. ${escapeHtml(appCopyrightNotice)}</p>
  </div>
</body>
</html>
    `.trim();
  };

  const handlePrintProfitLoss = () => {
    const statementHtml = buildProfitLossStatementHtml();
    const blob = new Blob([statementHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';

    const cleanup = () => {
      URL.revokeObjectURL(url);
      iframe.remove();
    };

    iframe.onload = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }

      frameWindow.onafterprint = cleanup;
      frameWindow.focus();
      setTimeout(() => {
        frameWindow.print();
        setTimeout(cleanup, 1500);
      }, 80);
    };

    iframe.src = url;
    document.body.appendChild(iframe);
  };

  const handleDownloadProfitLoss = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 48;
      const rightEdge = pageWidth - margin;
      let cursorY = margin;

      const ensureSpace = (heightNeeded: number) => {
        if (cursorY + heightNeeded <= pageHeight - margin) return;
        doc.addPage();
        cursorY = margin;
      };

      const drawRows = (rows: Array<{ label: string; amount: number }>, labelIndent = 0) => {
        rows.forEach((row) => {
          const wrappedLabel = doc.splitTextToSize(row.label, rightEdge - (margin + labelIndent) - 130);
          const rowHeight = Math.max(14, wrappedLabel.length * 12);
          ensureSpace(rowHeight + 4);
          doc.setFont('times', 'normal');
          doc.setFontSize(10);
          doc.text(wrappedLabel, margin + labelIndent, cursorY);
          doc.text(formatCurrency(row.amount), rightEdge, cursorY, { align: 'right' });
          cursorY += rowHeight;
        });
      };

      const renderSection = (
        title: string,
        rows: Array<{ label: string; amount: number }>,
        emptyLabel: string,
        totalLabel: string,
        totalAmount: number,
        options?: { indentRows?: boolean }
      ) => {
        ensureSpace(54);
        doc.setFont('times', 'bold');
        doc.setFontSize(11);
        doc.text(title.toUpperCase(), margin, cursorY);
        cursorY += 10;
        doc.line(margin, cursorY, rightEdge, cursorY);
        cursorY += 16;
        drawRows(rows.length > 0 ? rows : [{ label: emptyLabel, amount: 0 }], options?.indentRows ? 16 : 0);
        ensureSpace(22);
        doc.line(margin, cursorY, rightEdge, cursorY);
        cursorY += 14;
        doc.setFont('times', 'bold');
        doc.text(totalLabel, margin, cursorY);
        doc.text(formatCurrency(totalAmount), rightEdge, cursorY, { align: 'right' });
        cursorY += 24;
      };

      doc.setFont('times', 'bold');
      doc.setFontSize(24);
      doc.text('Profit and Loss Statement', margin, cursorY);
      cursorY += 26;

      doc.setFont('times', 'normal');
      doc.setFontSize(12);
      doc.text(reportStatementSubtitle, margin, cursorY);
      cursorY += 24;

      const metadata: Array<[string, string]> = [
        ['Business', user?.businessName || 'Akonta AI Business'],
        ['Prepared For', user?.name || 'Business Owner'],
        ['Reporting Period', reportPeriodLabel],
        ['Statement Basis', reportMode === 'yearly' ? 'Annual Management Statement' : 'Monthly Management Statement'],
        ['Prepared By', statementPreparedBy],
        ['Prepared On', new Date().toLocaleDateString('en-GH', { month: 'long', day: 'numeric', year: 'numeric' })]
      ];

      metadata.forEach(([label, value]) => {
        ensureSpace(20);
        doc.setFont('times', 'bold');
        doc.setFontSize(10);
        doc.text(`${label}:`, margin, cursorY);
        doc.setFont('times', 'normal');
        const wrapped = doc.splitTextToSize(value, rightEdge - (margin + 115));
        doc.text(wrapped, margin + 115, cursorY);
        cursorY += Math.max(16, wrapped.length * 12);
      });

      cursorY += 8;
      renderSection('Income', incomeLines, 'No income recorded', 'Total Income', activeReportSummary.totalRevenue);
      renderSection(
        'Less: Business Expenses',
        expenseLines,
        'No expenses recorded',
        'Total Expenses',
        activeReportSummary.totalExpenses,
        { indentRows: true }
      );

      ensureSpace(30);
      doc.line(margin, cursorY, rightEdge, cursorY);
      cursorY += 14;
      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text('Net Profit / (Loss)', margin, cursorY);
      doc.text(formatCurrency(activeReportSummary.profit), rightEdge, cursorY, { align: 'right' });
      cursorY += 16;
      doc.setFont('times', 'normal');
      doc.setFontSize(10);
      doc.text(`Net Margin: ${activeReportSummary.totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : 'N/A'}`, margin, cursorY);
      cursorY += 24;

      ensureSpace(58);
      doc.setFont('times', 'bold');
      doc.setFontSize(10);
      doc.text('Accountant Review Note', margin, cursorY);
      cursorY += 14;
      doc.setFont('times', 'normal');
      const reviewLines = doc.splitTextToSize(accountantReviewNote, rightEdge - margin);
      doc.text(reviewLines, margin, cursorY);
      cursorY += Math.max(20, reviewLines.length * 12 + 10);

      ensureSpace(22);
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      const footerText = `Generated by Akonta AI accounting workflow engine for ${reportPeriodLabel}. ${appCopyrightNotice}`;
      const footerLines = doc.splitTextToSize(footerText, rightEdge - margin);
      doc.text(footerLines, margin, cursorY);
      doc.setTextColor(17, 24, 39);

      doc.save(`${statementBusinessKey}-profit-loss-${statementPeriodKey}.pdf`);
    } catch (error) {
      console.error('Unable to generate PDF statement. Falling back to print.', error);
      handlePrintProfitLoss();
    }
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
      const referral = await getReferralProgress(user.id);
      setReferralProgress(referral);
    } catch (error) {
      console.error('Unable to refresh referral progress', error);
    } finally {
      setIsReferralLoading(false);
    }
  };

  const copyReferralLink = async () => {
    if (!referralProgress?.referralLink) return;
    try {
      await navigator.clipboard.writeText(referralProgress.referralLink);
      setReferralCopyMessage('Referral link copied.');
    } catch {
      setReferralCopyMessage('Unable to copy automatically. Please copy it manually.');
    }
    setTimeout(() => setReferralCopyMessage(null), 2400);
  };

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

  const premiumInsightCards: PremiumInsight[] = currentInsights
    ? [
        currentInsights.targetStatus.revenueGapToDate === undefined
          ? {
              id: 'target-missing',
              type: 'recommendation',
              title: 'Set revenue targets',
              message: 'Add monthly revenue and expense targets in Settings so Akonta AI can track your pace.',
              icon: '🎯'
            }
          : currentInsights.targetStatus.revenueStatus === 'behind'
            ? {
                id: 'target-behind',
                type: 'warning',
                title: 'Revenue behind target pace',
                message: `You are behind by ${formatCurrency(Math.abs(currentInsights.targetStatus.revenueGapToDate))} month-to-date.`,
                icon: '⚠️'
              }
            : {
                id: 'target-on-track',
                type: 'insight',
                title: 'Revenue pace is healthy',
                message: currentInsights.targetStatus.revenueStatus === 'ahead'
                  ? `You are ahead of pace by ${formatCurrency(currentInsights.targetStatus.revenueGapToDate ?? 0)}.`
                  : 'You are tracking close to your target pace this month.',
                icon: '📈'
              },
        currentInsights.expenseOverrun.isOverrun
          ? {
              id: 'expense-overrun',
              type: 'warning',
              title: 'Expense pace needs attention',
              message: currentInsights.expenseOverrun.varianceByNow !== undefined && currentInsights.expenseOverrun.varianceByNow > 0
                ? `Expenses are above expected pace by ${formatCurrency(currentInsights.expenseOverrun.varianceByNow)}.`
                : 'One or more categories are running above budget.',
              icon: '💸'
            }
          : {
              id: 'expense-ok',
              type: 'insight',
              title: 'Expense control is stable',
              message: 'Your expenses are within expected monthly pace so far.',
              icon: '✅'
            },
        {
          id: 'credit-readiness',
          type: currentInsights.creditReadiness.level === 'poor' || currentInsights.creditReadiness.level === 'fair'
            ? 'recommendation'
            : 'insight',
          title: `Credit readiness: ${currentInsights.creditReadiness.score}/100`,
          message: currentInsights.creditReadiness.level === 'strong'
            ? 'Your records look lender-ready. Keep this consistency.'
            : 'Keep daily records complete and categorized to improve loan readiness.',
          icon: currentInsights.creditReadiness.level === 'strong' ? '🏦' : '🧾'
        },
        {
          id: 'top-highlight',
          type: 'insight',
          title: 'Accountant note',
          message: currentInsights.highlights[0] ?? 'Your records are on track this month.',
          icon: '🧠'
        }
      ]
    : premiumInsights;

  const premiumExpenseCategories = currentInsights?.expenseOverrun.topExpenseCategories?.length
    ? currentInsights.expenseOverrun.topExpenseCategories
    : dashboardTopExpenseCategories;

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
    if (!user) {
      setCurrentInsights(null);
      return;
    }

    const cachedMessages = window.localStorage.getItem(`akontaai-chat-${user.id}`);
    if (cachedMessages) {
      try {
        const parsedMessages = JSON.parse(cachedMessages) as ChatMessage[];
        setMessages(parsedMessages.map((msg) => ({ ...msg, timestamp: new Date(msg.timestamp) })));
      } catch (error) {
        console.error('Unable to restore chat messages', error);
      }
    }

    const loadAppData = async () => {
      try {
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(now);
        weekEnd.setHours(23, 59, 59, 999);

        const [txs, weekly, monthly, insights, referral] = await Promise.all([
          getTransactions(user.id),
          getWeeklySummary(
            user.id,
            weekStart.toISOString().slice(0, 10),
            weekEnd.toISOString().slice(0, 10)
          ),
          getMonthlySummary(user.id, now.getUTCFullYear(), now.getUTCMonth() + 1),
          getCurrentInsights(user.id),
          getReferralProgress(user.id)
        ]);

        setTransactions(txs);
        setWeeklySummary(weekly.summary);
        setMonthlySummary(monthly.summary);
        setCurrentInsights(insights);
        setReferralProgress(referral);
        const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        setReportSummaryCache((prev) => ({ ...prev, [currentKey]: monthly.summary }));
        setReportInsightsCache((prev) => ({ ...prev, [currentKey]: insights }));
      } catch (err) {
        console.error('Failed to load app data', err);
      }
    };

    loadAppData();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSelectedReportSummary(null);
      setSelectedReportInsights(null);
      return;
    }

    let cancelled = false;

    const loadReportSummary = async () => {
      if (reportMode === 'yearly') {
        setSelectedReportSummary(null);
        setSelectedReportInsights(null);
        return;
      }
      const selectedKey = `${selectedReportYear}-${String(selectedReportMonth).padStart(2, '0')}`;
      setSelectedReportSummary(reportSummaryCache[selectedKey] ?? null);
      setSelectedReportInsights(reportInsightsCache[selectedKey] ?? null);

      try {
        const [monthly, insights] = await Promise.all([
          getMonthlySummary(user.id, selectedReportYear, selectedReportMonth),
          getMonthlyInsights(user.id, selectedReportYear, selectedReportMonth)
        ]);
        if (!cancelled) {
          setSelectedReportSummary(monthly.summary);
          setSelectedReportInsights(insights);
          setReportSummaryCache((prev) => ({ ...prev, [selectedKey]: monthly.summary }));
          setReportInsightsCache((prev) => ({ ...prev, [selectedKey]: insights }));
        }
      } catch (err) {
        console.error('Failed to load selected report summary', err);
        if (!cancelled) {
          if (!reportSummaryCache[selectedKey]) {
            setSelectedReportSummary(null);
          }
          if (!reportInsightsCache[selectedKey]) {
            setSelectedReportInsights(null);
          }
        }
      }
    };

    loadReportSummary();

    return () => {
      cancelled = true;
    };
  }, [user, reportMode, selectedReportYear, selectedReportMonth]);

  useEffect(() => {
    registerDemoModeListener(() => setIsDemoMode(true));

    const loadBudgets = async () => {
      if (!user) return;
      try {
        const currentBudgets = await getCurrentBudgets(user.id);
        setBudgets(currentBudgets);
        const expenseBudget = currentBudgets.find((budget) => budget.targetType === 'expense');
        if (expenseBudget) {
          setBudgetTargetType('expense');
          setBudgetAmount(expenseBudget.amount.toString());
        }
      } catch (error) {
        console.error('Unable to load current budgets', error);
      }
    };

    loadBudgets();
  }, [user]);

  useEffect(() => {
    if (!user?.isSuperAdmin) {
      setAdminAnalytics(null);
      setAdminProviderInfo(null);
      return;
    }

    let cancelled = false;
    const loadAdminData = async () => {
      try {
        const [analytics, provider] = await Promise.all([
          getAdminAnalytics(),
          getAdminWhatsAppProvider()
        ]);
        if (!cancelled) {
          setAdminAnalytics(analytics);
          setAdminProviderInfo(provider);
          setAdminError(null);
        }
      } catch (error) {
        console.error('Unable to load admin data', error);
        if (!cancelled) {
          setAdminError('Unable to load admin analytics right now.');
        }
      }
    };

    loadAdminData();

    return () => {
      cancelled = true;
    };
  }, [user]);

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
      setDashboardTab('reports');
      setView('dashboard');
    }
  }, [view]);

  // Landing Page
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
        {/* Header */}
        <header className="px-4 py-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={brandLogoSrc} alt="Akonta AI logo" className="h-10 w-auto object-contain" />
              <span className="text-xl font-bold text-gray-900">Akonta AI</span>
            </div>
            <button 
              onClick={() => setView('onboarding')}
              className="px-4 py-2 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 transition-colors"
            >
              Get Started
            </button>
          </div>
        </header>

        {/* Hero */}
        <main className="px-4 pt-12 pb-20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <WhatsAppIcon size={16} className="text-green-600" />
                Web Chat + WhatsApp
              </div>

              <div className="relative mb-8 overflow-hidden rounded-[2rem] border border-green-100 bg-white/80 p-8 shadow-2xl shadow-green-100">
                <div className="flex flex-col items-center justify-center gap-3 text-center">
                  <p className="text-3xl md:text-4xl font-semibold text-gray-900">{heroSlides[heroSlide].title}</p>
                  <p className="text-4xl md:text-5xl font-bold text-green-600">{heroSlides[heroSlide].subtitle}</p>
                  <p className="max-w-2xl text-base md:text-lg text-gray-600 leading-relaxed">
                    No complex spreadsheets. No accounting jargon. Just chat to track your business finances, get insights, and grow your business.
                  </p>
                </div>

                <div className="mt-6 flex justify-center gap-2">
                  {heroSlides.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setHeroSlide(index)}
                      className={`h-2.5 w-2.5 rounded-full transition-all ${
                        heroSlide === index ? 'bg-green-600 w-8' : 'bg-gray-200 w-2.5'
                      }`}
                      aria-label={`Slide ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <button 
                  onClick={() => setView('onboarding')}
                  className="px-8 py-4 bg-green-500 text-white rounded-2xl font-semibold text-lg hover:bg-green-600 transition-all shadow-lg shadow-green-200 flex items-center justify-center gap-2"
                >
                  <WhatsAppIcon size={20} />
                  Get Started
                </button>
                <button 
                  onClick={() => setView('dashboard')}
                  className="px-8 py-4 bg-white text-gray-700 rounded-2xl font-semibold text-lg hover:bg-gray-50 transition-all border border-gray-200"
                >
                  View Demo
                </button>
              </div>
            </div>

            {/* Chat + P&L Preview */}
            <div className="mx-auto mt-2 grid max-w-5xl gap-6 lg:grid-cols-2">
              <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 overflow-hidden border border-gray-100">
                <div className="bg-green-600 px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5">
                    <img src={brandMarkSrc} alt="Akonta AI logo mark" className="h-full w-full object-contain" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">Akonta AI Chatflow</p>
                    <p className="text-green-100 text-xs">Online</p>
                  </div>
                </div>
                <div className="p-4 space-y-3 bg-gray-50 min-h-[300px]">
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">Good morning! ☀️ How much money inflow came in today?</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-green-500 rounded-2xl rounded-tr-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-white">I made 4500</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">Recorded draft inflow: GHS 4500. What type was this? Reply with 1-6.</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-green-500 rounded-2xl rounded-tr-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-white">2</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">Saved. Entries are confirmed and your statement is updated.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 border border-gray-100 p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-gray-900">Profit & Loss Statement</p>
                </div>

                <div className="rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">Business Profit & Loss</p>
                    <p className="text-xs text-gray-500">For the month ended April 2026</p>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Income</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center justify-between"><span className="text-gray-700">Cash sales</span><span className="font-medium text-gray-900">GHS 4,500</span></div>
                        <div className="flex items-center justify-between"><span className="text-gray-700">MoMo sales</span><span className="font-medium text-gray-900">GHS 1,800</span></div>
                        <div className="flex items-center justify-between"><span className="text-gray-700">Debtor recovery</span><span className="font-medium text-gray-900">GHS 700</span></div>
                      </div>
                      <div className="mt-2 border-t border-dashed border-gray-300 pt-2 flex items-center justify-between text-sm font-semibold">
                        <span>Total Income</span><span>GHS 7,000</span>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Less: Business Expenses</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center justify-between"><span className="pl-3 text-gray-700">Stock purchase</span><span className="font-medium text-gray-900">GHS 3,200</span></div>
                        <div className="flex items-center justify-between"><span className="pl-3 text-gray-700">Operating expense</span><span className="font-medium text-gray-900">GHS 1,100</span></div>
                        <div className="flex items-center justify-between"><span className="pl-3 text-gray-700">Owner withdrawal</span><span className="font-medium text-gray-900">GHS 650</span></div>
                      </div>
                      <div className="mt-2 border-t border-dashed border-gray-300 pt-2 flex items-center justify-between text-sm font-semibold">
                        <span>Total Expenses</span><span>GHS 4,950</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-green-50 border-t border-green-200 px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">Net Profit</span>
                    <span className="text-base font-bold text-green-700">GHS 2,050</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-6 mt-20">
              <div className="bg-white rounded-2xl p-6 shadow-lg shadow-gray-100 border border-gray-100">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                  <ChatIcon className="text-green-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Chat to Track</h3>
                <p className="text-gray-600">Log sales and expenses by simply messaging. Works with both web chat and WhatsApp.</p>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-lg shadow-gray-100 border border-gray-100">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                  <CalendarIcon className="text-blue-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Daily Reminders</h3>
                <p className="text-gray-600">Never forget to log your numbers. Get friendly prompts at your preferred time.</p>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-lg shadow-gray-100 border border-gray-100">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
                  <ChartIcon className="text-purple-600" size={24} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Smart Insights</h3>
                <p className="text-gray-600">Get weekly summaries and AI-powered recommendations for your business.</p>
              </div>
            </div>

            {/* Pricing */}
            <div className="mt-20 grid gap-6 md:grid-cols-2">
              <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">Free Plan</p>
                    <p className="text-sm text-gray-500">Perfect for starting out.</p>
                  </div>
                </div>
                <div className="py-8 text-center">
                  <p className="text-5xl font-bold text-gray-900">¢0</p>
                  <p className="text-sm text-gray-500">/mo</p>
                </div>
                <div className="space-y-3 mb-6 text-sm text-gray-600">
                  <p>✅ Daily logging via WhatsApp</p>
                  <p>✅ Weekly summaries</p>
                  <p>✅ Monthly summaries</p>
                </div>
                <button
                  onClick={() => setView('onboarding')}
                  className="w-full py-4 rounded-2xl border border-green-500 text-green-600 font-semibold hover:bg-green-50 transition-colors"
                >
                  Get Started
                </button>
              </div>
              <div className="bg-white rounded-3xl border border-green-500 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">Premium Plan</p>
                    <p className="text-sm text-gray-500">For growing businesses.</p>
                  </div>
                  <span className="rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white">Most Popular</span>
                </div>
                <div className="py-8 text-center">
                  <p className="text-5xl font-bold text-gray-900">¢50</p>
                  <p className="text-sm text-gray-500">/mo</p>
                </div>
                <div className="space-y-3 mb-6 text-sm text-gray-600">
                  <p>✅ Everything in Free</p>
                  <p>✅ Advanced AI insights</p>
                  <p>✅ Expense breakdown</p>
                  <p>✅ Cash flow warnings</p>
                  <p>✅ Downloadable PDF reports</p>
                </div>
                <button
                  onClick={() => setView('onboarding')}
                  className="w-full py-4 rounded-2xl bg-green-500 text-white font-semibold hover:bg-green-600 transition-colors"
                >
                  Start Free Trial
                </button>
              </div>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Premium Insights Preview</h2>
                <div className="space-y-3">
                  {premiumInsightCards.slice(0, 3).map((insight) => (
                    <div key={insight.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{insight.icon}</span>
                        <div>
                          <p className="font-semibold text-gray-900">{insight.title}</p>
                          <p className="text-sm text-gray-600">{insight.message}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Premium Expense Breakdown</h2>
                <div className="space-y-3">
                  {premiumExpenseCategories.slice(0, 5).map((cat, i) => {
                    const percentage = activeMonthlySummary.totalExpenses > 0
                      ? (cat.amount / activeMonthlySummary.totalExpenses) * 100
                      : 0;
                    const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500'];
                    return (
                      <div key={cat.category}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-gray-600">{cat.category}</span>
                          <span className="font-medium text-gray-900">{formatCurrency(cat.amount)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full ${colors[i]} rounded-full`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => setView('onboarding')}
                  className="mt-6 w-full rounded-2xl bg-green-500 py-3 text-sm font-semibold text-white hover:bg-green-600 transition-colors"
                >
                  Start Premium Trial
                </button>
              </div>
            </div>

            {/* Social Proof */}
            <div className="mt-20 text-center">
              <p className="text-gray-500 mb-4">Trusted by small business owners</p>
              <div className="flex justify-center gap-8 items-center flex-wrap">
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900">2,000+</p>
                  <p className="text-gray-500 text-sm">Active Users</p>
                </div>
                <div className="w-px h-12 bg-gray-200 hidden sm:block"></div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900">GHS 2.5M+</p>
                  <p className="text-gray-500 text-sm">Transactions Tracked</p>
                </div>
                <div className="w-px h-12 bg-gray-200 hidden sm:block"></div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900">40%</p>
                  <p className="text-gray-500 text-sm">Daily Response Rate</p>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-200 py-8 px-4">
          <div className="max-w-6xl mx-auto text-center text-gray-500 text-sm">
            <p>{appCopyrightNotice}</p>
          </div>
        </footer>
      </div>
    );
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

      setIsSaving(true);
      setError(null);

      try {
        const savedUser = await createUser({
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
      } finally {
        setIsSaving(false);
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
              disabled={!formData[currentStep.field as keyof typeof formData] || isSaving}
              className="w-full py-4 bg-green-500 text-white rounded-2xl font-semibold text-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : onboardingStep === steps.length - 1 ? 'Start Free Trial' : 'Continue'}
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

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Revenue</p>
            <p className="mt-2 text-2xl font-bold text-green-600">{formatCurrency(activeReportSummary.totalRevenue)}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">Expenses</p>
            <p className="mt-2 text-2xl font-bold text-red-600">{formatCurrency(activeReportSummary.totalExpenses)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Profit</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(activeReportSummary.profit)}</p>
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
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Less: Business Expenses</p>
            <div className="space-y-2">
              {(expenseLines.length > 0 ? expenseLines : [{ label: 'No expenses recorded', amount: 0 }]).map((line) => (
                <div key={`expense-${line.label}`} className="flex items-center justify-between text-sm">
                  <span className="pl-4 text-gray-700">{line.label}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(line.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
              <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                <span>Total Expenses</span>
                <span>{formatCurrency(activeReportSummary.totalExpenses)}</span>
              </div>
            </div>
          </div>

          <div className="border-t-2 border-gray-900 bg-gray-50 px-4 py-4">
            <div className="flex items-center justify-between text-base font-bold">
              <span>Net Profit / (Loss)</span>
              <span className={activeReportSummary.profit >= 0 ? 'text-green-700' : 'text-red-700'}>
                {formatCurrency(activeReportSummary.profit)}
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
        <h3 className="font-semibold text-gray-900 mb-4">Profit & Loss chart</h3>
        <SummaryChart weeklySummary={activeWeeklySummary} monthlySummary={activeReportSummary} monthLabel={reportPeriodLabel} />
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
                        setTransactions((prev) => prev.map((tx) => tx.id === updated.id ? updated : tx));
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
      if (!user) {
        setError('Please complete onboarding before sending messages.');
        return;
      }

      const message = inputValue.trim();
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'user',
        content: message,
        timestamp: new Date()
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputValue('');
      setError(null);

      try {
        const result = await postChatEntry(user.id, message, 'web');

        setFollowUpStep(null);

        setTransactions((prev) => {
          const merged = new Map(prev.map((tx) => [tx.id, tx]));
          for (const tx of result.transactions) {
            merged.set(tx.id, tx);
          }
          return Array.from(merged.values()).sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          );
        });

        setWeeklySummary(result.summary);
        setMonthlySummary(result.monthlySummary);
        const now = new Date();
        const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        setReportSummaryCache((prev) => ({ ...prev, [currentKey]: result.monthlySummary }));

        try {
          const latestInsights = await getCurrentInsights(user.id);
          setCurrentInsights(latestInsights);
          setReportInsightsCache((prev) => ({ ...prev, [currentKey]: latestInsights }));
        } catch (insightError) {
          console.error('Unable to refresh current insights after chat update', insightError);
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

        const botResponse: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'bot',
          content: botText,
          timestamp: new Date()
        };

        setMessages((prev) => [...prev, botResponse]);
      } catch (err) {
        console.error(err);
        const errorResponse: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'bot',
          content: "I couldn't save that entry right now. Please try again in a moment.",
          timestamp: new Date()
        };
        setMessages((prev) => [...prev, errorResponse]);
      }
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
            <p className="text-green-100 text-xs">Web chatbot active — WhatsApp integration also available.</p>
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
              <p className="text-green-100 text-sm">Good morning,</p>
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
                onClick={() => setDashboardTab('reports')}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold ${dashboardTab === 'reports' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                Reports
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-3xl shadow-lg shadow-orange-200 p-5 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-amber-100">Daily streak</p>
                <p className="mt-2 text-3xl font-bold">
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
              <div className="rounded-2xl bg-white/20 p-3">
                <CalendarIcon className="text-white" size={22} />
              </div>
            </div>
            <div className="mt-4 border-t border-white/25 pt-3 text-xs text-amber-100">
              Active days this month: {activeDaysThisMonth}
            </div>
          </div>

          {dashboardTab === 'reports' ? (
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

          {user?.subscriptionStatus === 'trial' && (
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <ClockIcon className="text-white" size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold">Free Trial Active</p>
                  <p className="text-amber-100 text-sm">7 days remaining</p>
                </div>
                <button 
                  onClick={() => setView('landing')}
                  className="bg-white text-amber-600 px-4 py-2 rounded-full font-medium text-sm"
                >
                  View Plans
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
      if (!user?.isSuperAdmin) return;
      setAdminError(null);
      try {
        const [analytics, provider] = await Promise.all([
          getAdminAnalytics(),
          getAdminWhatsAppProvider()
        ]);
        setAdminAnalytics(analytics);
        setAdminProviderInfo(provider);
      } catch (error) {
        console.error('Unable to refresh admin analytics', error);
        setAdminError('Unable to refresh admin data.');
      }
    };

    const handleProviderUpdate = async (provider: WhatsAppProvider) => {
      setIsAdminSaving(true);
      setAdminError(null);
      try {
        const updated = await setAdminWhatsAppProvider(provider);
        setAdminProviderInfo(updated);
        const analytics = await getAdminAnalytics();
        setAdminAnalytics(analytics);
      } catch (error) {
        console.error('Unable to update provider setting', error);
        setAdminError('Unable to update WhatsApp provider.');
      } finally {
        setIsAdminSaving(false);
      }
    };

    if (!user?.isSuperAdmin) {
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
      setIsSaving(true);
      setError(null);

      try {
        const saved = await postBudget({
          userId: user.id,
          year: currentYear,
          month: currentMonth,
          targetType: budgetTargetType,
          amount: Number(budgetAmount)
        });

        setBudgets((prev) => {
          const existingIndex = prev.findIndex((budget) => budget.targetType === saved.targetType && budget.periodStart === saved.periodStart);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = saved;
            return next;
          }
          return [...prev, saved];
        });

        const latestInsights = await getCurrentInsights(user.id);
        setCurrentInsights(latestInsights);
        const now = new Date();
        const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        setReportInsightsCache((prev) => ({ ...prev, [currentKey]: latestInsights }));
      } catch (budgetSaveError) {
        console.error('Unable to save budget', budgetSaveError);
        setError('Unable to save budget. Please try again.');
      } finally {
        setIsSaving(false);
      }
    };

    const handleSaveCurrency = async () => {
      if (!user) return;
      setIsSaving(true);
      setError(null);
      try {
        const updated = await updateUser(user.id, { currencyCode: settingsCurrencyCode });
        setUser(updated);
      } catch (currencyError) {
        console.error('Unable to update currency', currencyError);
        setError('Unable to save currency preference right now.');
      } finally {
        setIsSaving(false);
      }
    };

    const handleDemoPremiumActivation = async () => {
      if (!user) return;
      setIsSaving(true);
      setError(null);
      try {
        const updated = await activateUserSubscription(user.id, {
          status: 'premium',
          source: 'paid',
          months: 1,
          note: 'Demo premium activation'
        });
        setUser(updated);
        await refreshReferralData();
      } catch (subscriptionError) {
        console.error('Unable to activate subscription', subscriptionError);
        setError('Unable to activate subscription.');
      } finally {
        setIsSaving(false);
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
              disabled={isSaving}
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Currency'}
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Referral rewards</h2>
                <p className="text-sm text-gray-500">Invite 5 paid users and unlock 3 free premium months.</p>
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
              <p className="mt-2 break-all text-sm text-gray-800">{referralProgress?.referralLink ?? (isReferralLoading ? 'Loading...' : 'Unavailable')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={copyReferralLink}
                  disabled={!referralProgress?.referralLink}
                  className="rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Copy Link
                </button>
                <button
                  onClick={handleDemoPremiumActivation}
                  disabled={isSaving}
                  className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Mark This Account Paid (Demo)
                </button>
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
              disabled={isSaving || !budgetAmount}
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Budget'}
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

          {user?.isSuperAdmin && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Super admin tools</h2>
              <p className="text-sm text-gray-600">Manage global analytics and WhatsApp provider selection from the admin panel.</p>
              <button
                onClick={() => setView('admin')}
                className="mt-4 rounded-2xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
              >
                Open Super Admin Panel
              </button>
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  return null;
}
