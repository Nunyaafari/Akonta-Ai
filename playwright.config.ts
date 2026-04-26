import { defineConfig, devices } from '@playwright/test';

const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 4000);
const frontendHost = process.env.E2E_FRONTEND_HOST ?? '127.0.0.1';
const apiHost = process.env.E2E_API_HOST ?? '127.0.0.1';

const baseURL = process.env.E2E_FRONTEND_URL ?? `http://${frontendHost}:${frontendPort}`;
const apiBaseURL = process.env.E2E_API_BASE_URL ?? `http://${apiHost}:${apiPort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npx prisma generate && npx prisma migrate deploy && npm run build && npm run start',
      cwd: './backend',
      url: `${apiBaseURL}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        PORT: String(apiPort),
        APP_ORIGIN: baseURL,
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:password@127.0.0.1:5432/ledgermate_e2e',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'e2e_access_secret_12345678901234567890123456789012',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'e2e_refresh_secret_12345678901234567890123456789012',
        ALLOW_LEGACY_USER_HEADER_AUTH: 'false',
        AUTH_EXPOSE_DEV_OTP: 'true',
        NODE_ENV: process.env.NODE_ENV ?? 'development'
      }
    },
    {
      command: `npm run dev -- --host ${frontendHost} --port ${frontendPort}`,
      cwd: '.',
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_BASE_URL: apiBaseURL,
        VITE_ALLOW_MOCK_FALLBACK: 'false'
      }
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    }
  ]
});
