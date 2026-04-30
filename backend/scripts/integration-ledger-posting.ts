import assert from 'node:assert/strict';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

const asJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON but got: ${text}`);
  }
};

const request = async <T>(params: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  token?: string;
  body?: unknown;
}): Promise<{ status: number; json: T }> => {
  const response = await fetch(`${BASE_URL}${params.path}`, {
    method: params.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(params.token ? { Authorization: `Bearer ${params.token}` } : {})
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body)
  });

  const json = await asJson<T>(response);
  return { status: response.status, json };
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const randomPhone = (seed: number): string => {
  const value = (seed % 10_000_000).toString().padStart(7, '0');
  return `23324${value}`;
};

interface BootstrapOwnerResponse {
  user: { id: string; phoneNumber: string };
  business: { id: string; businessName: string };
}

interface RequestOtpResponse {
  success: boolean;
  expiresAt: string;
  devOtpCode?: string;
  message?: string;
}

interface VerifyOtpResponse {
  user: { id: string; phoneNumber: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface LedgerAccountResponse {
  id: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
}

interface JournalLineResponse {
  id: string;
  debitAmount: number;
  creditAmount: number;
  account: {
    code: string;
    name: string;
  };
}

interface JournalEntryResponse {
  id: string;
  transactionId?: string | null;
  status: 'draft' | 'posted' | 'needs_review' | 'void';
  description?: string | null;
  lines: JournalLineResponse[];
}

interface BalanceSheetResponse {
  asOf: string;
  assets: { total: number };
  liabilities: { total: number };
  equity: { total: number };
  currentEarnings: { balance: number };
  totals: {
    assets: number;
    liabilities: number;
    equityBeforeEarnings: number;
    equityAfterEarnings: number;
    liabilitiesAndEquity: number;
  };
}

interface TransactionResponse {
  id: string;
  status: 'draft' | 'confirmed';
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
  ledgerPostingStatus: 'not_configured' | 'pending' | 'posted' | 'failed' | 'skipped';
}

const bootstrapOwner = async (params: { name: string; phoneNumber: string; businessName: string }) => {
  const response = await request<BootstrapOwnerResponse>({
    method: 'POST',
    path: '/api/auth/bootstrap-owner',
    body: params
  });
  assert.equal(response.status, 201, `bootstrap-owner should succeed for ${params.phoneNumber}`);
  return response.json;
};

const requestOtpWithRetry = async (phoneNumber: string, attempts = 3) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const otp = await request<RequestOtpResponse>({
      method: 'POST',
      path: '/api/auth/request-otp',
      body: { phoneNumber }
    });
    if (otp.status === 200) return otp;
    if (otp.status !== 429 || attempt === attempts) return otp;

    const waitSecondsMatch = (otp.json.message ?? '').match(/wait\s+(\d+)s/i);
    const waitSeconds = waitSecondsMatch ? Number(waitSecondsMatch[1]) : 5;
    await sleep((Number.isFinite(waitSeconds) ? waitSeconds : 5) * 1000);
  }

  throw new Error(`request-otp failed for ${phoneNumber}`);
};

const loginByOtp = async (phoneNumber: string) => {
  const otp = await requestOtpWithRetry(phoneNumber);
  assert.equal(otp.status, 200, `request-otp failed for ${phoneNumber}`);
  assert.ok(
    otp.json.devOtpCode,
    'devOtpCode missing. Set AUTH_EXPOSE_DEV_OTP=true in non-production test environment.'
  );

  const verify = await request<VerifyOtpResponse>({
    method: 'POST',
    path: '/api/auth/verify-otp',
    body: {
      phoneNumber,
      code: otp.json.devOtpCode
    }
  });
  assert.equal(verify.status, 200, `verify-otp failed for ${phoneNumber}`);
  return verify.json;
};

const main = async () => {
  const seed = Date.now();
  const ownerPhone = randomPhone(seed);

  console.log(`Using API base URL: ${BASE_URL}`);
  console.log(`Ledger owner phone: ${ownerPhone}`);

  await bootstrapOwner({
    name: 'Ledger Owner',
    phoneNumber: ownerPhone,
    businessName: `Ledger Biz ${seed}`
  });

  const owner = await loginByOtp(ownerPhone);

  const bootstrapDefaults = await request<{ success: boolean }>({
    method: 'POST',
    path: '/api/settings/bootstrap-defaults',
    token: owner.tokens.accessToken
  });
  assert.equal(bootstrapDefaults.status, 200, 'Owner should seed defaults');

  const accounts = await request<LedgerAccountResponse[]>({
    path: '/api/settings/ledger-accounts',
    token: owner.tokens.accessToken
  });
  assert.equal(accounts.status, 200, 'Should list ledger accounts');
  assert.ok(accounts.json.length >= 10, 'Expected seeded default ledger accounts');

  const createCashSale = await request<TransactionResponse>({
    method: 'POST',
    path: '/api/transactions',
    token: owner.tokens.accessToken,
    body: {
      type: 'revenue',
      eventType: 'cash_sale',
      amount: 150,
      notes: 'Ledger posting cash sale'
    }
  });
  assert.equal(createCashSale.status, 201, 'Confirmed cash sale should be created');

  const journalAfterCashSale = await request<JournalEntryResponse[]>({
    path: '/api/settings/journal-entries',
    token: owner.tokens.accessToken
  });
  assert.equal(journalAfterCashSale.status, 200, 'Should list journal entries');
  const cashSaleEntry = journalAfterCashSale.json.find((entry) => entry.transactionId === createCashSale.json.id);
  assert.ok(cashSaleEntry, 'Cash sale should generate a journal entry');
  assert.equal(cashSaleEntry?.status, 'posted');
  assert.equal(cashSaleEntry?.lines.length, 2, 'Cash sale journal should have two lines');
  assert.ok(
    cashSaleEntry?.lines.some((line) => line.account.code === '1000' && line.debitAmount === 150),
    'Cash sale should debit Cash'
  );
  assert.ok(
    cashSaleEntry?.lines.some((line) => line.account.code === '4000' && line.creditAmount === 150),
    'Cash sale should credit Sales Revenue'
  );

  const balanceSheetAfterCashSale = await request<BalanceSheetResponse>({
    path: '/api/settings/balance-sheet',
    token: owner.tokens.accessToken
  });
  assert.equal(balanceSheetAfterCashSale.status, 200, 'Should return balance sheet snapshot');
  assert.equal(balanceSheetAfterCashSale.json.totals.assets, 150, 'Assets should include posted cash sale');
  assert.equal(balanceSheetAfterCashSale.json.currentEarnings.balance, 150, 'Current earnings should capture posted profit');
  assert.equal(
    balanceSheetAfterCashSale.json.totals.liabilitiesAndEquity,
    150,
    'Balance sheet should balance after posted cash sale'
  );

  const createDraftExpense = await request<TransactionResponse>({
    method: 'POST',
    path: '/api/transactions',
    token: owner.tokens.accessToken,
    body: {
      type: 'expense',
      eventType: 'operating_expense',
      amount: 45,
      status: 'draft',
      notes: 'Draft expense'
    }
  });
  assert.equal(createDraftExpense.status, 201, 'Draft expense should be created');

  const journalAfterDraft = await request<JournalEntryResponse[]>({
    path: '/api/settings/journal-entries',
    token: owner.tokens.accessToken
  });
  assert.equal(
    journalAfterDraft.json.some((entry) => entry.transactionId === createDraftExpense.json.id),
    false,
    'Draft transaction should not post journal entries'
  );

  const confirmDraftExpense = await request<TransactionResponse>({
    method: 'PATCH',
    path: `/api/transactions/${encodeURIComponent(createDraftExpense.json.id)}/confirm`,
    token: owner.tokens.accessToken
  });
  assert.equal(confirmDraftExpense.status, 200, 'Draft expense should confirm');

  const journalAfterConfirm = await request<JournalEntryResponse[]>({
    path: '/api/settings/journal-entries',
    token: owner.tokens.accessToken
  });
  const expenseEntry = journalAfterConfirm.json.find((entry) => entry.transactionId === createDraftExpense.json.id);
  assert.ok(expenseEntry, 'Confirmed expense should generate journal entry');
  assert.ok(
    expenseEntry?.lines.some((line) => line.account.code === '6000' && line.debitAmount === 45),
    'Expense should debit Operating Expenses'
  );
  assert.ok(
    expenseEntry?.lines.some((line) => line.account.code === '1000' && line.creditAmount === 45),
    'Expense should credit Cash'
  );

  const deleteExpense = await request<{ success: boolean; id: string }>({
    method: 'DELETE',
    path: `/api/transactions/${encodeURIComponent(createDraftExpense.json.id)}`,
    token: owner.tokens.accessToken,
    body: {}
  });
  assert.equal(deleteExpense.status, 200, 'Confirmed expense should delete');

  const journalAfterDelete = await request<JournalEntryResponse[]>({
    path: '/api/settings/journal-entries',
    token: owner.tokens.accessToken
  });
  assert.equal(
    journalAfterDelete.json.some((entry) => entry.transactionId === createDraftExpense.json.id),
    false,
    'Deleted transaction should remove journal entry'
  );

  const transactions = await request<TransactionResponse[]>({
    path: '/api/transactions',
    token: owner.tokens.accessToken
  });
  const cashSaleTx = transactions.json.find((entry) => entry.id === createCashSale.json.id);
  assert.equal(cashSaleTx?.ledgerPostingStatus, 'posted', 'Cash sale transaction should show posted ledger status');

  console.log('\nLedger posting integration checks passed:');
  console.log('- seeded chart of accounts available');
  console.log('- confirmed cash sale posted double-entry journal');
  console.log('- balance sheet reflects posted journal balances');
  console.log('- draft expense skipped until confirm');
  console.log('- confirmed expense posted journal');
  console.log('- deleted expense cleared journal entry');
};

main().catch((error) => {
  console.error('Ledger posting integration test failed');
  console.error(error);
  process.exit(1);
});
