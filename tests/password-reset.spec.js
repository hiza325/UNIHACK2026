import { test, expect } from '@playwright/test';
import { processPasswordReset } from '../api/auth/password-reset.js';

const env = {
  VERCEL: '1',
  OTP_SECRET: 'password-reset-test-secret-that-is-long-enough',
  GMAIL_USER: 'owner@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
};

test('password reset sends an OTP and updates only a confirmed matching user', async () => {
  const calls = [];
  let updatedAt = '2026-01-01T00:00:00.000Z';
  const request = async (path, options) => {
    calls.push({ path, options });
    if (path.includes('/admin/users?')) return {
      users: [{ id: 'user-id', email: 'learner@example.com', email_confirmed_at: '2026-01-01T00:00:00.000Z', updated_at: updatedAt }],
    };
    if (path === '/auth/v1/admin/users/user-id' && options.method === 'PUT') {
      updatedAt = '2026-01-01T00:01:00.000Z';
      return { id: 'user-id' };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  let message;
  const sent = await processPasswordReset(
    { action: 'request', email: 'Learner@Example.com', language: 'vi' },
    { env, request, otpOptions: { transporter: { async sendMail(payload) { message = payload; } } } },
  );

  expect(sent).toMatchObject({ sent: true, challenge: expect.any(String) });
  expect(sent.developmentCode).toBeUndefined();
  expect(message).toMatchObject({ to: 'learner@example.com', subject: 'Đặt lại mật khẩu PARADOX' });
  const code = message.text.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
  expect(code).toMatch(/^\d{6}$/);

  await expect(processPasswordReset({
    action: 'confirm', email: 'learner@example.com', code, challenge: sent.challenge, password: 'NewPassword123!',
  }, { env, request })).resolves.toEqual({ reset: true });

  expect(calls.at(-1)).toMatchObject({
    path: '/auth/v1/admin/users/user-id',
    options: { method: 'PUT', body: { password: 'NewPassword123!' }, service: true },
  });

  await expect(processPasswordReset({
    action: 'confirm', email: 'learner@example.com', code, challenge: sent.challenge, password: 'AnotherPassword123!',
  }, { env, request })).rejects.toMatchObject({ status: 400 });
});

test('password reset does not reveal unknown or unconfirmed accounts', async () => {
  let mailSent = false;
  const request = async () => ({
    users: [{ id: 'pending-id', email: 'pending@example.com', email_confirmed_at: null }],
  });
  const options = {
    env,
    request,
    otpOptions: { transporter: { async sendMail() { mailSent = true; } } },
  };

  const pending = await processPasswordReset({ action: 'request', email: 'pending@example.com' }, options);
  const missing = await processPasswordReset({ action: 'request', email: 'missing@example.com' }, options);
  expect(pending).toMatchObject({ sent: true, challenge: expect.any(String) });
  expect(missing).toMatchObject({ sent: true, challenge: expect.any(String) });
  expect(pending.challenge.split('.')).toHaveLength(2);
  expect(missing.challenge.split('.')).toHaveLength(2);
  expect(mailSent).toBe(false);

  await expect(processPasswordReset({
    action: 'confirm', email: 'missing@example.com', code: '123456', challenge: missing.challenge, password: 'NewPassword123!',
  }, options)).rejects.toMatchObject({ status: 400 });
});

test('a signup OTP cannot be reused to reset a password', async () => {
  let deliveredCode;
  const { processOtpRequest } = await import('../api/auth/otp.js');
  const signup = await processOtpRequest(
    { action: 'send', email: 'learner@example.com' },
    { env, transporter: { async sendMail(message) { deliveredCode = message.text.match(/(?<!\d)\d{6}(?!\d)/)?.[0]; } } },
  );
  const request = async () => ({
    users: [{ id: 'user-id', email: 'learner@example.com', email_confirmed_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
  });

  await expect(processPasswordReset({
    action: 'confirm', email: 'learner@example.com', code: deliveredCode,
    challenge: signup.challenge, password: 'NewPassword123!',
  }, { env, request })).rejects.toMatchObject({ status: 400 });
});

test('forgot-password UI requests an OTP and submits the new password', async ({ page }) => {
  const calls = [];
  await page.route('**/api/auth/password-reset', async route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'request' ? { sent: true, challenge: 'reset-challenge' } : { reset: true }),
    });
  });

  await page.goto('/');
  await page.click('#landing-login');
  await page.click('#auth-forgot');
  await expect(page.locator('#auth-title')).toHaveText('Khôi phục mật khẩu');
  await page.fill('input[name="email"]', 'learner@example.com');
  await page.click('.auth-submit');

  await expect(page.locator('#auth-title')).toHaveText('Tạo mật khẩu mới');
  await page.fill('input[name="otp"]', '123456');
  await page.fill('input[name="password"]', 'NewPassword123!');
  await page.fill('input[name="confirm"]', 'NewPassword123!');
  await page.click('.auth-submit');

  await expect(page.locator('#auth-title')).toHaveText('Chào mừng trở lại');
  await expect(page.locator('input[name="email"]')).toHaveValue('learner@example.com');
  expect(calls).toEqual([
    { action: 'request', email: 'learner@example.com', language: 'vi' },
    { action: 'confirm', email: 'learner@example.com', code: '123456', password: 'NewPassword123!', challenge: 'reset-challenge' },
  ]);
});
