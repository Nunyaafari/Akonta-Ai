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
  return `23327${value}`;
};

interface BootstrapOwnerResponse {
  user: { id: string; phoneNumber: string };
  business: { id: string; businessName: string };
}

interface RequestOtpResponse {
  success: boolean;
  expiresAt: string;
  devOtpCode?: string;
}

interface VerifyOtpResponse {
  user: { id: string; phoneNumber: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface ErrorResponse {
  message: string;
}

interface CategoryResponse {
  id: string;
  name: string;
  kind: 'sales' | 'expense';
  isActive: boolean;
}

interface ProductServiceResponse {
  id: string;
  name: string;
  type: 'product' | 'service';
  categoryId?: string | null;
  defaultPrice?: number | null;
  estimatedCost?: number | null;
  isActive: boolean;
}

interface CustomerResponse {
  id: string;
  name: string;
  phoneNumber?: string | null;
  notes?: string | null;
  openingReceivable: number;
  isActive: boolean;
}

interface SupplierResponse {
  id: string;
  name: string;
  phoneNumber?: string | null;
  supplyType?: string | null;
  notes?: string | null;
  openingPayable: number;
  isActive: boolean;
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
    const otp = await request<RequestOtpResponse & { message?: string }>({
      method: 'POST',
      path: '/api/auth/request-otp',
      body: { phoneNumber }
    });
    if (otp.status === 200) return otp;
    if (otp.status !== 429 || attempt === attempts) return otp;

    // Respect throttle windows in shared CI runs where multiple suites request OTPs from same IP.
    const message = typeof otp.json.message === 'string' ? otp.json.message : '';
    const waitSecondsMatch = message.match(/wait\s+(\d+)s/i);
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
  const ownerBPhone = randomPhone(seed + 1);
  const cashierPhone = randomPhone(seed + 2);

  console.log(`Using API base URL: ${BASE_URL}`);
  console.log(`Owner A phone: ${ownerPhone}`);
  console.log(`Owner B phone: ${ownerBPhone}`);

  const ownerBootstrap = await bootstrapOwner({
    name: 'Settings Owner A',
    phoneNumber: ownerPhone,
    businessName: `Settings Biz A ${seed}`
  });
  await bootstrapOwner({
    name: 'Settings Owner B',
    phoneNumber: ownerBPhone,
    businessName: `Settings Biz B ${seed}`
  });

  const ownerA = await loginByOtp(ownerPhone);
  const ownerB = await loginByOtp(ownerBPhone);

  const premiumActivate = await request<{ id: string; subscriptionStatus: string }>({
    method: 'POST',
    path: `/api/users/${encodeURIComponent(ownerBootstrap.user.id)}/subscription`,
    body: {
      status: 'premium',
      source: 'paid',
      months: 1,
      note: 'Settings integration test workspace premium setup'
    }
  });
  assert.equal(premiumActivate.status, 200, 'Owner A premium activation should succeed');

  const inviteCashier = await request<{ role: string }>({
    method: 'POST',
    path: '/api/workspaces/members/invite',
    token: ownerA.tokens.accessToken,
    body: {
      fullName: 'Settings Cashier',
      phoneNumber: cashierPhone,
      role: 'cashier'
    }
  });
  assert.equal(inviteCashier.status, 201, 'Owner should invite cashier');

  const cashier = await loginByOtp(cashierPhone);

  const createCategory = await request<CategoryResponse>({
    method: 'POST',
    path: '/api/settings/categories',
    token: ownerA.tokens.accessToken,
    body: {
      kind: 'expense',
      name: 'Utilities setup test'
    }
  });
  assert.equal(createCategory.status, 201, 'Owner should create category');

  const updateCategory = await request<CategoryResponse>({
    method: 'PATCH',
    path: `/api/settings/categories/${encodeURIComponent(createCategory.json.id)}`,
    token: ownerA.tokens.accessToken,
    body: {
      name: 'Utilities updated setup test'
    }
  });
  assert.equal(updateCategory.status, 200, 'Owner should update category');
  assert.equal(updateCategory.json.name, 'Utilities updated setup test');

  const createProduct = await request<ProductServiceResponse>({
    method: 'POST',
    path: '/api/settings/products-services',
    token: ownerA.tokens.accessToken,
    body: {
      name: 'Water Bottle',
      type: 'product',
      defaultPrice: 8,
      estimatedCost: 5,
      categoryId: createCategory.json.id
    }
  });
  assert.equal(createProduct.status, 201, 'Owner should create product/service');

  const updateProduct = await request<ProductServiceResponse>({
    method: 'PATCH',
    path: `/api/settings/products-services/${encodeURIComponent(createProduct.json.id)}`,
    token: ownerA.tokens.accessToken,
    body: {
      defaultPrice: 9.5,
      estimatedCost: 5.2
    }
  });
  assert.equal(updateProduct.status, 200, 'Owner should update product/service');
  assert.equal(updateProduct.json.defaultPrice, 9.5);

  const createCustomer = await request<CustomerResponse>({
    method: 'POST',
    path: '/api/settings/customers',
    token: ownerA.tokens.accessToken,
    body: {
      name: 'Ama Customer',
      phoneNumber: '0240000001',
      openingReceivable: 20
    }
  });
  assert.equal(createCustomer.status, 201, 'Owner should create customer');

  const updateCustomer = await request<CustomerResponse>({
    method: 'PATCH',
    path: `/api/settings/customers/${encodeURIComponent(createCustomer.json.id)}`,
    token: ownerA.tokens.accessToken,
    body: {
      notes: 'Priority customer',
      openingReceivable: 25
    }
  });
  assert.equal(updateCustomer.status, 200, 'Owner should update customer');
  assert.equal(updateCustomer.json.openingReceivable, 25);

  const createSupplier = await request<SupplierResponse>({
    method: 'POST',
    path: '/api/settings/suppliers',
    token: ownerA.tokens.accessToken,
    body: {
      name: 'Fresh Supplies Ltd',
      phoneNumber: '0240000002',
      supplyType: 'beverages',
      openingPayable: 45
    }
  });
  assert.equal(createSupplier.status, 201, 'Owner should create supplier');

  const updateSupplier = await request<SupplierResponse>({
    method: 'PATCH',
    path: `/api/settings/suppliers/${encodeURIComponent(createSupplier.json.id)}`,
    token: ownerA.tokens.accessToken,
    body: {
      notes: 'Pays weekly',
      openingPayable: 55
    }
  });
  assert.equal(updateSupplier.status, 200, 'Owner should update supplier');
  assert.equal(updateSupplier.json.openingPayable, 55);

  const cashierDenied = await request<ErrorResponse>({
    method: 'PATCH',
    path: `/api/settings/customers/${encodeURIComponent(createCustomer.json.id)}`,
    token: cashier.tokens.accessToken,
    body: { notes: 'Cashier should not update settings' }
  });
  assert.equal(cashierDenied.status, 403, 'Cashier must not update master data');

  const crossWorkspaceDenied = await request<ErrorResponse>({
    method: 'PATCH',
    path: `/api/settings/suppliers/${encodeURIComponent(createSupplier.json.id)}`,
    token: ownerB.tokens.accessToken,
    body: { notes: 'Other workspace owner should not edit this supplier' }
  });
  assert.equal(crossWorkspaceDenied.status, 404, 'Cross-workspace update should not find record');

  const deactivateProduct = await request<ProductServiceResponse>({
    method: 'PATCH',
    path: `/api/settings/products-services/${encodeURIComponent(createProduct.json.id)}/deactivate`,
    token: ownerA.tokens.accessToken,
    body: {}
  });
  assert.equal(deactivateProduct.status, 200, 'Owner should deactivate product/service');
  assert.equal(deactivateProduct.json.isActive, false);

  const deactivateCustomer = await request<CustomerResponse>({
    method: 'PATCH',
    path: `/api/settings/customers/${encodeURIComponent(createCustomer.json.id)}/deactivate`,
    token: ownerA.tokens.accessToken,
    body: {}
  });
  assert.equal(deactivateCustomer.status, 200, 'Owner should deactivate customer');
  assert.equal(deactivateCustomer.json.isActive, false);

  const deactivateSupplier = await request<SupplierResponse>({
    method: 'PATCH',
    path: `/api/settings/suppliers/${encodeURIComponent(createSupplier.json.id)}/deactivate`,
    token: ownerA.tokens.accessToken,
    body: {}
  });
  assert.equal(deactivateSupplier.status, 200, 'Owner should deactivate supplier');
  assert.equal(deactivateSupplier.json.isActive, false);

  const deactivateCategory = await request<CategoryResponse>({
    method: 'PATCH',
    path: `/api/settings/categories/${encodeURIComponent(createCategory.json.id)}/deactivate`,
    token: ownerA.tokens.accessToken,
    body: {}
  });
  assert.equal(deactivateCategory.status, 200, 'Owner should deactivate category');
  assert.equal(deactivateCategory.json.isActive, false);

  console.log('\nSettings integration checks passed:');
  console.log('- Owner can create/update/deactivate categories, products, customers, suppliers');
  console.log('- Cashier is blocked from master data updates');
  console.log('- Cross-workspace settings updates are denied');
};

main().catch((error) => {
  console.error('Settings integration test failed');
  console.error(error);
  process.exitCode = 1;
});
