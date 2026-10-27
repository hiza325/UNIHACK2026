import { test, expect } from '@playwright/test';
import { processOtpRequest } from '../api/auth/otp.js';

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
