import { useState, useEffect, useRef } from 'react';
import { AppView, User, ChatMessage, Transaction, SummaryPayload, WhatsAppProvider, Budget, BudgetTargetType } from './types';
import { 
  WhatsAppIcon, ChartIcon, HistoryIcon, PremiumIcon, 
  SendIcon, TrendingUpIcon, TrendingDownIcon, WalletIcon, 
  CalendarIcon, ArrowLeftIcon, CheckIcon, ClockIcon, BellIcon, ChatIcon, SettingsIcon 
} from './components/Icons';
import { 
  mockTransactions, currentWeekSummary, currentMonthSummary, 
  premiumInsights, chatMessages 
} from './data/mockData';
import SummaryChart from './components/SummaryChart';
import { createUser, getTransactions, getWeeklySummary, getMonthlySummary, getCurrentBudgets, getWhatsAppProviderInfo, postBudget, postChatEntry, registerDemoModeListener } from './lib/api';

// Format currency
const formatCurrency = (amount: number) => `GHS ${amount.toLocaleString()}`;

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

const currentMonthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

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

    const dateKey = tx.date.toISOString().slice(0, 10);
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

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages);
  const [inputValue, setInputValue] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions);
  const [weeklySummary, setWeeklySummary] = useState<SummaryPayload | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<SummaryPayload | null>(null);
  const [reportMode, setReportMode] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedReportYear, setSelectedReportYear] = useState<number>(new Date().getUTCFullYear());
  const [selectedReportMonth, setSelectedReportMonth] = useState<number>(new Date().getUTCMonth() + 1);
  const [selectedReportSummary, setSelectedReportSummary] = useState<SummaryPayload | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ default: WhatsAppProvider; available: WhatsAppProvider[] } | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
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

  const reportPeriodLabel = reportMode === 'yearly'
    ? `${selectedReportYear}`
    : new Date(Date.UTC(selectedReportYear, selectedReportMonth - 1, 1)).toLocaleString('default', { month: 'long', year: 'numeric' });

  const activeReportSummary = reportMode === 'yearly'
    ? createSummaryFromTransactions(transactions.filter((tx) => tx.date.getUTCFullYear() === selectedReportYear))
    : selectedReportSummary ?? activeMonthlySummary;

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

  const topExpenseCategories = Object.keys(activeReportSummary.categoryBreakdown).length
    ? Object.entries(activeReportSummary.categoryBreakdown)
        .map(([category, values]) => ({
          category,
          amount: values.expense ?? values.total ?? 0
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    : currentMonthSummary.topExpenseCategories;

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

    const loadAppData = async () => {
      try {
        const txs = await getTransactions(user.id);
        setTransactions(txs);

        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(now);
        weekEnd.setHours(23, 59, 59, 999);

        const weekly = await getWeeklySummary(
          user.id,
          weekStart.toISOString().slice(0, 10),
          weekEnd.toISOString().slice(0, 10)
        );

        const monthly = await getMonthlySummary(user.id, now.getUTCFullYear(), now.getUTCMonth() + 1);

        setWeeklySummary(weekly.summary);
        setMonthlySummary(monthly.summary);
      } catch (err) {
        console.error('Failed to load app data', err);
      }
    };

    loadAppData();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const loadReportSummary = async () => {
      if (reportMode === 'yearly') {
        setSelectedReportSummary(null);
        return;
      }
      try {
        const monthly = await getMonthlySummary(user.id, selectedReportYear, selectedReportMonth);
        setSelectedReportSummary(monthly.summary);
      } catch (err) {
        console.error('Failed to load selected report summary', err);
      }
    };

    loadReportSummary();
  }, [user, reportMode, selectedReportYear, selectedReportMonth]);

  useEffect(() => {
    registerDemoModeListener(() => setIsDemoMode(true));

    const loadProviderInfo = async () => {
      try {
        const info = await getWhatsAppProviderInfo();
        setProviderInfo(info);
      } catch (error) {
        console.error('Unable to load WhatsApp provider info', error);
      }
    };

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

    loadProviderInfo();
    loadBudgets();
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

  // Landing Page
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
        {/* Header */}
        <header className="px-4 py-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
                <WalletIcon className="text-white" size={20} />
              </div>
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

            {/* Chat Preview */}
            <div className="max-w-md mx-auto">
              <div className="bg-white rounded-3xl shadow-2xl shadow-gray-200 overflow-hidden border border-gray-100">
                <div className="bg-green-600 px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <WalletIcon className="text-white" size={18} />
                  </div>
                  <div>
                    <p className="text-white font-semibold">Akonta AI</p>
                    <p className="text-green-100 text-xs">Online</p>
                  </div>
                </div>
                <div className="p-4 space-y-3 bg-gray-50 min-h-[300px]">
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">Good morning! ☀️ How did your business do yesterday?</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-green-500 rounded-2xl rounded-tr-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-white">I made 500 cedis</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">Great! I recorded GHS 500 as revenue. Any expenses? 💰</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-green-500 rounded-2xl rounded-tr-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-white">Spent 100 on transport</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm max-w-[80%]">
                      <p className="text-gray-800">✅ Revenue: GHS 500<br/>✅ Expense: GHS 100<br/><br/><strong>Profit: GHS 400</strong> 🎉</p>
                    </div>
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
                  <p className="text-5xl font-bold text-gray-900">¢30</p>
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
                  onClick={() => setView('premium')}
                  className="w-full py-4 rounded-2xl bg-green-500 text-white font-semibold hover:bg-green-600 transition-colors"
                >
                  Upgrade Now
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
            <p>© 2024 Akonta AI. Made with ❤️ for West African entrepreneurs.</p>
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
          subscriptionStatus: 'trial'
        });

        setUser(savedUser);
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
  const BottomNav = () => (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 safe-area-inset-bottom">
      <div className="max-w-md mx-auto flex justify-around items-center">
        {[
          { id: 'chat' as AppView, icon: ChatIcon, label: 'Chat' },
          { id: 'dashboard' as AppView, icon: ChartIcon, label: 'Dashboard' },
          { id: 'reports' as AppView, icon: ChartIcon, label: 'Reports' },
          { id: 'history' as AppView, icon: HistoryIcon, label: 'History' },
          { id: 'premium' as AppView, icon: PremiumIcon, label: 'Premium' },
          { id: 'settings' as AppView, icon: SettingsIcon, label: 'Settings' },
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

      const parseAmount = (text: string): number | undefined => {
        const cleaned = text.replace(/,/g, '');
        const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);
        return match ? Number(match[1].replace(',', '.')) : undefined;
      };

      const parseTargets = (text: string) => {
        const cleaned = text.replace(/,/g, '');
        const revenueMatch = cleaned.match(/(?:revenue|sales|income|target).*?(\d+(?:[.,]\d+)?)/i);
        const expenseMatch = cleaned.match(/(?:expense|cost|limit|budget).*?(\d+(?:[.,]\d+)?)/i);
        return {
          revenue: revenueMatch ? Number(revenueMatch[1].replace(',', '.')) : undefined,
          expense: expenseMatch ? Number(expenseMatch[1].replace(',', '.')) : undefined
        };
      };

      const parseSalesBreakdown = (text: string) => {
        const cleaned = text.replace(/,/g, '');
        const cashMatch = cleaned.match(/(?:cash|cash sales|cash received)\D*(\d+(?:[.,]\d+)?)/i);
        const creditMatch = cleaned.match(/(?:credit|credit sales|on credit)\D*(\d+(?:[.,]\d+)?)/i);
        const momoMatch = cleaned.match(/(?:momo|mobile|transfer|payment)\D*(\d+(?:[.,]\d+)?)/i);
        return {
          cash: cashMatch ? Number(cashMatch[1].replace(',', '.')) : undefined,
          credit: creditMatch ? Number(creditMatch[1].replace(',', '.')) : undefined,
          momo: momoMatch ? Number(momoMatch[1].replace(',', '.')) : undefined
        };
      };

      const parseExpenseCategory = (text: string) => {
        const cleaned = text.trim();
        const personalMatch = cleaned.match(/personal|owner|family|home|private/i);
        if (personalMatch) {
          return 'Personal withdrawal';
        }
        const categoryMatch = cleaned.match(/(?:on|for)\s+(.+)/i);
        return categoryMatch ? categoryMatch[1].trim() : cleaned;
      };

      const parseDebtRecovery = (text: string): number | undefined => {
        const cleaned = text.replace(/,/g, '');
        const match = cleaned.match(/(?:debt|owed|recovery|repay|paid old debt|customer paid).*?(\d+(?:[.,]\d+)?)/i);
        if (match) return Number(match[1].replace(',', '.'));
        const numberMatch = cleaned.match(/(\d+(?:[.,]\d+)?)/);
        return numberMatch ? Number(numberMatch[1].replace(',', '.')) : undefined;
      };

      const shouldAskForSupportingDocument = (category: string | undefined, amount?: number) => {
        if (!category || /personal|owner|family|private|home|withdrawal/i.test(category)) {
          return false;
        }

        const normalized = category.toLowerCase();
        const importantKeywords = [
          'stock',
          'inventory',
          'rent',
          'utility',
          'utilities',
          'supplier',
          'equipment',
          'machine',
          'lender',
          'loan',
          'contractor',
          'repair',
          'service',
          'payment',
          'purchase',
          'invoice'
        ];

        if (importantKeywords.some((keyword) => normalized.includes(keyword))) {
          return true;
        }

        return amount !== undefined && amount >= 1000;
      };

      const getSupportingDocumentLink = (transaction: Transaction) => {
        return `/attach/${transaction.id}`;
      };

      const buildDailySummary = (context = botContext) => {
        const parts = [];
        if (context.salesAmount !== undefined) parts.push(`Sales: GHS ${context.salesAmount}`);
        if (context.cashSales !== undefined) parts.push(`Cash sales: GHS ${context.cashSales}`);
        if (context.momoSales !== undefined) parts.push(`Mobile transfer: GHS ${context.momoSales}`);
        if (context.creditSales !== undefined) parts.push(`Credit sales: GHS ${context.creditSales}`);
        if (context.debtRecovery !== undefined) parts.push(`Debt recovery: GHS ${context.debtRecovery}`);
        if (context.expenseAmount !== undefined) parts.push(`Expenses: GHS ${context.expenseAmount}`);
        if (context.expenseCategory) parts.push(`Expense category: ${context.expenseCategory}`);
        if (context.personalExpense !== undefined) parts.push(`Personal withdrawal: GHS ${context.personalExpense}`);
        if (context.closingBalance !== undefined) parts.push(`Closing balance: GHS ${context.closingBalance}`);

        if (!parts.length) {
          return 'I have not captured enough details yet.';
        }
        return `Here is your current daily summary:\n- ${parts.join('\n- ')}`;
      };

      const buildTargetInsight = (context = botContext) => {
        const lines: string[] = [];
        if (context.revenueTarget !== undefined && context.salesAmount !== undefined) {
          const percent = Math.round((context.salesAmount / context.revenueTarget) * 100);
          lines.push(`Today’s sales are ${percent}% of your monthly revenue target of GHS ${context.revenueTarget}.`);
        }
        if (context.expenseTarget !== undefined && context.expenseAmount !== undefined) {
          const percent = Math.round((context.expenseAmount / context.expenseTarget) * 100);
          const status = context.expenseAmount > context.expenseTarget ? 'over' : 'within';
          lines.push(`Today’s expenses are ${percent}% of your monthly expense limit of GHS ${context.expenseTarget} (${status} the limit).`);
        }
        return lines.length ? lines.join(' ') : '';
      };

      const handleSalesBreakdown = () => {
        const breakdown = parseSalesBreakdown(message);
        const nextContext = {
          ...botContext,
          cashSales: breakdown.cash,
          creditSales: breakdown.credit,
          momoSales: breakdown.momo
        };
        setBotContext(nextContext);
        setFollowUpStep('debtRecovery');

        const parts = [];
        if (breakdown.cash) parts.push(`GHS ${breakdown.cash} cash`);
        if (breakdown.momo) parts.push(`GHS ${breakdown.momo} mobile/transfer`);
        if (breakdown.credit) parts.push(`GHS ${breakdown.credit} credit`);

        if (parts.length === 0) {
          setFollowUpStep('salesBreakdown');
          return 'Please tell me how your sales were received: cash, mobile transfer, or credit.';
        }

        return `Thank you. I recorded ${parts.join(', ')} in your sales breakdown. Did any customer pay an old debt today? If yes, send the amount.`;
      };

      const handleDebtRecovery = () => {
        const amount = parseDebtRecovery(message);
        const negative = /^(no|none|zero|nothing|n)$/i.test(message.trim());
        if (negative) {
          setFollowUpStep('expense');
          return 'Okay, no debtor recovery today. How much did the business spend today?';
        }
        if (amount === undefined) {
          setFollowUpStep('debtRecovery');
          return 'Please send the amount of customer debt recovered today, or say no if none.';
        }
        setBotContext((prev) => ({ ...prev, debtRecovery: amount }));
        setFollowUpStep('expense');

        const parts: string[] = [];
        if (botContext.cashSales) parts.push(`GHS ${botContext.cashSales} cash sales`);
        if (botContext.momoSales) parts.push(`GHS ${botContext.momoSales} mobile/transfer sales`);
        if (botContext.creditSales) parts.push(`GHS ${botContext.creditSales} credit sales`);
        const salesSummary = parts.length ? `So far I have recorded ${parts.join(', ')}.` : '';

        return `Thanks. I recorded GHS ${amount} from customer debt recovery. ${salesSummary} How much did the business spend today?`;
      };

      const handleExpenseCategory = () => {
        const category = parseExpenseCategory(message);
        const isPersonal = /personal withdrawal|personal|owner|family|private/i.test(category);
        const nextContext = { ...botContext, expenseCategory: category };
        if (isPersonal) {
          nextContext.personalExpense = parseAmount(message) ?? botContext.personalExpense;
        }
        setBotContext(nextContext);

        const askDocument = shouldAskForSupportingDocument(category, botContext.expenseAmount);
        if (askDocument && supportTransaction) {
          setFollowUpStep('supportingDoc');
          return `Recorded: GHS ${botContext.expenseAmount} ${category}. Do you have the receipt, invoice, or payment confirmation available now to attach in the app?`;
        }

        setFollowUpStep('confirmRecord');
        const summary = buildDailySummary(nextContext);
        return `${summary}\n\nWould you like to add another record or finish today’s entry?`;
      };

      if (followUpStep === 'salesBreakdown') {
        const botText = handleSalesBreakdown();
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: botText, timestamp: new Date() }]);
        return;
      }

      if (followUpStep === 'debtRecovery') {
        const botText = handleDebtRecovery();
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: botText, timestamp: new Date() }]);
        return;
      }

      if (followUpStep === 'expenseCategory') {
        const botText = handleExpenseCategory();
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: botText, timestamp: new Date() }]);
        return;
      }

      if (followUpStep === 'supportingDoc') {
        const lower = message.trim().toLowerCase();
        const affirmative = /^(yes|yeah|yep|sure|ok|okay|y)$/i.test(lower);
        const negative = /^(no|nope|not now|later|maybe|don'?t have|dont have|no thanks)$/i.test(lower);

        if (affirmative && supportTransaction) {
          const uploadLink = getSupportingDocumentLink(supportTransaction);
          setSupportTransaction(null);
          setFollowUpStep('confirmRecord');
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'Great. Please use the button below to attach it to this transaction. Once uploaded, I’ll keep it with this record. Would you like to add another record or finish today’s entry?', actionLabel: 'Attach supporting document', actionRoute: uploadLink, actionTransactionId: supportTransaction.id, timestamp: new Date() }]);
          return;
        }

        if (negative) {
          setSupportTransaction(null);
          setFollowUpStep('confirmRecord');
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'No problem. I’ve saved this transaction without a supporting document for now. Would you like to add another record or finish today’s entry?', timestamp: new Date() }]);
          return;
        }

        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'Do you have the receipt, invoice, or payment confirmation available now to attach in the app? If yes, type yes. If not, type no.', timestamp: new Date() }]);
        return;
      }

      if (followUpStep === 'confirmRecord') {
        const normalized = message.trim().toLowerCase();
        const wantsMore = /(add another|another record|more|continue|new entry|new record|again)/i.test(normalized);
        const wantsFinish = /^(finish|done|complete|save|no more|all set|that(?:'s|s) it|no|nope)$/i.test(normalized);

        if (wantsMore) {
          setFollowUpStep('sales');
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'Great, let’s add another record. How much did the business make in sales today?', timestamp: new Date() }]);
          return;
        }

        if (wantsFinish) {
          const summary = buildDailySummary();
          const insight = buildTargetInsight();
          const insightText = insight ? `\n\n${insight}` : '';
          setFollowUpStep('closingBalance');
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: `Nice work. Here’s your day so far:\n${summary}${insightText}\n\nWhat is your closing cash balance or ending float for today? If you want to skip, type skip.`, timestamp: new Date() }]);
          return;
        }

        setFollowUpStep('confirmRecord');
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'Please say “add another” if you want to record more, or “finish” if you are done for today.', timestamp: new Date() }]);
        return;
      }

      if (followUpStep === 'closingBalance') {
        const lower = message.trim().toLowerCase();
        if (/^(skip|no|nope|not now)$/i.test(lower)) {
          const summary = buildDailySummary();
          const insight = buildTargetInsight();
          const insightText = insight ? `\n\n${insight}` : '';
          setFollowUpStep(null);
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: `No problem. I’ve saved your day without a closing balance. Here’s your book review:\n${summary}${insightText}\n\nI’m ready when you want to add more.`, timestamp: new Date() }]);
          return;
        }

        const amount = parseAmount(message);
        if (amount !== undefined) {
          const nextContext = { ...botContext, closingBalance: amount };
          setBotContext(nextContext);
          const summary = buildDailySummary(nextContext);
          const insight = buildTargetInsight(nextContext);
          const insightText = insight ? `\n\n${insight}` : '';
          setFollowUpStep(null);
          setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: `Got it. I recorded a closing balance of GHS ${amount}. Here’s your completed daily book:\n${summary}${insightText}\n\nI’m ready when you want to add more.`, timestamp: new Date() }]);
          return;
        }

        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), type: 'bot', content: 'Please send your closing cash balance in cedis, or type skip if you want to save without it.', timestamp: new Date() }]);
        return;
      }

      try {
        const result = await postChatEntry(user.id, message);
        setTransactions((prev) => [...result.transactions, ...prev]);

        let botText = '';

        if (result.transactions.length === 0) {
          const affirmative = /^(yes|yeah|yep|sure|okay|ok|ya|y)$/i.test(message);
          if (followUpStep === 'confirmImpact' && affirmative) {
            const impactTx = impactTransaction;
            const amount = impactTx ? impactTx.amount : undefined;
            const category = impactTx?.category ?? 'expense';
            const impactAmountText = amount ? `GHS ${amount}` : 'that amount';
            setFollowUpStep(botContext.revenueTarget && botContext.expenseTarget ? 'cash' : 'targets');
            setImpactTransaction(null);
            botText = `That ${category} of ${impactAmountText} reduces your profit and available cash for the month. I’ll keep tracking it. ${botContext.revenueTarget && botContext.expenseTarget ? 'Do you have opening cash or balance to record?' : 'Now, what monthly targets should I watch — your revenue goal and expense limit?'} `;
          } else if (followUpStep === 'confirmImpact') {
            setFollowUpStep(botContext.revenueTarget && botContext.expenseTarget ? 'cash' : 'targets');
            setImpactTransaction(null);
            botText = `Okay. ${botContext.revenueTarget && botContext.expenseTarget ? 'Do you have opening cash or balance to record?' : 'What monthly targets should I watch — your revenue goal and expense limit?'} `;
          } else if (followUpStep === 'customer') {
            setBotContext((prev) => ({ ...prev, customer: message }));
            setFollowUpStep('targets');
            botText = 'Great, thanks. What monthly targets should I watch — your revenue goal and expense limit?';
          } else if (followUpStep === 'targets') {
            const targets = parseTargets(message);
            const nextContext = { ...botContext, objective: message };
            if (targets.revenue) nextContext.revenueTarget = targets.revenue;
            if (targets.expense) nextContext.expenseTarget = targets.expense;
            setBotContext(nextContext);

            const now = new Date();
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth() + 1;
            const budgetPromises: Promise<any>[] = [];

            if (targets.revenue) {
              budgetPromises.push(postBudget({
                userId: user.id,
                year,
                month,
                targetType: 'revenue',
                amount: targets.revenue,
                notes: 'Monthly revenue target'
              }));
            }
            if (targets.expense) {
              budgetPromises.push(postBudget({
                userId: user.id,
                year,
                month,
                targetType: 'expense',
                amount: targets.expense,
                notes: 'Monthly expense limit'
              }));
            }
            await Promise.all(budgetPromises);

            if (nextContext.revenueTarget && nextContext.expenseTarget) {
              setFollowUpStep('cash');
              botText = `Excellent. I’ve saved your monthly revenue target of GHS ${nextContext.revenueTarget} and expense limit of GHS ${nextContext.expenseTarget}. Do you have opening cash or balance to record?`;
            } else if (nextContext.revenueTarget) {
              setFollowUpStep('targets');
              botText = `Got it. Your revenue target is GHS ${nextContext.revenueTarget}. What expense limit should I watch for this month?`;
            } else if (nextContext.expenseTarget) {
              setFollowUpStep('targets');
              botText = `Got it. Your expense limit is GHS ${nextContext.expenseTarget}. What revenue target do you want for this month?`;
            } else {
              setFollowUpStep('targets');
              botText = 'Okay. Please tell me your monthly revenue target and expense limit in cedis so I can help track your books.';
            }
          } else if (followUpStep === 'cash') {
            const amount = parseAmount(message);
            if (amount) {
              setBotContext((prev) => ({ ...prev, cashBalance: amount }));
              setFollowUpStep('sales');
              botText = `Thanks. I’ve recorded your opening balance of GHS ${amount}. Let’s record today’s activity. How much did the business make in sales today?`;
            } else {
              botText = 'Please send the opening cash or balance amount in cedis so I can record it.';
            }
          } else if (/(help|objective|customer|goal|plan)/i.test(message)) {
            setFollowUpStep('customer');
            botText = 'Sure — let’s start with who your customers are. Tell me your main customer type or buyer profile.';
          } else if (!botContext.customer) {
            setFollowUpStep('customer');
            botText = 'I’m here to help track your business. Who are your customers? Tell me your main customer type or buyer profile.';
          } else if (!botContext.objective) {
            setFollowUpStep('targets');
            botText = 'What are your monthly targets? Tell me your revenue goal and expense limit so I can help you stay on track.';
          } else if (!botContext.revenueTarget || !botContext.expenseTarget) {
            setFollowUpStep('targets');
            botText = 'Please tell me your monthly revenue target and expense limit in cedis so I can save them for you.';
          } else {
            setFollowUpStep('cash');
            botText = 'Do you have opening cash or balance to record before we log revenue and expense?';
          }
        } else {
          const revenueTx = result.transactions.find((tx) => tx.type === 'revenue');
          const expenseTx = result.transactions.find((tx) => tx.type === 'expense');

          if (revenueTx && expenseTx) {
            botText = `✅ Recorded GHS ${revenueTx.amount} revenue and GHS ${expenseTx.amount} expense.\n\nProfit saved for today.`;
          } else if (revenueTx) {
            if (followUpStep === 'sales') {
              setBotContext((prev) => ({ ...prev, salesAmount: revenueTx.amount }));
              setFollowUpStep('salesBreakdown');
              botText = `✅ Recorded GHS ${revenueTx.amount} as sales. How much of that was cash, mobile transfer, and credit?`;
            } else {
              setFollowUpStep('expense');
              botText = `✅ Recorded GHS ${revenueTx.amount} as revenue. Any expenses to add?`;
            }
          } else if (expenseTx) {
            if (followUpStep === 'expense') {
              setBotContext((prev) => ({ ...prev, expenseAmount: expenseTx.amount }));
              setSupportTransaction(expenseTx);
              setFollowUpStep('expenseCategory');
              botText = `✅ Recorded GHS ${expenseTx.amount} as expense. What was that spent on?`;
            } else {
              setFollowUpStep('confirmImpact');
              setImpactTransaction(expenseTx);
              botText = `✅ Recorded GHS ${expenseTx.amount} as expense. Need help understanding the impact?`;
            }
          } else {
            botText = 'Great! Your entry was saved.';
          }

          if ((!botContext.customer || !botContext.objective) && !followUpStep) {
            botText += '\n\nBefore we continue, I’d love to know more about your customers and objective so I can tailor advice.';
            setFollowUpStep('customer');
          }

          if (result.summary.transactionCount > 1) {
            botText += `\n\nCurrent batch: ${result.summary.transactionCount} transactions.`;
          }

          if (result.budgetStatuses.length > 0) {
            const expenseBudget = result.budgetStatuses.find((status) => status.budget.targetType === 'expense');
            if (expenseBudget) {
              if (expenseBudget.status === 'overBudget') {
                botText += `\n\n⚠️ You are over your monthly expense budget by GHS ${Math.abs(expenseBudget.remaining)}.`;
              } else if (expenseBudget.status === 'nearTarget') {
                botText += `\n\n📌 You have used ${Math.round(expenseBudget.percentUsed)}% of your expense budget.`;
              } else {
                botText += `\n\n✅ You are within your expense budget for the month.`;
              }
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
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <WalletIcon className="text-white" size={18} />
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
            <h3 className="font-semibold text-gray-900 mb-4">Category snapshot</h3>
            {topExpenseCategories.length > 0 ? (
              <div className="space-y-3">
                {topExpenseCategories.map((cat, i) => {
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
                  onClick={() => setView('premium')}
                  className="bg-white text-amber-600 px-4 py-2 rounded-full font-medium text-sm"
                >
                  Upgrade
                </button>
              </div>
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  // Reports View
  if (view === 'reports') {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-gradient-to-br from-green-600 to-teal-600 px-4 pt-6 pb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-green-100 text-sm">Reports</p>
              <h1 className="text-white text-xl font-bold">Profit & Loss</h1>
            </div>
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <ChartIcon className="text-white" size={20} />
            </div>
          </div>
        </div>

        <div className="px-4 -mt-14 space-y-6">
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
            <h3 className="font-semibold text-gray-900 mb-4">Profit & Loss chart</h3>
            <SummaryChart weeklySummary={activeWeeklySummary} monthlySummary={activeReportSummary} monthLabel={reportMonthLabel} />
          </div>

          <div className="bg-white rounded-3xl shadow-lg shadow-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Expense breakdown</h3>
            {topExpenseCategories.length > 0 ? (
              <div className="space-y-3">
                {topExpenseCategories.map((cat, i) => {
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

        <BottomNav />
      </div>
    );
  }

  // History View
  if (view === 'history') {
    const groupedTransactions = transactions.reduce((acc, tx) => {
      const dateKey = formatDate(tx.date);
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(tx);
      return acc;
    }, {} as Record<string, Transaction[]>);

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white px-4 py-6 border-b border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-gray-500 text-sm">All your logged transactions</p>
        </div>

        <div className="px-4 py-4 space-y-6">
          {Object.entries(groupedTransactions).map(([date, txs]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-gray-500 mb-3">{date}</h3>
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
          ))}
        </div>

        <BottomNav />
      </div>
    );
  }

  // Premium View
  if (view === 'premium') {
    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-gradient-to-br from-purple-600 to-indigo-600 px-4 pt-6 pb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Go Premium</h1>
          <p className="text-purple-100">Unlock powerful insights for your business</p>
        </div>

        <div className="px-4 -mt-4">
          {/* Pricing Card */}
          <div className="bg-white rounded-2xl shadow-lg shadow-gray-200 p-6 mb-6">
            <div className="text-center mb-6">
              <p className="text-gray-500 text-sm mb-2">Starting at</p>
              <p className="text-4xl font-bold text-gray-900">GHS 30<span className="text-lg text-gray-500">/month</span></p>
              <p className="text-green-600 text-sm font-medium mt-1">7-day free trial included</p>
            </div>
            <div className="space-y-3 mb-6">
              {[
                'Advanced expense breakdown',
                'Profit trend analysis',
                'AI-powered recommendations',
                'Downloadable PDF reports',
                'Cash flow warnings',
                'Priority support',
                'Multi-channel WhatsApp support (Twilio, Infobip)'
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-3">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckIcon className="text-green-600" size={12} />
                  </div>
                  <span className="text-gray-700">{feature}</span>
                </div>
              ))}
            </div>
            <button className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-semibold hover:opacity-90 transition-opacity">
              Start Free Trial
            </button>
          </div>

          {/* Premium Insights Preview */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Sample Insights</h2>
            <div className="space-y-3">
              {premiumInsights.map((insight) => (
                <div key={insight.id} className="bg-white rounded-xl p-4 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 opacity-10">
                    <span className="text-6xl">{insight.icon}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{insight.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900">{insight.title}</p>
                      <p className="text-gray-600 text-sm">{insight.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Expense Categories */}
          <div className="bg-white rounded-2xl shadow-lg shadow-gray-200 p-6 mb-6">
            <h3 className="font-semibold text-gray-900 mb-4">Expense Breakdown</h3>
            <div className="space-y-3">
              {topExpenseCategories.map((cat, i) => {
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
                      ></div>
                    </div>
                  </div>
                );
              })}
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
      } catch (error) {
        console.error('Unable to save budget', error);
        setError('Unable to save budget. Please try again.');
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
              <p className="text-gray-500 text-sm">Channel, provider, and budget targets</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500">Active WhatsApp Provider</p>
                <p className="text-lg font-semibold text-gray-900">{providerInfo?.default ?? 'Loading...'}</p>
              </div>
              <div className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
                Admin controlled
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Web chat is always available. WhatsApp messages use the configured provider.
            </p>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Amount (GHS)</label>
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
                    <p className="text-xl font-semibold text-gray-900">GHS {budget.amount.toLocaleString()}</p>
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
