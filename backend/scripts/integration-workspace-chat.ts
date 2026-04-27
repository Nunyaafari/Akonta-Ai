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
}

interface VerifyOtpResponse {
  user: { id: string; phoneNumber: string };
  session: { id: string; businessId: string; role: string };
  memberships: Array<{ businessId: string; role: string; status: string }>;
  tokens: { accessToken: string; refreshToken: string };
}

interface InviteMemberResponse {
  membershipId: string;
  userId: string;
  role: string;
  status: string;
}

interface WorkspaceEntry {
  membershipId: string;
  businessId: string;
  businessName: string;
  role: string;
  status: string;
}

interface ChatResponse {
  botReply: string;
  conversation: {
    step: string;
    awaitingConfirmation: boolean;
  };
}

const main = async () => {
  const nowSeed = Date.now();
  const ownerPhone = randomPhone(nowSeed);
  const memberPhone = randomPhone(nowSeed + 1);

  console.log(`Using base URL: ${BASE_URL}`);
  console.log(`Owner phone: ${ownerPhone}`);
  console.log(`Member phone: ${memberPhone}`);

  const bootstrap = await request<BootstrapOwnerResponse>({
    method: 'POST',
    path: '/api/auth/bootstrap-owner',
    body: {
      name: 'Integration Owner',
      phoneNumber: ownerPhone,
      businessName: `Integration Shop ${nowSeed}`
    }
  });

  assert.equal(bootstrap.status, 201, 'bootstrap-owner should return 201');

  const ownerOtp = await request<RequestOtpResponse>({
    method: 'POST',
    path: '/api/auth/request-otp',
    body: { phoneNumber: ownerPhone }
  });
  assert.equal(ownerOtp.status, 200, 'owner request-otp should return 200');
  assert.ok(ownerOtp.json.devOtpCode, 'devOtpCode must be present in non-production mode');

  const ownerVerify = await request<VerifyOtpResponse>({
    method: 'POST',
    path: '/api/auth/verify-otp',
    body: {
      phoneNumber: ownerPhone,
      code: ownerOtp.json.devOtpCode
    }
  });

  assert.equal(ownerVerify.status, 200, 'owner verify-otp should return 200');
  const ownerToken = ownerVerify.json.tokens.accessToken;
  assert.ok(ownerToken, 'owner access token should exist');

  const premiumActivate = await request<{ id: string; subscriptionStatus: string }>({
    method: 'POST',
    path: `/api/users/${encodeURIComponent(ownerVerify.json.user.id)}/subscription`,
    body: {
      status: 'premium',
      source: 'paid',
      months: 1,
      note: 'Integration setup premium workspace'
    }
  });
  assert.equal(premiumActivate.status, 200, 'owner premium activation should return 200');

  const invite = await request<InviteMemberResponse>({
    method: 'POST',
    path: '/api/workspaces/members/invite',
    token: ownerToken,
    body: {
      fullName: 'Integration Cashier',
      phoneNumber: memberPhone,
      role: 'cashier'
    }
  });

  assert.equal(invite.status, 201, 'invite member should return 201');
  assert.equal(invite.json.role, 'cashier', 'invited role should be cashier');

  const memberOtp = await request<RequestOtpResponse>({
    method: 'POST',
    path: '/api/auth/request-otp',
    body: { phoneNumber: memberPhone }
  });

  assert.equal(memberOtp.status, 200, 'member request-otp should return 200');
  assert.ok(memberOtp.json.devOtpCode, 'member devOtpCode should exist');

  const memberVerify = await request<VerifyOtpResponse>({
    method: 'POST',
    path: '/api/auth/verify-otp',
    body: {
      phoneNumber: memberPhone,
      code: memberOtp.json.devOtpCode
    }
  });

  assert.equal(memberVerify.status, 200, 'member verify-otp should return 200');
  const memberToken = memberVerify.json.tokens.accessToken;
  assert.ok(memberToken, 'member access token should exist');

  const memberWorkspaces = await request<WorkspaceEntry[]>({
    method: 'GET',
    path: '/api/workspaces',
    token: memberToken
  });

  assert.equal(memberWorkspaces.status, 200, 'member workspaces should return 200');
  assert.ok(memberWorkspaces.json.length > 0, 'member should have at least one workspace');
  assert.ok(
    memberWorkspaces.json.some((entry) => entry.role === 'cashier' && entry.status === 'active'),
    'member should have an active cashier membership'
  );

  const chat1 = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: 'spent 200 on water',
      channel: 'web'
    }
  });

  assert.equal(chat1.status, 200, 'first chat call should return 200');
  assert.match(
    chat1.json.botReply,
    /How much money inflow came in today\?/i,
    'after expense-first message, bot should ask for inflow'
  );

  const chat2 = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: '490 cash',
      channel: 'web'
    }
  });

  assert.equal(chat2.status, 200, 'second chat call should return 200');
  assert.ok(
    !/How much did the business spend today\?/i.test(chat2.json.botReply),
    'bot must not ask for expense amount again when expense draft already exists'
  );
  assert.ok(
    /What type of expense was it\?|Draft summary:/i.test(chat2.json.botReply),
    'bot should continue to type/category/confirm stage'
  );

  const chat3 = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: 'how much profit did we make last week/month',
      channel: 'web'
    }
  });

  assert.equal(chat3.status, 200, 'profit-summary chat call should return 200');
  assert.match(chat3.json.botReply, /Last week/i, 'profit summary should include last week block');
  assert.match(chat3.json.botReply, /Last month/i, 'profit summary should include last month block');
  assert.match(chat3.json.botReply, /Inflow:/i, 'profit summary should include inflow');
  assert.match(chat3.json.botReply, /Outflow:/i, 'profit summary should include outflow');
  assert.match(chat3.json.botReply, /Profit:.*Inflow - Outflow/i, 'profit summary should show formula');
  assert.equal(
    chat3.json.conversation.step,
    chat2.json.conversation.step,
    'profit summary question should not reset current draft step'
  );

  console.log('\nIntegration checks passed:');
  console.log('- Owner bootstrap + OTP login');
  console.log('- Workspace invite + member OTP activation');
  console.log('- Expense-first chat regression fixed');
  console.log('- Profit summary workflow (last week/month)');
};

main().catch((error) => {
  console.error('Integration test failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
