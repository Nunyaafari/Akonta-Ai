import type {
  AdminAnalytics,
  AdminPaymentSettings,
  AdminWhatsAppSettings,
  AuthOtpRequestResponse,
  AuthSession,
  AuthVerifyResponse,
  BusinessCategory,
  BalanceSheetSnapshot,
  BusinessPaymentMethod,
  BusinessSettingsProfile,
  CreateLedgerAccountPayload,
  CreateManualJournalEntryPayload,
  Customer,
  LedgerAccount,
  LedgerJournalEntry,
  PendingTransactionApproval,
  ReconciliationSession,
  ProductService,
  Supplier,
  Transaction,
  User,
  SummaryPayload,
  SubscriptionPaymentInitialization,
  SubscriptionPaymentVerification,
  WhatsAppProvider,
  Budget,
  BudgetStatus,
  BudgetTargetType,
  MonthlyInsights,
  ReferralProgress,
  TelegramProviderStatus,
  WorkspaceMember,
  WorkspaceMembership,
  WorkspaceMembershipStatus,
  WorkspaceRole
} from '../types';
import {
  mockCreateUser,
  mockGetUser,
  mockListUsers,
  mockUpdateUser,
  mockActivateUserSubscription,
  mockGetReferralProgress,
  mockGetAdminAnalytics,
  mockGetAdminWhatsAppProvider,
  mockSetAdminWhatsAppProvider,
  mockGetAdminPaymentSettings,
  mockSetAdminPaymentSettings,
  mockInitializeSubscriptionPayment,
  mockVerifySubscriptionPayment,
  mockGetTransactions,
  mockCreateTransaction,
  mockUpdateTransaction,
  mockConfirmTransaction,
  mockCorrectTransaction,
  mockGetWeeklySummary,
  mockGetMonthlySummary,
  mockGetCurrentInsights,
  mockGetMonthlyInsights,
  mockPostChatEntry,
  mockGetCurrentBudgets,
  mockPostBudget,
  mockGetWhatsAppProviderInfo,
  mockSendWhatsAppMessage
} from './mockApi';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const BACKEND_API_KEY = import.meta.env.VITE_BACKEND_API_KEY ?? '';
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? '';
const ALLOW_MOCK_FALLBACK = (
  import.meta.env.VITE_ALLOW_MOCK_FALLBACK
  ?? (BASE_URL === '' ? 'true' : 'false')
) === 'true';

const jsonHeaders: Record<string, string> = {
  'Content-Type': 'application/json'
};

if (BACKEND_API_KEY) {
  jsonHeaders['x-akonta-api-key'] = BACKEND_API_KEY;
}

const authHeaders: Record<string, string> = BACKEND_API_KEY
  ? { 'x-akonta-api-key': BACKEND_API_KEY }
  : {};
const adminHeaders: Record<string, string> = ADMIN_API_KEY
  ? { 'x-akonta-admin-key': ADMIN_API_KEY }
  : {};

let demoModeEnabled = false;
let demoModeCallback: (() => void) | null = null;
const LEGACY_USER_ID_KEY = 'akonta_user_id';
const AUTH_SESSION_KEY = 'akonta_auth_session';
const fallbackWorkspaceId = 'demo-workspace';
const fallbackWorkspaceName = 'Demo Workspace';
const fallbackWorkspaceMembers: WorkspaceMember[] = [];
const fallbackBusinessCategories: BusinessCategory[] = [];
const fallbackProductsServices: ProductService[] = [];
const fallbackCustomers: Customer[] = [];
const fallbackSuppliers: Supplier[] = [];
const fallbackLedgerAccounts: LedgerAccount[] = [];
const fallbackLedgerJournalEntries: LedgerJournalEntry[] = [];
const fallbackReconciliationSessions: ReconciliationSession[] = [];
const fallbackBalanceSheetSnapshot: BalanceSheetSnapshot = {
  asOf: new Date().toISOString(),
  assets: { lines: [], total: 0 },
  liabilities: { lines: [], total: 0 },
  equity: { lines: [], total: 0 },
  currentEarnings: { balance: 0 },
  totals: {
    assets: 0,
    liabilities: 0,
    equityBeforeEarnings: 0,
    equityAfterEarnings: 0,
    liabilitiesAndEquity: 0
  }
};

const buildFallbackOnboardingProfile = (profile: BusinessSettingsProfile): NonNullable<BusinessSettingsProfile['onboardingProfile']> => {
  const hasBusinessName = Boolean(profile.businessName?.trim());
  const hasBusinessType = Boolean(profile.businessType?.trim());
  const hasCurrencyCode = Boolean(profile.currencyCode?.trim());
  const hasTimezone = Boolean(profile.timezone?.trim());
  const hasPaymentMethods = Array.isArray(profile.enabledPaymentMethods) && profile.enabledPaymentMethods.length > 0;
  const requiredChecks = [hasBusinessName, hasBusinessType, hasCurrencyCode, hasTimezone, hasPaymentMethods];
  const requiredCompleted = requiredChecks.filter(Boolean).length;
  const requiredTotal = requiredChecks.length;
  const requiredCompletionPercent = Math.round((requiredCompleted / requiredTotal) * 100);

  const hasCategories = profile.setupCounts.categories > 0;
  const hasProducts = profile.setupCounts.products > 0;
  const hasCustomers = profile.setupCounts.customers > 0;
  const hasSuppliers = profile.setupCounts.suppliers > 0;
  const hasDefaultLedger = profile.setupCounts.ledgerAccounts > 0;
  const setupChecks = [hasCategories, hasProducts, hasCustomers, hasSuppliers];
  const setupCompleted = setupChecks.filter(Boolean).length;
  const setupTotal = setupChecks.length;
  const setupCompletionPercent = Math.round((setupCompleted / setupTotal) * 100);
  const overallCompletionPercent = Math.round((requiredCompletionPercent * 0.7) + (setupCompletionPercent * 0.3));

  return {
    required: {
      hasBusinessName,
      hasBusinessType,
      hasCurrencyCode,
      hasTimezone,
      hasPaymentMethods
    },
    setupModules: {
      hasCategories,
      hasProducts,
      hasCustomers,
      hasSuppliers,
      hasDefaultLedger
    },
    completion: {
      requiredCompleted,
      requiredTotal,
      requiredCompletionPercent,
      setupCompleted,
      setupTotal,
      setupCompletionPercent,
      overallCompletionPercent
    },
    isReadyForFirstRecord: requiredCompletionPercent === 100,
    isSetupSeeded: hasDefaultLedger || hasCategories
  };
};

let fallbackSettingsProfile: BusinessSettingsProfile = {
  id: fallbackWorkspaceId,
  businessName: fallbackWorkspaceName,
  businessType: 'Trading / Retail',
  currencyCode: 'GHS',
  timezone: 'Africa/Accra',
  enabledPaymentMethods: ['cash', 'momo'],
  onboardingVersion: 2,
  onboardingCompletedAt: null,
  setupCounts: {
    products: 0,
    customers: 0,
    suppliers: 0,
    categories: 0,
    ledgerAccounts: 14
  },
  onboardingProfile: undefined
};
fallbackSettingsProfile.onboardingProfile = buildFallbackOnboardingProfile(fallbackSettingsProfile);
let refreshInFlight: Promise<boolean> | null = null;

const readLegacyUserId = (): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    const value = window.localStorage.getItem(LEGACY_USER_ID_KEY);
    if (!value) return null;
    return value.trim() || null;
  } catch {
    return null;
  }
};

const persistLegacyUserId = (userId: string) => {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LEGACY_USER_ID_KEY, userId);
  } catch {
    // best-effort only
  }
};

export const setLegacyUserContext = (userId: string | null) => {
  if (!userId) {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(LEGACY_USER_ID_KEY);
    } catch {
      // best-effort only
    }
    return;
  }
  persistLegacyUserId(userId);
};

const readAuthSession = (): AuthSession | null => {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.userId || !parsed?.businessId || !parsed?.role) {
      return null;
    }
    return {
      userId: parsed.userId,
      businessId: parsed.businessId,
      role: parsed.role,
      membershipId: parsed.membershipId,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      accessExpiresIn: Number(parsed.accessExpiresIn ?? 0),
      refreshExpiresIn: Number(parsed.refreshExpiresIn ?? 0)
    };
  } catch {
    return null;
  }
};

const persistAuthSession = (session: AuthSession | null) => {
  try {
    if (typeof window === 'undefined') return;
    if (!session) {
      window.localStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // best-effort only
  }
};

export const getStoredAuthSession = (): AuthSession | null => readAuthSession();

export const setStoredAuthSession = (session: AuthSession | null) => {
  persistAuthSession(session);
};

export const clearStoredAuthSession = () => {
  persistAuthSession(null);
};

export class OfflineSyncError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'OfflineSyncError';
  }
}

const isNetworkLayerError = (message: string): boolean =>
  message.includes('Failed to fetch')
  || message.includes('NetworkError')
  || message.includes('Failed to connect')
  || message.includes('Load failed');

export const isOfflineSyncError = (error: unknown): error is OfflineSyncError =>
  error instanceof OfflineSyncError;

export const registerDemoModeListener = (callback: () => void) => {
  demoModeCallback = callback;
};

const refreshFallbackSetupCounts = () => {
  fallbackSettingsProfile = {
    ...fallbackSettingsProfile,
    setupCounts: {
      ...fallbackSettingsProfile.setupCounts,
      products: fallbackProductsServices.filter((entry) => entry.isActive).length,
      customers: fallbackCustomers.filter((entry) => entry.isActive).length,
      suppliers: fallbackSuppliers.filter((entry) => entry.isActive).length,
      categories: fallbackBusinessCategories.filter((entry) => entry.isActive).length
    }
  };
  fallbackSettingsProfile.onboardingProfile = buildFallbackOnboardingProfile(fallbackSettingsProfile);
};

const withStandardHeaders = (headers?: HeadersInit): Headers => {
  const mergedHeaders = new Headers(headers ?? {});
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!mergedHeaders.has(key)) {
      mergedHeaders.set(key, value);
    }
  }

  const authSession = readAuthSession();
  if (authSession?.accessToken && !mergedHeaders.has('authorization')) {
    mergedHeaders.set('authorization', `Bearer ${authSession.accessToken}`);
  }

  if (!authSession?.accessToken) {
    const legacyUserId = readLegacyUserId();
    if (legacyUserId && !mergedHeaders.has('x-akonta-user-id')) {
      mergedHeaders.set('x-akonta-user-id', legacyUserId);
    }
  }

  return mergedHeaders;
};

const refreshAuthTokens = async (): Promise<boolean> => {
  const currentSession = readAuthSession();
  if (!currentSession?.refreshToken) return false;

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const headers = withStandardHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken: currentSession.refreshToken })
      });

      if (!response.ok) {
        clearStoredAuthSession();
        return false;
      }

      const payload = await response.json() as {
        tokens: {
          accessToken: string;
          refreshToken: string;
          accessExpiresIn: number;
          refreshExpiresIn: number;
        };
        session?: {
          businessId?: string;
          role?: WorkspaceRole;
        };
      };

      const updatedSession: AuthSession = {
        ...currentSession,
        businessId: payload.session?.businessId ?? currentSession.businessId,
        role: payload.session?.role ?? currentSession.role,
        accessToken: payload.tokens.accessToken,
        refreshToken: payload.tokens.refreshToken,
        accessExpiresIn: payload.tokens.accessExpiresIn,
        refreshExpiresIn: payload.tokens.refreshExpiresIn
      };

      persistAuthSession(updatedSession);
      return true;
    } catch {
      clearStoredAuthSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
};

const fetchJson = async <T>(path: string, init?: RequestInit, options?: { skipRefresh?: boolean }): Promise<T> => {
  try {
    const mergedHeaders = withStandardHeaders(init?.headers);
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: mergedHeaders
    });
    if (!response.ok) {
      if (
        response.status === 401
        && !options?.skipRefresh
        && !path.startsWith('/api/auth/')
        && Boolean(readAuthSession()?.refreshToken)
      ) {
        const refreshed = await refreshAuthTokens();
        if (refreshed) {
          return fetchJson<T>(path, init, { skipRefresh: true });
        }
      }

      const text = await response.text();
      const isHtml = response.headers.get('content-type')?.includes('text/html');
      if ((BASE_URL === '' || response.status === 404 || isHtml) && ALLOW_MOCK_FALLBACK) {
        if (!demoModeEnabled) {
          demoModeEnabled = true;
          demoModeCallback?.();
        }
        return await fallbackApi(path, init) as T;
      }
      throw new Error(`API error ${response.status}: ${text}`);
    }
    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isNetworkLayerError(message)) {
      if (!ALLOW_MOCK_FALLBACK) {
        throw new OfflineSyncError(message);
      }
      if (!demoModeEnabled) {
        demoModeEnabled = true;
        demoModeCallback?.();
      }
      return await fallbackApi(path, init) as T;
    }
    throw error;
  }
};

const fetchAdminJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const mergedHeaders = new Headers(init?.headers ?? {});
  for (const [key, value] of Object.entries(adminHeaders)) {
    if (!mergedHeaders.has(key)) {
      mergedHeaders.set(key, value);
    }
  }
  return fetchJson<T>(path, {
    ...init,
    headers: mergedHeaders
  });
};

const fallbackApi = async (path: string, init?: RequestInit) => {
  const method = init?.method?.toUpperCase() || 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  if (path === '/api/users' && method === 'POST') {
    return mockCreateUser(body);
  }

  if (path === '/api/workspaces' && method === 'GET') {
    return [{
      membershipId: 'demo-membership-owner',
      businessId: fallbackWorkspaceId,
      businessName: fallbackWorkspaceName,
      role: 'owner',
      status: 'active'
    }] as WorkspaceMembership[];
  }

  if (path === '/api/workspaces/members' && method === 'GET') {
    return fallbackWorkspaceMembers;
  }

  if (path === '/api/workspaces/select' && method === 'POST') {
    return {
      businessId: body.businessId ?? fallbackWorkspaceId,
      role: 'owner' as WorkspaceRole,
      tokens: {
        accessToken: 'demo-access-token',
        refreshToken: 'demo-refresh-token',
        accessExpiresIn: 900,
        refreshExpiresIn: 2592000
      }
    };
  }

  if (path === '/api/workspaces/members/invite' && method === 'POST') {
    const entry: WorkspaceMember = {
      membershipId: `demo-member-${Date.now()}`,
      userId: `demo-user-${Date.now()}`,
      role: (body.role ?? 'cashier') as WorkspaceRole,
      status: 'invited',
      joinedAt: null,
      invitedByUserId: readLegacyUserId(),
      user: {
        id: `demo-user-${Date.now()}`,
        name: body.fullName ?? 'Invited member',
        fullName: body.fullName ?? 'Invited member',
        phoneNumber: body.phoneNumber ?? '0000000000',
        email: body.email ?? null,
        status: 'pending'
      }
    };
    fallbackWorkspaceMembers.push(entry);
    return {
      membershipId: entry.membershipId,
      userId: entry.userId,
      role: entry.role,
      status: entry.status
    };
  }

  if (path.match(/^\/api\/workspaces\/members\/[^/]+$/) && method === 'PATCH') {
    const membershipId = path.split('/').pop() as string;
    const index = fallbackWorkspaceMembers.findIndex((member) => member.membershipId === membershipId);
    if (index === -1) {
      throw new Error('Member not found.');
    }
    const current = fallbackWorkspaceMembers[index];
    const updated: WorkspaceMember = {
      ...current,
      role: (body.role ?? current.role) as WorkspaceRole,
      status: (body.status ?? current.status) as WorkspaceMembershipStatus
    };
    fallbackWorkspaceMembers[index] = updated;
    return {
      membershipId: updated.membershipId,
      role: updated.role,
      status: updated.status,
      joinedAt: updated.joinedAt
    };
  }

  if (path === '/api/settings/profile' && method === 'GET') {
    refreshFallbackSetupCounts();
    return fallbackSettingsProfile;
  }

  if (path === '/api/settings/profile' && method === 'PATCH') {
    const nextPaymentMethods = Array.isArray(body.enabledPaymentMethods)
      ? body.enabledPaymentMethods.filter((entry: unknown) => typeof entry === 'string') as BusinessPaymentMethod[]
      : fallbackSettingsProfile.enabledPaymentMethods;

    fallbackSettingsProfile = {
      ...fallbackSettingsProfile,
      businessName: typeof body.businessName === 'string' ? body.businessName : fallbackSettingsProfile.businessName,
      businessType: body.businessType === undefined ? fallbackSettingsProfile.businessType : body.businessType,
      currencyCode: typeof body.currencyCode === 'string' ? body.currencyCode : fallbackSettingsProfile.currencyCode,
      timezone: typeof body.timezone === 'string' ? body.timezone : fallbackSettingsProfile.timezone,
      enabledPaymentMethods: nextPaymentMethods,
      onboardingCompletedAt: body.onboardingCompleted
        ? new Date().toISOString()
        : fallbackSettingsProfile.onboardingCompletedAt
    };
    fallbackSettingsProfile.onboardingProfile = buildFallbackOnboardingProfile(fallbackSettingsProfile);
    return fallbackSettingsProfile;
  }

  if (path === '/api/settings/bootstrap-defaults' && method === 'POST') {
    const now = new Date().toISOString();
    const pushCategory = (kind: 'sales' | 'expense', name: string) => {
      const normalized = name.toLowerCase();
      const existing = fallbackBusinessCategories.find((entry) => entry.kind === kind && entry.normalizedName === normalized);
      if (existing) return;
      fallbackBusinessCategories.push({
        id: `cat-${kind}-${normalized.replace(/\s+/g, '-')}`,
        businessId: fallbackWorkspaceId,
        kind,
        name,
        normalizedName: normalized,
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now
      });
    };
    pushCategory('sales', 'General sales');
    pushCategory('expense', 'Operating expenses');
    refreshFallbackSetupCounts();
    return { success: true };
  }

  if (path === '/api/settings/categories' && method === 'GET') {
    return fallbackBusinessCategories;
  }

  if (path === '/api/settings/categories' && method === 'POST') {
    const now = new Date().toISOString();
    const normalizedName = String(body.name ?? '').trim().toLowerCase();
    const existing = fallbackBusinessCategories.find((entry) =>
      entry.kind === body.kind && entry.normalizedName === normalizedName
    );
    if (existing) {
      existing.name = String(body.name ?? existing.name);
      existing.isActive = true;
      existing.updatedAt = now;
      refreshFallbackSetupCounts();
      return existing;
    }
    const created: BusinessCategory = {
      id: `cat-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      kind: body.kind ?? 'expense',
      name: String(body.name ?? 'Category'),
      normalizedName,
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    fallbackBusinessCategories.push(created);
    refreshFallbackSetupCounts();
    return created;
  }

  if (path.match(/^\/api\/settings\/categories\/[^/]+$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const id = path.split('/').pop() as string;
    const existing = fallbackBusinessCategories.find((entry) => entry.id === id);
    if (!existing) throw new Error('Category not found');
    if (body.kind !== undefined) existing.kind = body.kind;
    if (body.name !== undefined) {
      const normalizedName = String(body.name).trim().toLowerCase();
      existing.name = String(body.name);
      existing.normalizedName = normalizedName;
    }
    if (body.isActive !== undefined) existing.isActive = Boolean(body.isActive);
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path.match(/^\/api\/settings\/categories\/[^/]+\/deactivate$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const segments = path.split('/');
    const id = segments[segments.length - 2] as string;
    const existing = fallbackBusinessCategories.find((entry) => entry.id === id);
    if (!existing) throw new Error('Category not found');
    existing.isActive = false;
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path === '/api/settings/products-services' && method === 'GET') {
    return fallbackProductsServices;
  }

  if (path === '/api/settings/products-services' && method === 'POST') {
    const now = new Date().toISOString();
    const normalizedName = String(body.name ?? '').trim().toLowerCase();
    const existing = fallbackProductsServices.find((entry) => entry.normalizedName === normalizedName);
    if (existing) {
      existing.name = String(body.name ?? existing.name);
      existing.type = body.type ?? existing.type;
      existing.defaultPrice = body.defaultPrice ?? existing.defaultPrice;
      existing.estimatedCost = body.estimatedCost ?? existing.estimatedCost;
      existing.categoryId = body.categoryId ?? existing.categoryId ?? null;
      existing.isActive = true;
      existing.updatedAt = now;
      refreshFallbackSetupCounts();
      return existing;
    }
    const category = fallbackBusinessCategories.find((entry) => entry.id === body.categoryId) ?? null;
    const created: ProductService = {
      id: `ps-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      categoryId: body.categoryId ?? null,
      name: String(body.name ?? 'Item'),
      normalizedName,
      type: body.type ?? 'product',
      defaultPrice: body.defaultPrice ?? null,
      estimatedCost: body.estimatedCost ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      category
    };
    fallbackProductsServices.push(created);
    refreshFallbackSetupCounts();
    return created;
  }

  if (path.match(/^\/api\/settings\/products-services\/[^/]+$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const id = path.split('/').pop() as string;
    const existing = fallbackProductsServices.find((entry) => entry.id === id);
    if (!existing) throw new Error('Product/service not found');
    if (body.name !== undefined) {
      existing.name = String(body.name);
      existing.normalizedName = String(body.name).trim().toLowerCase();
    }
    if (body.type !== undefined) existing.type = body.type;
    if (body.defaultPrice !== undefined) existing.defaultPrice = body.defaultPrice;
    if (body.estimatedCost !== undefined) existing.estimatedCost = body.estimatedCost;
    if (body.categoryId !== undefined) existing.categoryId = body.categoryId;
    if (body.isActive !== undefined) existing.isActive = Boolean(body.isActive);
    existing.category = fallbackBusinessCategories.find((entry) => entry.id === existing.categoryId) ?? null;
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path.match(/^\/api\/settings\/products-services\/[^/]+\/deactivate$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const segments = path.split('/');
    const id = segments[segments.length - 2] as string;
    const existing = fallbackProductsServices.find((entry) => entry.id === id);
    if (!existing) throw new Error('Product/service not found');
    existing.isActive = false;
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path === '/api/settings/customers' && method === 'GET') {
    return fallbackCustomers;
  }

  if (path === '/api/settings/customers' && method === 'POST') {
    const now = new Date().toISOString();
    const normalizedName = String(body.name ?? '').trim().toLowerCase();
    const existing = fallbackCustomers.find((entry) => entry.normalizedName === normalizedName);
    if (existing) {
      existing.name = String(body.name ?? existing.name);
      existing.phoneNumber = body.phoneNumber ?? existing.phoneNumber ?? null;
      existing.notes = body.notes ?? existing.notes ?? null;
      existing.openingReceivable = Number(body.openingReceivable ?? existing.openingReceivable ?? 0);
      existing.isActive = true;
      existing.updatedAt = now;
      refreshFallbackSetupCounts();
      return existing;
    }
    const created: Customer = {
      id: `cust-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      name: String(body.name ?? 'Customer'),
      normalizedName,
      phoneNumber: body.phoneNumber ?? null,
      notes: body.notes ?? null,
      openingReceivable: Number(body.openingReceivable ?? 0),
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    fallbackCustomers.push(created);
    refreshFallbackSetupCounts();
    return created;
  }

  if (path.match(/^\/api\/settings\/customers\/[^/]+$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const id = path.split('/').pop() as string;
    const existing = fallbackCustomers.find((entry) => entry.id === id);
    if (!existing) throw new Error('Customer not found');
    if (body.name !== undefined) {
      existing.name = String(body.name);
      existing.normalizedName = String(body.name).trim().toLowerCase();
    }
    if (body.phoneNumber !== undefined) existing.phoneNumber = body.phoneNumber;
    if (body.notes !== undefined) existing.notes = body.notes;
    if (body.openingReceivable !== undefined) existing.openingReceivable = Number(body.openingReceivable ?? 0);
    if (body.isActive !== undefined) existing.isActive = Boolean(body.isActive);
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path.match(/^\/api\/settings\/customers\/[^/]+\/deactivate$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const segments = path.split('/');
    const id = segments[segments.length - 2] as string;
    const existing = fallbackCustomers.find((entry) => entry.id === id);
    if (!existing) throw new Error('Customer not found');
    existing.isActive = false;
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path === '/api/settings/suppliers' && method === 'GET') {
    return fallbackSuppliers;
  }

  if (path === '/api/settings/ledger-accounts' && method === 'GET') {
    return fallbackLedgerAccounts;
  }

  if (path === '/api/settings/ledger-accounts' && method === 'POST') {
    const now = new Date().toISOString();
    const code = String(body.code ?? '').trim().toUpperCase();
    const name = String(body.name ?? '').trim();
    const accountType = (body.accountType ?? 'expense') as LedgerAccount['accountType'];
    const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
    const created: LedgerAccount = {
      id: `ledger-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      code,
      name,
      normalizedName: name.toLowerCase(),
      accountType,
      isSystemDefault: false,
      isActive: true,
      parentId,
      createdAt: now,
      updatedAt: now
    };
    fallbackLedgerAccounts.push(created);
    return created;
  }

  if (path.match(/^\/api\/settings\/ledger-accounts\/[^/]+$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const id = path.split('/').pop() as string;
    const existing = fallbackLedgerAccounts.find((entry) => entry.id === id);
    if (!existing) throw new Error('Ledger account not found');
    if (body.code !== undefined) existing.code = String(body.code).trim().toUpperCase();
    if (body.name !== undefined) {
      existing.name = String(body.name).trim();
      existing.normalizedName = existing.name.toLowerCase();
    }
    if (body.parentId !== undefined) existing.parentId = body.parentId;
    if (body.isActive !== undefined) existing.isActive = Boolean(body.isActive);
    existing.updatedAt = now;
    return existing;
  }

  if (path.match(/^\/api\/settings\/ledger-accounts\/[^/]+\/deactivate$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const segments = path.split('/');
    const id = segments[segments.length - 2] as string;
    const existing = fallbackLedgerAccounts.find((entry) => entry.id === id);
    if (!existing) throw new Error('Ledger account not found');
    existing.isActive = false;
    existing.updatedAt = now;
    return existing;
  }

  if (path === '/api/settings/journal-entries' && method === 'GET') {
    return fallbackLedgerJournalEntries;
  }

  if (path === '/api/settings/journal-entries' && method === 'POST') {
    const now = new Date().toISOString();
    const entryId = `journal-${Date.now()}`;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const createdLines = lines.map((line: Record<string, unknown>, index: number): LedgerJournalEntry['lines'][number] => {
      const accountId = String(line.accountId ?? '');
      const account = fallbackLedgerAccounts.find((entry) => entry.id === accountId) ?? {
        id: accountId,
        code: '9999',
        name: 'Unknown account',
        accountType: 'expense' as const
      };
      return {
        id: `${entryId}-line-${index + 1}`,
        accountId: account.id,
        debitAmount: Number(line.debitAmount ?? 0),
        creditAmount: Number(line.creditAmount ?? 0),
        memo: typeof line.memo === 'string' ? line.memo : null,
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          accountType: account.accountType
        }
      };
    });

    const created: LedgerJournalEntry = {
      id: entryId,
      businessId: fallbackWorkspaceId,
      transactionId: null,
      entryDate: body.entryDate ?? now,
      description: typeof body.description === 'string' ? body.description : null,
      status: 'posted',
      source: 'manual',
      createdByUserId: 'demo-user',
      approvedByUserId: null,
      createdAt: now,
      updatedAt: now,
      transaction: null,
      lines: createdLines
    };
    fallbackLedgerJournalEntries.unshift(created);
    return created;
  }

  if (path.startsWith('/api/settings/balance-sheet') && method === 'GET') {
    return fallbackBalanceSheetSnapshot;
  }

  if (path.startsWith('/api/settings/reconciliation-sessions') && method === 'GET') {
    const url = new URL(path, 'http://fallback.local');
    const channel = url.searchParams.get('channel');
    const limit = Number(url.searchParams.get('limit') ?? 10);
    const filtered = channel === 'cash' || channel === 'momo'
      ? fallbackReconciliationSessions.filter((entry) => entry.channel === channel)
      : fallbackReconciliationSessions;
    return filtered.slice(0, limit);
  }

  if (path === '/api/settings/reconciliation-sessions' && method === 'POST') {
    const created: ReconciliationSession = {
      id: `recon-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      createdByUserId: 'demo-user',
      channel: body.channel ?? 'cash',
      asOf: body.asOf ?? new Date().toISOString(),
      bookBalance: Number(body.bookBalance ?? 0),
      countedBalance: Number(body.countedBalance ?? 0),
      variance: Number(body.countedBalance ?? 0) - Number(body.bookBalance ?? 0),
      notes: body.notes ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdByUser: {
        id: 'demo-user',
        name: 'Demo User',
        fullName: 'Demo User'
      }
    };
    fallbackReconciliationSessions.unshift(created);
    return created;
  }

  if (path === '/api/settings/suppliers' && method === 'POST') {
    const now = new Date().toISOString();
    const normalizedName = String(body.name ?? '').trim().toLowerCase();
    const existing = fallbackSuppliers.find((entry) => entry.normalizedName === normalizedName);
    if (existing) {
      existing.name = String(body.name ?? existing.name);
      existing.phoneNumber = body.phoneNumber ?? existing.phoneNumber ?? null;
      existing.supplyType = body.supplyType ?? existing.supplyType ?? null;
      existing.notes = body.notes ?? existing.notes ?? null;
      existing.openingPayable = Number(body.openingPayable ?? existing.openingPayable ?? 0);
      existing.isActive = true;
      existing.updatedAt = now;
      refreshFallbackSetupCounts();
      return existing;
    }
    const created: Supplier = {
      id: `sup-${Date.now()}`,
      businessId: fallbackWorkspaceId,
      name: String(body.name ?? 'Supplier'),
      normalizedName,
      phoneNumber: body.phoneNumber ?? null,
      supplyType: body.supplyType ?? null,
      notes: body.notes ?? null,
      openingPayable: Number(body.openingPayable ?? 0),
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    fallbackSuppliers.push(created);
    refreshFallbackSetupCounts();
    return created;
  }

  if (path.match(/^\/api\/settings\/suppliers\/[^/]+$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const id = path.split('/').pop() as string;
    const existing = fallbackSuppliers.find((entry) => entry.id === id);
    if (!existing) throw new Error('Supplier not found');
    if (body.name !== undefined) {
      existing.name = String(body.name);
      existing.normalizedName = String(body.name).trim().toLowerCase();
    }
    if (body.phoneNumber !== undefined) existing.phoneNumber = body.phoneNumber;
    if (body.supplyType !== undefined) existing.supplyType = body.supplyType;
    if (body.notes !== undefined) existing.notes = body.notes;
    if (body.openingPayable !== undefined) existing.openingPayable = Number(body.openingPayable ?? 0);
    if (body.isActive !== undefined) existing.isActive = Boolean(body.isActive);
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path.match(/^\/api\/settings\/suppliers\/[^/]+\/deactivate$/) && method === 'PATCH') {
    const now = new Date().toISOString();
    const segments = path.split('/');
    const id = segments[segments.length - 2] as string;
    const existing = fallbackSuppliers.find((entry) => entry.id === id);
    if (!existing) throw new Error('Supplier not found');
    existing.isActive = false;
    existing.updatedAt = now;
    refreshFallbackSetupCounts();
    return existing;
  }

  if (path.match(/^\/api\/users\/[^/]+\/referrals$/) && method === 'GET') {
    const id = path.split('/')[3] as string;
    return mockGetReferralProgress(id);
  }

  if (path.match(/^\/api\/users\/[^/]+\/subscription$/) && method === 'POST') {
    const id = path.split('/')[3] as string;
    return mockActivateUserSubscription(id, body);
  }

  if (path.match(/^\/api\/users\/[^/]+$/) && method === 'PATCH') {
    const id = path.split('/').pop() as string;
    return mockUpdateUser(id, body);
  }

  if (path.startsWith('/api/transactions') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    const txs = await mockGetTransactions(params.get('userId') ?? '');
    const status = params.get('status');
    const eventType = params.get('eventType');
    const includeCorrections = params.get('includeCorrections') === 'true';
    return txs.filter((tx) => {
      if (status && tx.status !== status) return false;
      if (eventType && tx.eventType !== eventType) return false;
      if (!includeCorrections && tx.correctionOfId) return false;
      return true;
    });
  }

  if (path === '/api/transactions' && method === 'POST') {
    return mockCreateTransaction(body);
  }

  if (path.match(/^\/api\/transactions\/[^/]+$/) && method === 'PATCH') {
    const id = path.split('/').pop() as string;
    return mockUpdateTransaction(id, body);
  }

  if (path.match(/^\/api\/transactions\/[^/]+\/confirm$/) && method === 'PATCH') {
    const parts = path.split('/');
    const id = parts[parts.length - 2] as string;
    return mockConfirmTransaction(id);
  }

  if (path.match(/^\/api\/transactions\/[^/]+\/corrections$/) && method === 'POST') {
    const parts = path.split('/');
    const id = parts[parts.length - 2] as string;
    return mockCorrectTransaction(id, body);
  }

  if (path.startsWith('/api/summaries/weekly') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetWeeklySummary(params.get('userId') ?? '', params.get('start') ?? '', params.get('end') ?? '');
  }

  if (path.startsWith('/api/summaries/monthly') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetMonthlySummary(params.get('userId') ?? '', Number(params.get('year')), Number(params.get('month')));
  }

  if (path.startsWith('/api/insights/current') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetCurrentInsights(params.get('userId') ?? '');
  }

  if (path.startsWith('/api/insights/monthly') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetMonthlyInsights(params.get('userId') ?? '', Number(params.get('year')), Number(params.get('month')));
  }

  if (path === '/api/whatsapp/providers' && method === 'GET') {
    return mockGetWhatsAppProviderInfo();
  }

  if (path === '/api/telegram/status' && method === 'GET') {
    return {
      enabled: false,
      webhookSecretConfigured: false
    } satisfies TelegramProviderStatus;
  }

  if (path === '/api/budgets/current' && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetCurrentBudgets(params.get('userId') ?? '');
  }

  if (path === '/api/budgets' && method === 'POST') {
    return mockPostBudget(body);
  }

  if (path === '/api/chat' && method === 'POST') {
    return mockPostChatEntry(body.userId, body.message);
  }

  if (path === '/api/whatsapp/send' && method === 'POST') {
    return mockSendWhatsAppMessage(body.to, body.message, body.provider);
  }

  if (path === '/api/whatsapp/webhook' && method === 'POST') {
    return mockPostChatEntry(body.userId, body.message);
  }

  if (path.startsWith('/api/users/') && method === 'GET') {
    const userId = path.split('/').pop();
    const user = await mockGetUser(userId ?? '');
    if (!user) throw new Error('User not found');
    return user;
  }

  if (path === '/api/users' && method === 'GET') {
    return mockListUsers();
  }

  if (path === '/api/admin/analytics' && method === 'GET') {
    return mockGetAdminAnalytics();
  }

  if (path === '/api/admin/settings/whatsapp-provider' && method === 'GET') {
    return mockGetAdminWhatsAppProvider();
  }

  if (path === '/api/admin/settings/whatsapp-provider' && method === 'PATCH') {
    return mockSetAdminWhatsAppProvider(body);
  }

  if (path === '/api/admin/settings/payment' && method === 'GET') {
    return mockGetAdminPaymentSettings();
  }

  if (path === '/api/admin/settings/payment' && method === 'PATCH') {
    return mockSetAdminPaymentSettings(body);
  }

  if (path === '/api/subscriptions/initialize' && method === 'POST') {
    return mockInitializeSubscriptionPayment(body);
  }

  if (path === '/api/subscriptions/verify' && method === 'POST') {
    return mockVerifySubscriptionPayment(body);
  }

  throw new Error('No mock implementation for ' + method + ' ' + path);
};

export const createUser = async (
  user: Partial<User> & { paymentMethods?: BusinessPaymentMethod[] }
): Promise<User> => {
  const created = await fetchJson<User>('/api/users', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(user)
  });
  persistLegacyUserId(created.id);
  return created;
};

export const requestOtp = async (phoneNumber: string): Promise<AuthOtpRequestResponse> => {
  return fetchJson<AuthOtpRequestResponse>('/api/auth/request-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ phoneNumber })
  });
};

export const verifyOtp = async (payload: {
  phoneNumber: string;
  code: string;
  businessId?: string;
}): Promise<AuthVerifyResponse> => {
  const result = await fetchJson<AuthVerifyResponse>('/api/auth/verify-otp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });

  persistAuthSession({
    userId: result.user.id,
    businessId: result.session.businessId,
    role: result.session.role,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresIn: result.tokens.accessExpiresIn,
    refreshExpiresIn: result.tokens.refreshExpiresIn
  });
  persistLegacyUserId(result.user.id);
  return result;
};

export const logoutSession = async (): Promise<void> => {
  const session = readAuthSession();
  if (session?.refreshToken) {
    try {
      await fetchJson<{ success: boolean }>(
        '/api/auth/logout',
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ refreshToken: session.refreshToken })
        },
        { skipRefresh: true }
      );
    } catch {
      // Best-effort only
    }
  }
  clearStoredAuthSession();
};

export const refreshAuthSession = async (): Promise<boolean> => {
  return refreshAuthTokens();
};

export const getUser = async (id: string): Promise<User> => {
  const user = await fetchJson<User>(`/api/users/${id}`);
  setLegacyUserContext(user.id);
  return user;
};

export const updateUser = async (
  id: string,
  updates: Partial<Pick<User, 'name' | 'businessName' | 'businessType' | 'preferredTime' | 'timezone' | 'currencyCode'>>
): Promise<User> => {
  const user = await fetchJson<User>(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates)
  });
  setLegacyUserContext(user.id);
  return user;
};

export const getBusinessSettingsProfile = async (): Promise<BusinessSettingsProfile> => {
  return fetchJson<BusinessSettingsProfile>('/api/settings/profile');
};

export const updateBusinessSettingsProfile = async (payload: {
  businessName?: string;
  businessType?: string | null;
  currencyCode?: string;
  timezone?: string | null;
  enabledPaymentMethods?: BusinessPaymentMethod[] | null;
  onboardingCompleted?: boolean;
}): Promise<BusinessSettingsProfile> => {
  return fetchJson<BusinessSettingsProfile>('/api/settings/profile', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const bootstrapBusinessDefaults = async (): Promise<{ success: boolean }> => {
  return fetchJson<{ success: boolean }>('/api/settings/bootstrap-defaults', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getBusinessCategories = async (): Promise<BusinessCategory[]> => {
  return fetchJson<BusinessCategory[]>('/api/settings/categories');
};

export const createBusinessCategory = async (payload: {
  kind: 'sales' | 'expense';
  name: string;
}): Promise<BusinessCategory> => {
  return fetchJson<BusinessCategory>('/api/settings/categories', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateBusinessCategory = async (id: string, payload: {
  kind?: 'sales' | 'expense';
  name?: string;
  isActive?: boolean;
}): Promise<BusinessCategory> => {
  return fetchJson<BusinessCategory>(`/api/settings/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const deactivateBusinessCategory = async (id: string): Promise<BusinessCategory> => {
  return fetchJson<BusinessCategory>(`/api/settings/categories/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getProductsServices = async (): Promise<ProductService[]> => {
  return fetchJson<ProductService[]>('/api/settings/products-services');
};

export const createProductService = async (payload: {
  name: string;
  type: 'product' | 'service';
  defaultPrice?: number | null;
  estimatedCost?: number | null;
  categoryId?: string | null;
}): Promise<ProductService> => {
  return fetchJson<ProductService>('/api/settings/products-services', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateProductService = async (id: string, payload: {
  name?: string;
  type?: 'product' | 'service';
  defaultPrice?: number | null;
  estimatedCost?: number | null;
  categoryId?: string | null;
  isActive?: boolean;
}): Promise<ProductService> => {
  return fetchJson<ProductService>(`/api/settings/products-services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const deactivateProductService = async (id: string): Promise<ProductService> => {
  return fetchJson<ProductService>(`/api/settings/products-services/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getCustomers = async (): Promise<Customer[]> => {
  return fetchJson<Customer[]>('/api/settings/customers');
};

export const createCustomer = async (payload: {
  name: string;
  phoneNumber?: string | null;
  notes?: string | null;
  openingReceivable?: number | null;
}): Promise<Customer> => {
  return fetchJson<Customer>('/api/settings/customers', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateCustomer = async (id: string, payload: {
  name?: string;
  phoneNumber?: string | null;
  notes?: string | null;
  openingReceivable?: number | null;
  isActive?: boolean;
}): Promise<Customer> => {
  return fetchJson<Customer>(`/api/settings/customers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const deactivateCustomer = async (id: string): Promise<Customer> => {
  return fetchJson<Customer>(`/api/settings/customers/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getSuppliers = async (): Promise<Supplier[]> => {
  return fetchJson<Supplier[]>('/api/settings/suppliers');
};

export const getLedgerAccounts = async (): Promise<LedgerAccount[]> => {
  return fetchJson<LedgerAccount[]>('/api/settings/ledger-accounts');
};

export const createLedgerAccount = async (payload: CreateLedgerAccountPayload): Promise<LedgerAccount> => {
  return fetchJson<LedgerAccount>('/api/settings/ledger-accounts', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateLedgerAccount = async (id: string, payload: {
  code?: string;
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
}): Promise<LedgerAccount> => {
  return fetchJson<LedgerAccount>(`/api/settings/ledger-accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const deactivateLedgerAccount = async (id: string): Promise<LedgerAccount> => {
  return fetchJson<LedgerAccount>(`/api/settings/ledger-accounts/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getLedgerJournalEntries = async (): Promise<LedgerJournalEntry[]> => {
  return fetchJson<LedgerJournalEntry[]>('/api/settings/journal-entries');
};

export const createManualJournalEntry = async (payload: CreateManualJournalEntryPayload): Promise<LedgerJournalEntry> => {
  return fetchJson<LedgerJournalEntry>('/api/settings/journal-entries', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const getBalanceSheetSnapshot = async (asOf?: string): Promise<BalanceSheetSnapshot> => {
  const search = new URLSearchParams();
  if (asOf) search.set('asOf', asOf);
  const path = search.toString()
    ? `/api/settings/balance-sheet?${search.toString()}`
    : '/api/settings/balance-sheet';
  return fetchJson<BalanceSheetSnapshot>(path);
};

export const getReconciliationSessions = async (params?: {
  channel?: 'cash' | 'momo';
  limit?: number;
}): Promise<ReconciliationSession[]> => {
  const search = new URLSearchParams();
  if (params?.channel) search.set('channel', params.channel);
  if (params?.limit !== undefined) search.set('limit', String(params.limit));
  const path = search.toString()
    ? `/api/settings/reconciliation-sessions?${search.toString()}`
    : '/api/settings/reconciliation-sessions';
  return fetchJson<ReconciliationSession[]>(path);
};

export const createReconciliationSession = async (payload: {
  channel: 'cash' | 'momo';
  asOf?: string;
  bookBalance: number;
  countedBalance: number;
  notes?: string | null;
}): Promise<ReconciliationSession> => {
  return fetchJson<ReconciliationSession>('/api/settings/reconciliation-sessions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const getPendingApprovals = async (): Promise<PendingTransactionApproval[]> => {
  return fetchJson<PendingTransactionApproval[]>('/api/transactions/approvals/pending');
};

export const reviewPendingApproval = async (
  approvalId: string,
  payload: { action: 'approve' | 'reject'; note?: string }
): Promise<PendingTransactionApproval> => {
  return fetchJson<PendingTransactionApproval>(`/api/transactions/approvals/${encodeURIComponent(approvalId)}/review`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const createSupplier = async (payload: {
  name: string;
  phoneNumber?: string | null;
  supplyType?: string | null;
  notes?: string | null;
  openingPayable?: number | null;
}): Promise<Supplier> => {
  return fetchJson<Supplier>('/api/settings/suppliers', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateSupplier = async (id: string, payload: {
  name?: string;
  phoneNumber?: string | null;
  supplyType?: string | null;
  notes?: string | null;
  openingPayable?: number | null;
  isActive?: boolean;
}): Promise<Supplier> => {
  return fetchJson<Supplier>(`/api/settings/suppliers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const deactivateSupplier = async (id: string): Promise<Supplier> => {
  return fetchJson<Supplier>(`/api/settings/suppliers/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({})
  });
};

export const getWorkspaces = async (): Promise<WorkspaceMembership[]> => {
  return fetchJson<WorkspaceMembership[]>('/api/workspaces');
};

export const selectWorkspace = async (businessId: string): Promise<{
  businessId: string;
  role: WorkspaceRole;
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresIn: number;
    refreshExpiresIn: number;
  };
}> => {
  const result = await fetchJson<{
    businessId: string;
    role: WorkspaceRole;
    tokens: {
      accessToken: string;
      refreshToken: string;
      accessExpiresIn: number;
      refreshExpiresIn: number;
    };
  }>('/api/workspaces/select', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ businessId })
  });

  const session = readAuthSession();
  if (session) {
    persistAuthSession({
      ...session,
      businessId: result.businessId,
      role: result.role,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      accessExpiresIn: result.tokens.accessExpiresIn,
      refreshExpiresIn: result.tokens.refreshExpiresIn
    });
  }

  return result;
};

export const getWorkspaceMembers = async (): Promise<WorkspaceMember[]> => {
  return fetchJson<WorkspaceMember[]>('/api/workspaces/members');
};

export const inviteWorkspaceMember = async (payload: {
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role: WorkspaceRole;
}): Promise<{
  membershipId: string;
  userId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
}> => {
  return fetchJson<{
    membershipId: string;
    userId: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
  }>('/api/workspaces/members/invite', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const updateWorkspaceMember = async (
  membershipId: string,
  payload: { role?: WorkspaceRole; status?: WorkspaceMembershipStatus }
): Promise<{
  membershipId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  joinedAt?: string | null;
}> => {
  return fetchJson<{
    membershipId: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
    joinedAt?: string | null;
  }>(`/api/workspaces/members/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const getReferralProgress = async (userId: string): Promise<ReferralProgress> => {
  return fetchJson<ReferralProgress>(`/api/users/${encodeURIComponent(userId)}/referrals`);
};

export const activateUserSubscription = async (
  userId: string,
  payload: {
    status?: 'free' | 'basic' | 'premium' | 'trial';
    source?: 'trial' | 'paid' | 'referral_bonus' | 'admin_adjustment';
    months?: number;
    note?: string;
  }
): Promise<User> => {
  return fetchJson<User>(`/api/users/${encodeURIComponent(userId)}/subscription`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const getTransactions = async (userId: string): Promise<Transaction[]> => {
  return fetchJson<Transaction[]>(`/api/transactions?userId=${encodeURIComponent(userId)}`);
};

export const getTransactionsWithFilters = async (params: {
  userId: string;
  type?: 'revenue' | 'expense';
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
  start?: string;
  end?: string;
  includeCorrections?: boolean;
}): Promise<Transaction[]> => {
  const search = new URLSearchParams({ userId: params.userId });
  if (params.type) search.set('type', params.type);
  if (params.eventType) search.set('eventType', params.eventType);
  if (params.status) search.set('status', params.status);
  if (params.start) search.set('start', params.start);
  if (params.end) search.set('end', params.end);
  if (params.includeCorrections) search.set('includeCorrections', 'true');
  return fetchJson<Transaction[]>(`/api/transactions?${search.toString()}`);
};

export const getWeeklySummary = async (userId: string, start: string, end: string) => {
  return fetchJson<{ periodType: 'weekly'; periodStart: string; periodEnd: string; summary: SummaryPayload }>(
    `/api/summaries/weekly?userId=${encodeURIComponent(userId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
};

export const getMonthlySummary = async (userId: string, year: number, month: number) => {
  return fetchJson<{ periodType: 'monthly'; periodStart: string; periodEnd: string; summary: SummaryPayload }>(
    `/api/summaries/monthly?userId=${encodeURIComponent(userId)}&year=${year}&month=${month}`
  );
};

export const getCurrentInsights = async (userId: string) => {
  return fetchJson<MonthlyInsights>(`/api/insights/current?userId=${encodeURIComponent(userId)}`);
};

export const getMonthlyInsights = async (userId: string, year: number, month: number) => {
  return fetchJson<MonthlyInsights>(
    `/api/insights/monthly?userId=${encodeURIComponent(userId)}&year=${year}&month=${month}`
  );
};

export const getSavedSummaries = async (userId: string, periodType?: 'weekly' | 'monthly', year?: number, month?: number) => {
  const params = new URLSearchParams({ userId });
  if (periodType) params.set('periodType', periodType);
  if (year !== undefined && month !== undefined) {
    params.set('year', String(year));
    params.set('month', String(month));
  }

  return fetchJson<unknown>(`/api/summaries?${params.toString()}`);
};

export const getSummaryById = async (id: string) => {
  return fetchJson<unknown>(`/api/summaries/${encodeURIComponent(id)}`);
};

export const getWhatsAppProviderInfo = async (): Promise<{ default: WhatsAppProvider; available: WhatsAppProvider[] }> => {
  return fetchJson<{ default: WhatsAppProvider; available: WhatsAppProvider[] }>('/api/whatsapp/providers');
};

export const getTelegramProviderStatus = async (): Promise<TelegramProviderStatus> => {
  return fetchJson<TelegramProviderStatus>('/api/telegram/status');
};

export const getAdminAnalytics = async (): Promise<AdminAnalytics> => {
  return fetchAdminJson<AdminAnalytics>('/api/admin/analytics');
};

export const getAdminWhatsAppProvider = async (): Promise<AdminWhatsAppSettings> => {
  return fetchAdminJson<AdminWhatsAppSettings>(
    '/api/admin/settings/whatsapp-provider'
  );
};

export const setAdminWhatsAppProvider = async (
  payload: {
    provider?: WhatsAppProvider;
    whatchimp?: Partial<AdminWhatsAppSettings['whatchimp']>;
  }
): Promise<AdminWhatsAppSettings> => {
  return fetchAdminJson<AdminWhatsAppSettings>(
    '/api/admin/settings/whatsapp-provider',
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload)
    }
  );
};

export const getAdminPaymentSettings = async (): Promise<AdminPaymentSettings> => {
  return fetchAdminJson<AdminPaymentSettings>('/api/admin/settings/payment');
};

export const setAdminPaymentSettings = async (
  payload: Partial<AdminPaymentSettings>
): Promise<AdminPaymentSettings> => {
  return fetchAdminJson<AdminPaymentSettings>('/api/admin/settings/payment', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const initializeSubscriptionPayment = async (payload: {
  userId: string;
  plan?: 'basic' | 'premium';
  months?: number;
  callbackUrl?: string;
  customerEmail?: string;
}): Promise<SubscriptionPaymentInitialization> => {
  return fetchJson<SubscriptionPaymentInitialization>('/api/subscriptions/initialize', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
};

export const verifySubscriptionPayment = async (reference: string): Promise<SubscriptionPaymentVerification> => {
  return fetchJson<SubscriptionPaymentVerification>('/api/subscriptions/verify', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ reference })
  });
};

export const getCurrentBudgets = async (userId: string): Promise<Budget[]> => {
  return fetchJson<Budget[]>(`/api/budgets/current?userId=${encodeURIComponent(userId)}`);
};

export const postBudget = async (budget: {
  userId: string;
  year: number;
  month: number;
  targetType: BudgetTargetType;
  amount: number;
  category?: string;
  notes?: string;
}): Promise<Budget> => {
  return fetchJson<Budget>('/api/budgets', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(budget)
  });
};

export const postChatEntry = async (
  userId: string,
  message: string,
  channel: 'web' | 'whatsapp' | 'telegram' = 'web'
): Promise<{
  botReply: string;
  conversation: {
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
    awaitingConfirmation: boolean;
  };
  transactions: Transaction[];
  summary: SummaryPayload;
  monthlySummary: SummaryPayload;
  budgetStatuses: BudgetStatus[];
}> => {
  return fetchJson<{
    botReply: string;
    conversation: {
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
      awaitingConfirmation: boolean;
    };
    transactions: Transaction[];
    summary: SummaryPayload;
    monthlySummary: SummaryPayload;
    budgetStatuses: BudgetStatus[];
  }>('/api/chat', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ userId, message, channel })
  });
};

export const sendWhatsAppMessage = async (to: string, message: string, provider?: string) => {
  return fetchJson<{ success: boolean; provider: string; result: any }>('/api/whatsapp/send', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ to, message, provider })
  });
};

export const createTransaction = async (transaction: {
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
  date?: string;
  category?: string;
  notes?: string;
  correctionReason?: string;
}): Promise<Transaction> => {
  return fetchJson<Transaction>('/api/transactions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(transaction)
  });
};

export const updateTransaction = async (
  id: string,
  updates: {
    type?: 'revenue' | 'expense';
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
    amount?: number;
    date?: string;
    category?: string | null;
    notes?: string | null;
    requiresReview?: boolean;
    correctionReason?: string | null;
  }
) : Promise<Transaction | { message: string; approvalId?: string; approvalStatus?: string }> => {
  return fetchJson<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates)
  });
};

export const confirmTransaction = async (id: string): Promise<Transaction> => {
  return fetchJson<Transaction>(`/api/transactions/${encodeURIComponent(id)}/confirm`, {
    method: 'PATCH',
    headers: jsonHeaders
  });
};

export const correctTransaction = async (
  id: string,
  correction: {
    type?: 'revenue' | 'expense';
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
    amount?: number;
    date?: string;
    category?: string | null;
    notes?: string | null;
    correctionReason?: string;
  }
): Promise<{ originalTransactionId: string; correction: Transaction }> => {
  return fetchJson<{ originalTransactionId: string; correction: Transaction }>(
    `/api/transactions/${encodeURIComponent(id)}/corrections`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(correction)
    }
  );
};

export const postWhatsAppEntry = async (
  userId: string,
  message: string
): Promise<{
  botReply: string;
  conversation: {
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
    awaitingConfirmation: boolean;
  };
  transactions: Transaction[];
  summary: SummaryPayload;
  monthlySummary: SummaryPayload;
  budgetStatuses: BudgetStatus[];
}> => {
  return fetchJson<{
    botReply: string;
    conversation: {
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
      awaitingConfirmation: boolean;
    };
    transactions: Transaction[];
    summary: SummaryPayload;
    monthlySummary: SummaryPayload;
    budgetStatuses: BudgetStatus[];
  }>('/api/whatsapp/webhook', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ userId, message })
  });
};
