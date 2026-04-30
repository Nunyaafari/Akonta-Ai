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

const requestOtpWithRetry = async (phoneNumber: string, attempts = 3) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const otp = await request<RequestOtpResponse & { message?: string }>({
      method: 'POST',
      path: '/api/auth/request-otp',
      body: { phoneNumber }
    });
    if (otp.status === 200) return otp;
    if (otp.status !== 429 || attempt === attempts) return otp;
    const message = typeof otp.json.message === 'string' ? otp.json.message : '';
    const waitSecondsMatch = message.match(/wait\s+(\d+)s/i);
    const waitSeconds = waitSecondsMatch ? Number(waitSecondsMatch[1]) : 5;
    await sleep((Number.isFinite(waitSeconds) ? waitSeconds : 5) * 1000);
  }

  throw new Error(`request-otp failed for ${phoneNumber}`);
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

  const ownerOtp = await requestOtpWithRetry(ownerPhone);
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

  const memberOtp = await requestOtpWithRetry(memberPhone);

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

  const resetDraft = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: '99',
      channel: 'web'
    }
  });
  assert.equal(resetDraft.status, 200, 'cancel draft should return 200');
  assert.equal(resetDraft.json.conversation.step, 'idle', 'cancel should reset session to idle');

  const chat4 = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: 'paid 1000',
      channel: 'web'
    }
  });
  assert.equal(chat4.status, 200, 'ambiguous paid message should return 200');
  assert.match(
    chat4.json.botReply,
    /What was the payment for\?/i,
    'ambiguous paid message should trigger follow-up question'
  );

  const chat5 = await request<ChatResponse>({
    method: 'POST',
    path: '/api/chat',
    token: ownerToken,
    body: {
      message: '3 braids at 50 cash',
      channel: 'web'
    }
  });
  assert.equal(chat5.status, 200, 'calculated message should return 200');
  assert.equal(chat5.json.conversation.step, 'await_confirm', 'calculated message should require confirmation step');
  assert.match(
    chat5.json.botReply,
    /I calculated/i,
    'calculated message should explain inferred total before save'
  );

  console.log('\nIntegration checks passed:');
  console.log('- Owner bootstrap + OTP login');
  console.log('- Workspace invite + member OTP activation');
  console.log('- Expense-first chat regression fixed');
  console.log('- Profit summary workflow (last week/month)');
  console.log('- Ambiguous intent follow-up prompts');
  console.log('- Calculated entries require explicit confirmation');
};

main().catch((error) => {
  console.error('Integration test failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
