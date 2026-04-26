import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type VerifyOtpResponse = {
  user: { id: string; phoneNumber: string };
  session: { id: string; businessId: string; role: string };
  tokens: AuthTokens;
};

type BootstrapOwnerResponse = {
  user: { id: string; phoneNumber: string };
  business: { id: string; businessName: string };
};

type InviteResponse = {
  membershipId: string;
  role: string;
  status: string;
};

type BrowserAuthSession = {
  accessToken: string;
  refreshToken: string;
  role: string;
  businessId: string;
};

const asJson = async <T>(response: APIResponse): Promise<T> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON but got: ${text}`);
  }
};

const randomPhone = (seed: number, offset: number): string => {
  const value = ((seed + offset) % 10_000_000).toString().padStart(7, '0');
  return `23325${value}`;
};

const bootstrapOwner = async (request: APIRequestContext, payload: {
  name: string;
  phoneNumber: string;
  businessName: string;
}): Promise<BootstrapOwnerResponse> => {
  const response = await request.post(`${API_BASE_URL}/api/auth/bootstrap-owner`, { data: payload });
  const json = await asJson<BootstrapOwnerResponse | { message: string }>(response);
  expect(response.status(), JSON.stringify(json)).toBe(201);
  return json as BootstrapOwnerResponse;
};

const requestDevOtp = async (request: APIRequestContext, phoneNumber: string): Promise<string> => {
  const response = await request.post(`${API_BASE_URL}/api/auth/request-otp`, {
    data: { phoneNumber }
  });
  const json = await asJson<{ devOtpCode?: string; message?: string }>(response);
  expect(response.status(), JSON.stringify(json)).toBe(200);
  expect(json.devOtpCode, 'devOtpCode is required for E2E smoke').toBeTruthy();
  return json.devOtpCode as string;
};

const verifyOtpViaApi = async (
  request: APIRequestContext,
  payload: { phoneNumber: string; code: string; businessId?: string }
): Promise<VerifyOtpResponse> => {
  const response = await request.post(`${API_BASE_URL}/api/auth/verify-otp`, { data: payload });
  const json = await asJson<VerifyOtpResponse | { message: string }>(response);
  expect(response.status(), JSON.stringify(json)).toBe(200);
  return json as VerifyOtpResponse;
};

const inviteMember = async (
  request: APIRequestContext,
  token: string,
  payload: { fullName: string; phoneNumber: string; role: 'cashier' | 'viewer' | 'manager' | 'bookkeeper' | 'accountant' }
): Promise<InviteResponse> => {
  const response = await request.post(`${API_BASE_URL}/api/workspaces/members/invite`, {
    data: payload,
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await asJson<InviteResponse | { message: string }>(response);
  expect(response.status(), JSON.stringify(json)).toBe(201);
  return json as InviteResponse;
};

const updateMembership = async (
  request: APIRequestContext,
  token: string,
  membershipId: string,
  payload: { role?: 'cashier' | 'viewer' | 'manager' | 'bookkeeper' | 'accountant'; status?: 'active' | 'inactive' | 'invited' | 'revoked' }
) => {
  const response = await request.patch(`${API_BASE_URL}/api/workspaces/members/${membershipId}`, {
    data: payload,
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await asJson<{ membershipId: string } | { message: string }>(response);
  expect(response.status(), JSON.stringify(json)).toBe(200);
};

const loginViaOtpUi = async (page: Page, phoneNumber: string) => {
  await page.goto('/');
  const signInButton = page.getByRole('button', { name: 'Sign In' }).first();
  if (await signInButton.isVisible()) {
    await signInButton.click();
  }

  await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible();
  await page.getByPlaceholder('233240000001').fill(phoneNumber);
  await page.getByRole('button', { name: 'Request OTP' }).click();

  const devCodeNotice = page.locator('p').filter({ hasText: 'Dev OTP code:' }).first();
  await expect(devCodeNotice).toBeVisible();
  const noticeText = await devCodeNotice.textContent();
  const otpCode = noticeText?.match(/(\d{6})/)?.[1];
  if (!otpCode) {
    throw new Error(`Could not extract OTP code from auth notice: ${noticeText ?? 'empty notice'}`);
  }

  await page.getByPlaceholder('6-digit code').fill(otpCode);
  await page.getByRole('button', { name: 'Verify & Sign In' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
};

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
};

const logoutToLanding = async (page: Page) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('button', { name: 'Sign In with OTP' })).toBeVisible();
};

const readBrowserSession = async (page: Page): Promise<BrowserAuthSession> => {
  const raw = await page.evaluate(() => window.localStorage.getItem('akonta_auth_session'));
  if (!raw) throw new Error('akonta_auth_session is missing from localStorage');
  const parsed = JSON.parse(raw) as BrowserAuthSession;
  if (!parsed.accessToken || !parsed.refreshToken) {
    throw new Error('akonta_auth_session does not include access/refresh token');
  }
  return parsed;
};

test('otp login, owner invite, workspace switch, role restrictions, and logout refresh lifecycle', async ({ page, request }) => {
  const seed = Date.now();
  const ownerPhone = randomPhone(seed, 1);
  const secondaryOwnerPhone = randomPhone(seed, 2);
  const cashierPhone = randomPhone(seed, 3);
  const viewerPhone = randomPhone(seed, 4);

  const ownerBusinessName = `E2E Owner Biz ${seed}`;
  const secondaryBusinessName = `E2E Secondary Biz ${seed}`;

  await bootstrapOwner(request, {
    name: 'E2E Owner',
    phoneNumber: ownerPhone,
    businessName: ownerBusinessName
  });
  const secondaryBootstrap = await bootstrapOwner(request, {
    name: 'E2E Secondary Owner',
    phoneNumber: secondaryOwnerPhone,
    businessName: secondaryBusinessName
  });

  const ownerApiSession = await verifyOtpViaApi(request, {
    phoneNumber: ownerPhone,
    code: await requestDevOtp(request, ownerPhone)
  });
  const secondaryApiSession = await verifyOtpViaApi(request, {
    phoneNumber: secondaryOwnerPhone,
    code: await requestDevOtp(request, secondaryOwnerPhone)
  });

  const crossWorkspaceInvite = await inviteMember(request, secondaryApiSession.tokens.accessToken, {
    fullName: 'E2E Owner',
    phoneNumber: ownerPhone,
    role: 'manager'
  });
  await updateMembership(request, secondaryApiSession.tokens.accessToken, crossWorkspaceInvite.membershipId, {
    status: 'active'
  });

  await inviteMember(request, ownerApiSession.tokens.accessToken, {
    fullName: 'E2E Viewer',
    phoneNumber: viewerPhone,
    role: 'viewer'
  });

  await loginViaOtpUi(page, ownerPhone);
  await openSettings(page);

  const inviteContainer = page.locator('div').filter({
    has: page.getByRole('button', { name: 'Invite Team Member' })
  }).first();
  await inviteContainer.locator('input[placeholder="Full name"]').fill('E2E Cashier');
  await inviteContainer.locator('input[placeholder="Phone number (recommended)"]').fill(cashierPhone);
  await inviteContainer.getByRole('button', { name: 'Invite Team Member' }).click();
  await expect(page.getByText('E2E Cashier invited as Cashier.')).toBeVisible();

  const switchWorkspacePanel = page.locator('div').filter({ hasText: 'Switch workspace' }).first();
  await expect(switchWorkspacePanel).toBeVisible();
  await switchWorkspacePanel.locator('select').selectOption({
    label: `${secondaryBootstrap.business.businessName} (Manager)`
  });
  await switchWorkspacePanel.getByRole('button', { name: 'Switch Workspace' }).click();
  await expect(page.getByText(`Switched to ${secondaryBootstrap.business.businessName}.`)).toBeVisible();

  const ownerBrowserSession = await readBrowserSession(page);
  const refreshTokenForRevocationCheck = ownerBrowserSession.refreshToken;
  await logoutToLanding(page);

  const refreshAfterLogout = await request.post(`${API_BASE_URL}/api/auth/refresh`, {
    data: { refreshToken: refreshTokenForRevocationCheck }
  });
  expect(refreshAfterLogout.status()).toBe(401);

  await loginViaOtpUi(page, cashierPhone);
  await openSettings(page);
  await expect(page.getByText('Only workspace owners can invite or edit team members.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite Team Member' })).toHaveCount(0);

  const cashierSession = await readBrowserSession(page);
  expect(cashierSession.role).toBe('cashier');
  const cashierInviteDenied = await request.post(`${API_BASE_URL}/api/workspaces/members/invite`, {
    data: {
      fullName: 'Denied Invite',
      phoneNumber: randomPhone(seed, 99),
      role: 'cashier'
    },
    headers: { Authorization: `Bearer ${cashierSession.accessToken}` }
  });
  expect(cashierInviteDenied.status()).toBe(403);
  await logoutToLanding(page);

  await loginViaOtpUi(page, viewerPhone);
  await openSettings(page);
  await expect(page.getByText('Only workspace owners can invite or edit team members.')).toBeVisible();
  const viewerSession = await readBrowserSession(page);
  expect(viewerSession.role).toBe('viewer');

  const viewerCreateDenied = await request.post(`${API_BASE_URL}/api/transactions`, {
    data: {
      type: 'expense',
      amount: 99,
      category: 'Viewer blocked action'
    },
    headers: { Authorization: `Bearer ${viewerSession.accessToken}` }
  });
  expect(viewerCreateDenied.status()).toBe(403);

  await logoutToLanding(page);
  await expect(page.getByRole('button', { name: 'Create Account' }).first()).toBeVisible();
});
