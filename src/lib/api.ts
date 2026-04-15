import type { Transaction, User, SummaryPayload, WhatsAppProvider, Budget, BudgetStatus, BudgetTargetType, MonthlyInsights } from '../types';
import {
  mockCreateUser,
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

const jsonHeaders: Record<string, string> = {
  'Content-Type': 'application/json'
};

if (BACKEND_API_KEY) {
  jsonHeaders['x-akonta-api-key'] = BACKEND_API_KEY;
}

const authHeaders: Record<string, string> = BACKEND_API_KEY
  ? { 'x-akonta-api-key': BACKEND_API_KEY }
  : {};

let demoModeEnabled = false;
let demoModeCallback: (() => void) | null = null;

export const registerDemoModeListener = (callback: () => void) => {
  demoModeCallback = callback;
};

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  try {
    const mergedHeaders = new Headers(init?.headers ?? {});
    for (const [key, value] of Object.entries(authHeaders)) {
      if (!mergedHeaders.has(key)) {
        mergedHeaders.set(key, value);
      }
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: mergedHeaders
    });
    if (!response.ok) {
      const text = await response.text();
      const isHtml = response.headers.get('content-type')?.includes('text/html');
      if (BASE_URL === '' || response.status === 404 || isHtml) {
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
    if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Failed to connect')) {
      if (!demoModeEnabled) {
        demoModeEnabled = true;
        demoModeCallback?.();
      }
      return await fallbackApi(path, init) as T;
    }
    throw error;
  }
};

const fallbackApi = async (path: string, init?: RequestInit) => {
  const method = init?.method?.toUpperCase() || 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  if (path === '/api/users' && method === 'POST') {
    return mockCreateUser(body);
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
    return users.find((user) => user.id === userId) as User;
  }

  if (path === '/api/users' && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    const id = params.get('id');
    return users.find((user) => user.id === id) as User;
  }

  throw new Error('No mock implementation for ' + method + ' ' + path);
};

export const createUser = async (user: Partial<User>): Promise<User> => {
  return fetchJson<User>('/api/users', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(user)
  });
};

export const getUser = async (id: string): Promise<User> => {
  return fetchJson<User>(`/api/users/${id}`);
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
  channel: 'web' | 'whatsapp' = 'web'
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
    correctionReason?: string | null;
  }
): Promise<Transaction> => {
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
