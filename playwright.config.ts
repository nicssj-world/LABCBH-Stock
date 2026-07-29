import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'
const runLocalServer = process.env.E2E_RUN_LOCAL_SERVER === '1'
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

if (process.env.CI && !process.env.E2E_BASE_URL) {
  throw new Error('E2E_BASE_URL is required in CI; run browser tests against an isolated preview or staging deployment')
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results/playwright',
  use: {
    baseURL,
    extraHTTPHeaders: protectionBypass
      ? {
          'x-vercel-protection-bypass': protectionBypass,
        }
      : undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: runLocalServer
    ? {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
})
