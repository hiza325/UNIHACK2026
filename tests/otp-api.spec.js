import { test, expect } from '@playwright/test';
import { processOtpRequest } from '../api/auth/otp.js';
import { emailOtpConfigured, smtpSettings } from '../api/auth/_mail.js';

const env = { NODE_ENV: 'test', OTP_SECRET: 'test-secret-that-is-long-enough-for-otp-signing' };

test('OTP challenge verifies the development code and rejects a wrong code', async () => {
  const sent = await processOtpRequest({ action: 'send', email: 'User@Example.com', language: 'vi' }, { env, now: () => 1_000 });
  expect(sent.developmentCode).toMatch(/^\d{6}$/);

  await expect(processOtpRequest({ action: 'verify', email: 'user@example.com', code: sent.developmentCode, challenge: sent.challenge }, { env, now: () => 2_000 })).resolves.toEqual({ verified: true });
  const wrongCode = sent.developmentCode === '000000' ? '111111' : '000000';
  await expect(processOtpRequest({ action: 'verify', email: 'user@example.com', code: wrongCode, challenge: sent.challenge }, { env, now: () => 2_000 })).rejects.toThrow('Invalid or expired verification code');
});

test('OTP challenge expires after ten minutes', async () => {
  const sent = await processOtpRequest({ action: 'send', email: 'user@example.com' }, { env, now: () => 1_000 });
  await expect(processOtpRequest({ action: 'verify', email: 'user@example.com', code: sent.developmentCode, challenge: sent.challenge }, { env, now: () => 601_001 })).rejects.toThrow('Invalid or expired verification code');
});

test('OTP can be delivered from the configured Gmail account', async () => {
  let message;
  const gmailEnv = { VERCEL: '1', OTP_SECRET: env.OTP_SECRET, GMAIL_USER: 'owner@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', GMAIL_FROM_NAME: 'PARADOX AI' };
  const transporter = { async sendMail(payload) { message = payload; } };
  const sent = await processOtpRequest({ action: 'send', email: 'learner@gmail.com', language: 'vi' }, { env: gmailEnv, transporter });

  expect(sent.developmentCode).toBeUndefined();
  expect(message.to).toBe('learner@gmail.com');
  expect(message.from).toBe('"PARADOX AI" <owner@gmail.com>');
  expect(message.html).toContain('Mã OTP của bạn');
});

test('OTP can be delivered through a generic SMTP provider', async () => {
  let transportOptions;
  let message;
  const smtpEnv = {
    VERCEL: '1',
    OTP_SECRET: env.OTP_SECRET,
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'mailer@example.com',
    SMTP_PASS: 'smtp-password',
    SMTP_FROM_EMAIL: 'no-reply@example.com',
    SMTP_FROM_NAME: 'PARADOX Mail',
  };
  const sent = await processOtpRequest(
    { action: 'send', email: 'learner@example.com', language: 'en' },
    {
      env: smtpEnv,
      transportFactory(options) {
        transportOptions = options;
        return { async sendMail(payload) { message = payload; } };
      },
    },
  );

  expect(sent.developmentCode).toBeUndefined();
  expect(transportOptions).toMatchObject({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: 'mailer@example.com', pass: 'smtp-password' },
    tls: { minVersion: 'TLSv1.2' },
  });
  expect(message).toMatchObject({
    from: '"PARADOX Mail" <no-reply@example.com>',
    to: 'learner@example.com',
    subject: 'Your PARADOX verification code',
  });
  expect(message.text).toContain('Your verification code is:');
  expect(message.html).toContain('Verify your PARADOX account');
});

test('SMTP selects implicit TLS on port 465 and allows explicit localhost testing', () => {
  const secure = smtpSettings({
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'mailer@example.com',
    SMTP_PASS: 'secret',
  });
  expect(secure.transportOptions).toMatchObject({ port: 465, secure: true, requireTLS: false });

  const local = smtpSettings({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM_EMAIL: 'dev@example.com',
  });
  expect(local.transportOptions).toMatchObject({ port: 1025, secure: false, requireTLS: false });
  expect(local.transportOptions.auth).toBeUndefined();
});

test('SMTP configuration fails fast when required values are missing', async () => {
  await expect(processOtpRequest(
    { action: 'send', email: 'learner@example.com' },
    { env: { VERCEL: '1', OTP_SECRET: env.OTP_SECRET, SMTP_HOST: 'smtp.example.com' } },
  )).rejects.toMatchObject({ status: 503, code: 'EMAIL_NOT_CONFIGURED' });

  expect(() => smtpSettings({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer@example.com' })).toThrow('SMTP_USER and SMTP_PASS');
  expect(() => smtpSettings({ SMTP_HOST: 'smtp.example.com', SMTP_FROM_EMAIL: 'invalid' })).toThrow('SMTP_FROM_EMAIL');
  expect(() => smtpSettings({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: 'maybe', SMTP_FROM_EMAIL: 'no-reply@example.com' })).toThrow('SMTP_SECURE');
});

test('SMTP delivery failures do not leak into OTP responses', async () => {
  const failedEnv = {
    VERCEL: '1',
    OTP_SECRET: env.OTP_SECRET,
    SMTP_HOST: 'smtp.example.com',
    SMTP_FROM_EMAIL: 'no-reply@example.com',
  };
  const options = {
    env: failedEnv,
    transportFactory() {
      return { async sendMail() { throw new Error('550 mailbox unavailable for learner@example.com'); } };
    },
  };
  await expect(processOtpRequest({ action: 'send', email: 'learner@example.com' }, options))
    .rejects.toMatchObject({ status: 502, code: 'EMAIL_DELIVERY_FAILED', message: 'Email delivery failed' });
});

test('custom OTP email is enabled for SMTP and still requires a strong OTP secret', () => {
  const smtpEnv = { OTP_SECRET: env.OTP_SECRET, SMTP_HOST: 'smtp.example.com', SMTP_FROM_EMAIL: 'no-reply@example.com' };
  expect(emailOtpConfigured(smtpEnv)).toBe(true);
  expect(emailOtpConfigured({ ...smtpEnv, OTP_SECRET: 'short' })).toBe(false);
  expect(emailOtpConfigured({ GMAIL_USER: 'owner@gmail.com', GMAIL_APP_PASSWORD: 'app-password', OTP_SECRET: env.OTP_SECRET })).toBe(true);
});
