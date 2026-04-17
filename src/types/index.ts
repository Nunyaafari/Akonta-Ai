export interface User {
  id: string;
  name: string;
  phoneNumber: string;
  businessName: string;
  businessType: string;
  preferredTime: 'morning' | 'afternoon' | 'evening';
  timezone: string;
  currencyCode?: string;
  subscriptionStatus: 'free' | 'premium' | 'trial';
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date | string | null;
  freeSubscriptionMonthsEarned?: number;
  referralCode?: string | null;
  referredByUserId?: string | null;
  isSuperAdmin?: boolean;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  userId: string;
  type: 'revenue' | 'expense';
  eventType?:
    | 'cash_sale'
    | 'momo_sale'
    | 'credit_sale'
    | 'debtor_recovery'
    | 'stock_purchase'
    | 'operating_expense'
    | 'owner_withdrawal'
    | 'loan_received'
    | 'loan_repayment'
    | 'supplier_credit'
    | 'capital_introduced'
    | 'other';
  status?: 'draft' | 'confirmed';
  amount: number;
  date: Date;
  notes?: string;
  category?: string;
  correctionReason?: string;
  correctionOfId?: string | null;
  confirmedAt?: Date | string | null;
  attachmentName?: string;
  createdAt: Date;
  updatedAt?: Date | string;
}

export interface ChatMessage {
  id: string;
  type: 'bot' | 'user';
  content: string;
  timestamp: Date;
  syncStatus?: 'pending' | 'synced' | 'failed';
  parsed?: {
    revenue?: number;
    expense?: number;
    notes?: string;
  };
  actionLabel?: string;
  actionRoute?: string;
  actionTransactionId?: string;
}

export interface WeeklySummary {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  totalRevenue: number;
  totalExpenses: number;
  profit: number;
  transactionCount: number;
  dailyBreakdown: {
    date: Date;
    revenue: number;
    expenses: number;
  }[];
}

export interface MonthlySummary {
  month: number;
  year: number;
  totalRevenue: number;
  totalExpenses: number;
  profit: number;
  transactionCount: number;
  weeklyBreakdown: WeeklySummary[];
  topExpenseCategories: { category: string; amount: number }[];
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
  cashFlow: {
    operatingInflow: number;
    operatingOutflow: number;
    financingInflow: number;
    financingOutflow: number;
    totalCashInflow: number;
    totalCashOutflow: number;
    netCashFlow: number;
  };
}

export type BudgetTargetType = 'expense' | 'revenue';

export interface Budget {
  id: string;
  userId: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
  targetType: BudgetTargetType;
  amount: number;
  category?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetStatus {
  budget: Budget;
  used: number;
  remaining: number;
  percentUsed: number;
  status: 'onTrack' | 'nearTarget' | 'overBudget';
}

export interface MonthlyInsights {
  period: {
    year: number;
    month: number;
    periodStart: string;
    periodEnd: string;
    daysElapsed: number;
    daysInMonth: number;
  };
  targetStatus: {
    revenueTarget?: number;
    expenseTarget?: number;
    profitTarget?: number;
    actualRevenue: number;
    actualExpenses: number;
    actualProfit: number;
    expectedRevenueToDate?: number;
    expectedExpensesToDate?: number;
    revenueGapToDate?: number;
    expenseVarianceToDate?: number;
    profitGap?: number;
    revenueStatus?: 'ahead' | 'behind' | 'onTrack';
    expenseStatus?: 'over' | 'within' | 'onTrack';
    profitStatus?: 'above' | 'below' | 'onTrack';
  };
  expenseOverrun: {
    isOverrun: boolean;
    expectedByNow?: number;
    actualByNow: number;
    varianceByNow?: number;
    overrunCategories: Array<{
      category: string;
      target: number;
      actual: number;
      variance: number;
    }>;
    topExpenseCategories: Array<{
      category: string;
      amount: number;
    }>;
  };
  creditReadiness: {
    score: number;
    level: 'poor' | 'fair' | 'good' | 'strong';
    consistencyRatio: number;
    classificationRatio: number;
    personalSeparationRatio: number;
    creditTrackingRatio: number;
    daysWithRecords: number;
    expectedRecordDays: number;
  };
  highlights: string[];
}

export type WhatsAppProvider = 'twilio' | 'infobip' | 'whatchimp';

export interface AdminWhatsAppSettings {
  provider: WhatsAppProvider;
  available: WhatsAppProvider[];
  whatchimp: {
    baseUrl: string;
    apiKey: string;
    senderId: string;
    sendPath: string;
    authScheme: string;
  };
}

export interface AdminPaymentSettings {
  paystackPublicKey: string;
  paystackSecretKey: string;
  paystackWebhookSecret: string;
  premiumAmount: number;
  currencyCode: string;
}

export interface SubscriptionPaymentInitialization {
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  amountMinor: number;
  amountMajor: number;
  currencyCode: string;
  months: number;
  publicKey: string | null;
}

export interface SubscriptionPaymentVerification {
  status: string;
  applied: boolean;
  user: User | null;
}

export interface ReferralProgress {
  referralCode: string;
  referralLink: string;
  qualifiedReferrals: number;
  rewardMilestoneSize: number;
  remainingForNextReward: number;
  totalRewardMonths: number;
  rewards: Array<{
    id: string;
    milestone: number;
    grantedMonths: number;
    qualifiedReferralsAtGrant: number;
    createdAt: string | Date;
  }>;
  recentConversions: Array<{
    id: string;
    qualifiedAt: string | Date;
    referredUser: {
      id: string;
      name: string;
      businessName: string | null;
      subscriptionStatus: 'free' | 'premium' | 'trial';
    };
  }>;
}

export interface AdminAnalytics {
  users: {
    total: number;
    subscribed: number;
    paid: number;
    trial: number;
    free: number;
  };
  subscriptions: {
    paidStarts: number;
    daily: Array<{
      date: string;
      count: number;
      revenue: number;
    }>;
  };
  referrals: {
    qualifiedConversions: number;
    rewardsGranted: number;
    freeMonthsGranted: number;
  };
  businessTypes: Array<{
    type: string;
    count: number;
  }>;
  whatsapp: {
    provider: WhatsAppProvider;
    availableProviders: WhatsAppProvider[];
  };
}

export interface PremiumInsight {
  id: string;
  type: 'warning' | 'recommendation' | 'insight';
  title: string;
  message: string;
  icon: string;
}

export type AppView = 'landing' | 'onboarding' | 'chat' | 'attach' | 'dashboard' | 'reports' | 'history' | 'settings' | 'admin';
