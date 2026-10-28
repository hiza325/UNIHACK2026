import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8175',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node tests/static-server.mjs',
    url: 'http://127.0.0.1:8175',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    env: {
      PORT: '8175',
      NODE_ENV: 'test',
      OTP_SECRET: '',
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
      GMAIL_FROM_NAME: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_SECURE: '',
      SMTP_REQUIRE_TLS: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM_EMAIL: '',
      SMTP_FROM_NAME: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ADMIN_EMAILS: '',
      OTP_SEND_COOLDOWN_SECONDS: '0',
      OTP_SEND_EMAIL_LIMIT: '3',
      OTP_SEND_IP_LIMIT: '500',
      OTP_VERIFY_EMAIL_LIMIT: '500',
      OTP_VERIFY_IP_LIMIT: '500'
    }
  }
});
