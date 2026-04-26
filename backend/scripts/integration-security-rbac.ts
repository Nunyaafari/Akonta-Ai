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
}): Promise<{ status: number; json: T; headers: Headers }> => {
  const response = await fetch(`${BASE_URL}${params.path}`, {
    method: params.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(params.token ? { Authorization: `Bearer ${params.token}` } : {})
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body)
  });

  const json = await asJson<T>(response);
  return { status: response.status, json, headers: response.headers };
};

const randomPhone = (seed: number): string => {
  const value = (seed % 10_000_000).toString().padStart(7, '0');
  return `23326${value}`;
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
  session: { id: string; businessId: string; role: string };
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresIn: number;
    refreshExpiresIn: number;
  };
}

interface TransactionRow {
  id: string;
  businessId: string;
  createdByUserId: string;
  type: string;
  amount: number;
}

const bootstrapOwner = async (params: { name: string; phoneNumber: string; businessName: string }) => {
  const result = await request<BootstrapOwnerResponse>({
    method: 'POST',
    path: '/api/auth/bootstrap-owner',
    body: params
  });
  assert.equal(result.status, 201, `bootstrap-owner failed for ${params.phoneNumber}`);
  return result.json;
};

const loginByOtp = async (phoneNumber: string) => {
  const otp = await request<RequestOtpResponse>({
    method: 'POST',
    path: '/api/auth/request-otp',
    body: { phoneNumber }
  });
  assert.equal(otp.status, 200, `request-otp failed for ${phoneNumber}`);
  assert.ok(
    otp.json.devOtpCode,
    'devOtpCode is missing. Run tests with AUTH_EXPOSE_DEV_OTP=true in non-production mode.'
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
  const ownerAPhone = randomPhone(seed);
  const ownerBPhone = randomPhone(seed + 1);
  const cashierPhone = randomPhone(seed + 2);
  const viewerPhone = randomPhone(seed + 3);
  const throttlePhone = randomPhone(seed + 4);

  console.log(`Using API base URL: ${BASE_URL}`);

  await bootstrapOwner({
    name: 'Owner A',
    phoneNumber: ownerAPhone,
    businessName: `Biz A ${seed}`
  });

  await bootstrapOwner({
    name: 'Owner B',
    phoneNumber: ownerBPhone,
    businessName: `Biz B ${seed}`
  });

  await bootstrapOwner({
    name: 'Throttle Owner',
    phoneNumber: throttlePhone,
    businessName: `Throttle Biz ${seed}`
  });

  const ownerA = await loginByOtp(ownerAPhone);
  const ownerB = await loginByOtp(ownerBPhone);

  const unauth = await request<{ message: string }>({
    method: 'GET',
    path: '/api/workspaces'
  });
  assert.equal(unauth.status, 401, 'missing token must return 401');

  const inviteCashier = await request<{ role: string; status: string }>({
    method: 'POST',
    path: '/api/workspaces/members/invite',
    token: ownerA.tokens.accessToken,
    body: {
      fullName: 'Cashier A',
      phoneNumber: cashierPhone,
      role: 'cashier'
    }
  });
  assert.equal(inviteCashier.status, 201, 'owner should invite cashier');
  assert.equal(inviteCashier.json.role, 'cashier');

  const inviteViewer = await request<{ role: string; status: string }>({
    method: 'POST',
    path: '/api/workspaces/members/invite',
    token: ownerA.tokens.accessToken,
    body: {
      fullName: 'Viewer A',
      phoneNumber: viewerPhone,
      role: 'viewer'
    }
  });
  assert.equal(inviteViewer.status, 201, 'owner should invite viewer');
  assert.equal(inviteViewer.json.role, 'viewer');

  const cashier = await loginByOtp(cashierPhone);
  const viewer = await loginByOtp(viewerPhone);

  const ownerATx = await request<TransactionRow>({
    method: 'POST',
    path: '/api/transactions',
    token: ownerA.tokens.accessToken,
    body: {
      type: 'revenue',
      amount: 1000,
      category: 'Sales',
      notes: 'Owner A sale'
    }
  });
  assert.equal(ownerATx.status, 201, 'owner should create transaction');

  const ownerBTx = await request<TransactionRow>({
    method: 'POST',
    path: '/api/transactions',
    token: ownerB.tokens.accessToken,
    body: {
      type: 'revenue',
      amount: 555,
      category: 'Sales',
      notes: 'Owner B sale'
    }
  });
  assert.equal(ownerBTx.status, 201, 'owner B should create transaction');

  const cashierTx = await request<TransactionRow>({
    method: 'POST',
    path: '/api/transactions',
    token: cashier.tokens.accessToken,
    body: {
      type: 'expense',
      amount: 70,
      category: 'Supplies',
      notes: 'Cashier expense'
    }
  });
  assert.equal(cashierTx.status, 201, 'cashier should create transaction');

  const cashierInviteDenied = await request<{ message: string }>({
    method: 'POST',
    path: '/api/workspaces/members/invite',
    token: cashier.tokens.accessToken,
    body: {
      fullName: 'Blocked Invite',
      phoneNumber: randomPhone(seed + 5),
      role: 'cashier'
    }
  });
  assert.equal(cashierInviteDenied.status, 403, 'cashier must not invite members');

  const viewerCreateDenied = await request<{ message: string }>({
    method: 'POST',
    path: '/api/transactions',
    token: viewer.tokens.accessToken,
    body: {
      type: 'expense',
      amount: 22,
      category: 'Viewer test'
    }
  });
  assert.equal(viewerCreateDenied.status, 403, 'viewer must not create transactions');

  const cashierList = await request<TransactionRow[]>({
    method: 'GET',
    path: '/api/transactions',
    token: cashier.tokens.accessToken
  });
  assert.equal(cashierList.status, 200, 'cashier list should succeed');
  assert.ok(
    cashierList.json.some((entry) => entry.id === cashierTx.json.id),
    'cashier should see their own transactions'
  );
  assert.ok(
    !cashierList.json.some((entry) => entry.id === ownerATx.json.id),
    'cashier must not see owner transactions from same business'
  );
  assert.ok(
    !cashierList.json.some((entry) => entry.id === ownerBTx.json.id),
    'cashier must not see transactions from another business'
  );

  const ownerAList = await request<TransactionRow[]>({
    method: 'GET',
    path: '/api/transactions',
    token: ownerA.tokens.accessToken
  });
  assert.equal(ownerAList.status, 200, 'owner A list should succeed');
  assert.ok(ownerAList.json.some((entry) => entry.id === ownerATx.json.id));
  assert.ok(ownerAList.json.some((entry) => entry.id === cashierTx.json.id));
  assert.ok(!ownerAList.json.some((entry) => entry.id === ownerBTx.json.id));

  const ownerBList = await request<TransactionRow[]>({
    method: 'GET',
    path: '/api/transactions',
    token: ownerB.tokens.accessToken
  });
  assert.equal(ownerBList.status, 200, 'owner B list should succeed');
  assert.ok(ownerBList.json.some((entry) => entry.id === ownerBTx.json.id));
  assert.ok(!ownerBList.json.some((entry) => entry.id === ownerATx.json.id));
  assert.ok(!ownerBList.json.some((entry) => entry.id === cashierTx.json.id));

  const refreshed = await request<{
    tokens: {
      accessToken: string;
      refreshToken: string;
      accessExpiresIn: number;
      refreshExpiresIn: number;
    };
  }>({
    method: 'POST',
    path: '/api/auth/refresh',
    body: { refreshToken: ownerA.tokens.refreshToken }
  });
  assert.equal(refreshed.status, 200, 'refresh token should rotate session');
  assert.ok(refreshed.json.tokens.refreshToken, 'refresh response should include a new refresh token');

  const logout = await request<{ success: boolean }>({
    method: 'POST',
    path: '/api/auth/logout',
    body: { refreshToken: refreshed.json.tokens.refreshToken }
  });
  assert.equal(logout.status, 200, 'logout should succeed');
  assert.equal(logout.json.success, true, 'logout should return success');

  const refreshAfterLogout = await request<{ message: string }>({
    method: 'POST',
    path: '/api/auth/refresh',
    body: { refreshToken: refreshed.json.tokens.refreshToken }
  });
  assert.equal(refreshAfterLogout.status, 401, 'revoked refresh token must fail');

  const otpFirst = await request<RequestOtpResponse>({
    method: 'POST',
    path: '/api/auth/request-otp',
    body: { phoneNumber: throttlePhone }
  });
  assert.equal(otpFirst.status, 200, 'initial otp request should pass');

  const otpSecond = await request<RequestOtpResponse>({
    method: 'POST',
    path: '/api/auth/request-otp',
    body: { phoneNumber: throttlePhone }
  });
  assert.equal(otpSecond.status, 429, 'immediate otp replay should be throttled');
  assert.ok(
    Boolean(otpSecond.headers.get('retry-after')),
    'throttled OTP response should include Retry-After header'
  );

  console.log('\nSecurity integration checks passed:');
  console.log('- Unauthenticated access blocked');
  console.log('- Role-based restrictions enforced (cashier/viewer)');
  console.log('- Cross-business isolation verified');
  console.log('- Refresh + logout session lifecycle verified');
  console.log('- OTP replay throttling verified');
};

main().catch((error) => {
  console.error('Security integration test failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
