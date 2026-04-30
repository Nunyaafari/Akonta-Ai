export interface User {
  id: string;
  name: string;
  phoneNumber: string;
  whatsappNumber?: string | null;
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  businessName: string;
  businessType: string;
  preferredTime: 'morning' | 'afternoon' | 'evening';
  timezone: string;
  currencyCode?: string;
  subscriptionStatus: 'free' | 'basic' | 'premium' | 'trial';
  trialEndsAt?: Date | string | null;
  subscriptionEndsAt?: Date | string | null;
  freeSubscriptionMonthsEarned?: number;
  referralCode?: string | null;
  referredByUserId?: string | null;
  isSuperAdmin?: boolean;
  createdAt: Date;
}

export interface TelegramProviderStatus {
  enabled: boolean;
  webhookSecretConfigured: boolean;
}

export interface Transaction {
  id: string;
  userId: string;
  businessId?: string | null;
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
  parseConfidence?: 'high' | 'medium' | 'low';
  requiresReview?: boolean;
  productServiceId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  businessCategoryId?: string | null;
  correctionReason?: string;
  correctionOfId?: string | null;
  ledgerPostingStatus?: 'not_configured' | 'pending' | 'posted' | 'failed' | 'skipped';
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
  completeness: {
    totalRecords: number;
    assignedSalesCount: number;
    unassignedSalesCount: number;
    assignedSalesAmount: number;
    unassignedSalesAmount: number;
    productAssignmentRatio: number;
    lowConfidenceCount: number;
    mediumConfidenceCount: number;
    reviewFlaggedCount: number;
    completenessScore: number;
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
  basicAmount: number;
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
  plan: 'basic' | 'premium';
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
      subscriptionStatus: 'free' | 'basic' | 'premium' | 'trial';
    };
  }>;
}

export type WorkspaceRole = 'owner' | 'cashier' | 'manager' | 'bookkeeper' | 'viewer' | 'accountant';
export type WorkspaceMembershipStatus = 'invited' | 'active' | 'inactive' | 'revoked';

export interface WorkspaceMembership {
  membershipId: string;
  businessId: string;
  businessName: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
}

export interface WorkspaceMember {
  membershipId: string;
  userId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  joinedAt?: string | null;
  invitedByUserId?: string | null;
  user: {
    id: string;
    name: string;
    fullName?: string | null;
    phoneNumber: string;
    email?: string | null;
    status: 'pending' | 'active' | 'inactive' | 'suspended';
  };
}

export type BusinessPaymentMethod = 'cash' | 'momo' | 'bank' | 'card' | 'credit';
export type BusinessCategoryKind = 'sales' | 'expense';
export type ProductServiceType = 'product' | 'service';

export interface BusinessSettingsProfile {
  id: string;
  businessName: string;
  businessType?: string | null;
  currencyCode: string;
  timezone: string;
  enabledPaymentMethods?: BusinessPaymentMethod[] | null;
  onboardingVersion: number;
  onboardingCompletedAt?: string | null;
  setupCounts: {
    products: number;
    customers: number;
    suppliers: number;
    categories: number;
    ledgerAccounts: number;
  };
  onboardingProfile?: {
    required: {
      hasBusinessName: boolean;
      hasBusinessType: boolean;
      hasCurrencyCode: boolean;
      hasTimezone: boolean;
      hasPaymentMethods: boolean;
    };
    setupModules: {
      hasCategories: boolean;
      hasProducts: boolean;
      hasCustomers: boolean;
      hasSuppliers: boolean;
      hasDefaultLedger: boolean;
    };
    completion: {
      requiredCompleted: number;
      requiredTotal: number;
      requiredCompletionPercent: number;
      setupCompleted: number;
      setupTotal: number;
      setupCompletionPercent: number;
      overallCompletionPercent: number;
    };
    isReadyForFirstRecord: boolean;
    isSetupSeeded: boolean;
  };
}

export interface BusinessCategory {
  id: string;
  businessId: string;
  kind: BusinessCategoryKind;
  name: string;
  normalizedName: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductService {
  id: string;
  businessId: string;
  categoryId?: string | null;
  name: string;
  normalizedName: string;
  type: ProductServiceType;
  defaultPrice?: number | null;
  estimatedCost?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: BusinessCategory | null;
}

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  normalizedName: string;
  phoneNumber?: string | null;
  notes?: string | null;
  openingReceivable: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  businessId: string;
  name: string;
  normalizedName: string;
  phoneNumber?: string | null;
  supplyType?: string | null;
  notes?: string | null;
  openingPayable: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerAccount {
  id: string;
  businessId: string;
  code: string;
  name: string;
  normalizedName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  isSystemDefault: boolean;
  isActive: boolean;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerJournalEntryLine {
  id: string;
  accountId: string;
  debitAmount: number;
  creditAmount: number;
  memo?: string | null;
  account: {
    id: string;
    code: string;
    name: string;
    accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  };
}

export interface LedgerJournalEntry {
  id: string;
  businessId: string;
  transactionId?: string | null;
  entryDate: string;
  description?: string | null;
  status: 'draft' | 'posted' | 'needs_review' | 'void';
  source: string;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  transaction?: {
    id: string;
    type: 'revenue' | 'expense';
    eventType:
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
    amount: number;
    date: string;
    ledgerPostingStatus: 'not_configured' | 'pending' | 'posted' | 'failed' | 'skipped';
  } | null;
  lines: LedgerJournalEntryLine[];
}

export interface CreateLedgerAccountPayload {
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  parentId?: string | null;
}

export interface CreateManualJournalEntryPayload {
  entryDate?: string;
  description?: string | null;
  lines: Array<{
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    memo?: string | null;
  }>;
}

export interface BalanceSheetSectionLine {
  accountId: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  balance: number;
}

export interface BalanceSheetSnapshot {
  asOf: string;
  assets: {
    lines: BalanceSheetSectionLine[];
    total: number;
  };
  liabilities: {
    lines: BalanceSheetSectionLine[];
    total: number;
  };
  equity: {
    lines: BalanceSheetSectionLine[];
    total: number;
  };
  currentEarnings: {
    balance: number;
  };
  totals: {
    assets: number;
    liabilities: number;
    equityBeforeEarnings: number;
    equityAfterEarnings: number;
    liabilitiesAndEquity: number;
  };
}

export interface ReconciliationSession {
  id: string;
  businessId: string;
  createdByUserId: string;
  channel: 'cash' | 'momo';
  asOf: string;
  bookBalance: number;
  countedBalance: number;
  variance: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUser: {
    id: string;
    name: string;
    fullName?: string | null;
  };
}

export interface PendingTransactionApproval {
  id: string;
  transactionId: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string | null;
  note?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
  transaction: Transaction;
  requestedByUser?: {
    id: string;
    name: string;
    fullName?: string | null;
  } | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthSession {
  userId: string;
  businessId: string;
  role: WorkspaceRole;
  membershipId?: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthOtpRequestResponse {
  success: boolean;
  expiresAt: string;
  devOtpCode?: string;
}

export interface AuthVerifyResponse {
  user: User;
  session: {
    id: string;
    businessId: string;
    role: WorkspaceRole;
  };
  memberships: Array<{
    id: string;
    businessId: string;
    businessName: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
  }>;
  tokens: AuthTokens;
}

export interface AdminAnalytics {
  users: {
    total: number;
    subscribed: number;
    paid: number;
    basic: number;
    premium: number;
    trial: number;
    free: number;
  };
  tiers: {
    free: number;
    basic: number;
    premium: number;
    trial: number;
  };
  businesses: {
    total: number;
    free: number;
    basic: number;
    premium: number;
    trial: number;
  };
  subscriptions: {
    paidStarts: number;
    daily: Array<{
      date: string;
      count: number;
      revenue: number;
    }>;
    inflows: {
      currencyCode: string;
      last14Days: number;
      last30Days: number;
      monthToDate: number;
    };
    upcomingRenewals: {
      currencyCode: string;
      next7DaysCount: number;
      next30DaysCount: number;
      expectedRevenueNext7Days: number;
      expectedRevenueNext30Days: number;
      autoRenewReadyCount: number;
      list: Array<{
        businessId: string;
        businessName: string;
        ownerName: string;
        plan: 'basic' | 'premium';
        renewalDate: string;
        daysUntilRenewal: number;
        expectedAmount: number;
        currencyCode: string;
        autoRenewReady: boolean;
      }>;
    };
  };
  locations: Array<{
    location: string;
    count: number;
  }>;
  channels: {
    app: number;
    whatsapp: number;
    system: number;
  };
  activity: {
    last30Days: {
      transactions: number;
      revenue: number;
      expenses: number;
      net: number;
    };
    recent: Array<{
      id: string;
      type: 'audit' | 'transaction' | 'subscription';
      title: string;
      description: string;
      businessName: string;
      actorName: string;
      occurredAt: string;
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

export type AppView = 'landing' | 'auth' | 'onboarding' | 'chat' | 'attach' | 'dashboard' | 'reports' | 'history' | 'settings' | 'approvals' | 'admin';
