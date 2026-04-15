import type { Transaction, User, SummaryPayload, WhatsAppProvider, Budget, BudgetStatus, BudgetTargetType } from '../types';
import {
  mockCreateUser,
  mockGetTransactions,
  mockGetWeeklySummary,
  mockGetMonthlySummary,
  mockPostChatEntry,
  mockGetCurrentBudgets,
  mockPostBudget,
  mockGetWhatsAppProviderInfo,
  mockSendWhatsAppMessage
} from './mockApi';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const jsonHeaders = {
  'Content-Type': 'application/json'
};

let demoModeEnabled = false;
let demoModeCallback: (() => void) | null = null;

export const registerDemoModeListener = (callback: () => void) => {
  demoModeCallback = callback;
};

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  try {
    const response = await fetch(`${BASE_URL}${path}`, init);
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
    return mockGetTransactions(params.get('userId') ?? '');
  }

  if (path.startsWith('/api/summaries/weekly') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetWeeklySummary(params.get('userId') ?? '', params.get('start') ?? '', params.get('end') ?? '');
  }

  if (path.startsWith('/api/summaries/monthly') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1]);
    return mockGetMonthlySummary(params.get('userId') ?? '', Number(params.get('year')), Number(params.get('month')));
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

export const postChatEntry = async (userId: string, message: string): Promise<{ transactions: Transaction[]; summary: SummaryPayload; monthlySummary: SummaryPayload; budgetStatuses: BudgetStatus[] }> => {
  return fetchJson<{ transactions: Transaction[]; summary: SummaryPayload; monthlySummary: SummaryPayload; budgetStatuses: BudgetStatus[] }>('/api/chat', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ userId, message })
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
  amount: number;
  date?: string;
  category?: string;
  notes?: string;
}): Promise<Transaction> => {
  return fetchJson<Transaction>('/api/transactions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(transaction)
  });
};

export const postWhatsAppEntry = async (userId: string, message: string): Promise<Transaction[]> => {
  return fetchJson<Transaction[]>('/api/whatsapp/webhook', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ userId, message })
  });
};
