import { test, expect } from '@playwright/test';
import {
  guardOtpSend,
  guardOtpVerify,
  rateLimitSettings,
  resetRateLimitState,
} from '../api/auth/_rate-limit.js';

const request = (ip = '203.0.113.7') => ({ headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '127.0.0.1' } });

function capture(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test.beforeEach(() => resetRateLimitState());

test('a second OTP request for the same email waits for the cooldown', () => {
  const env = { OTP_SEND_EMAIL_LIMIT: '100', OTP_SEND_IP_LIMIT: '100' };
  const at = request();

  expect(capture(() => guardOtpSend(at, 'user@example.com', { env, now: 1_000 }))).toBeNull();

  const blocked = capture(() => guardOtpSend(at, 'user@example.com', { env, now: 31_000 }));
  expect(blocked).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfter: 30 });

  expect(capture(() => guardOtpSend(at, 'other@example.com', { env, now: 31_000 }))).toBeNull();
  expect(capture(() => guardOtpSend(at, 'user@example.com', { env, now: 61_000 }))).toBeNull();
});

test('one email cannot exceed its hourly send budget', () => {
  const env = { OTP_SEND_COOLDOWN_SECONDS: '0', OTP_SEND_EMAIL_LIMIT: '3', OTP_SEND_IP_LIMIT: '100' };
  const at = request();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect(capture(() => guardOtpSend(at, 'user@example.com', { env, now: attempt * 1_000 }))).toBeNull();
  }

  const blocked = capture(() => guardOtpSend(at, 'user@example.com', { env, now: 3_500 }));
  expect(blocked).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  expect(blocked.retryAfter).toBeGreaterThan(3_500);

  expect(capture(() => guardOtpSend(at, 'user@example.com', { env, now: 60 * 60 * 1000 + 1 }))).toBeNull();
});

test('one IP cannot exceed its send budget across many emails', () => {
  const env = { OTP_SEND_COOLDOWN_SECONDS: '0', OTP_SEND_EMAIL_LIMIT: '100', OTP_SEND_IP_LIMIT: '2' };
  const at = request('198.51.100.9');

  expect(capture(() => guardOtpSend(at, 'one@example.com', { env, now: 1 }))).toBeNull();
  expect(capture(() => guardOtpSend(at, 'two@example.com', { env, now: 2 }))).toBeNull();
  expect(capture(() => guardOtpSend(at, 'three@example.com', { env, now: 3 }))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  expect(capture(() => guardOtpSend(request('198.51.100.10'), 'four@example.com', { env, now: 4 }))).toBeNull();
});

test('verification attempts are limited per email and per IP', () => {
  const env = { OTP_VERIFY_EMAIL_LIMIT: '2', OTP_VERIFY_IP_LIMIT: '100' };
  const at = request('192.0.2.5');

  expect(capture(() => guardOtpVerify(at, 'user@example.com', { env, now: 1 }))).toBeNull();
  expect(capture(() => guardOtpVerify(at, 'user@example.com', { env, now: 2 }))).toBeNull();
  expect(capture(() => guardOtpVerify(at, 'user@example.com', { env, now: 3 }))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  expect(capture(() => guardOtpVerify(at, 'other@example.com', { env, now: 3 }))).toBeNull();

  const ipBound = { OTP_VERIFY_EMAIL_LIMIT: '100', OTP_VERIFY_IP_LIMIT: '1' };
  const other = request('192.0.2.6');
  expect(capture(() => guardOtpVerify(other, 'a@example.com', { env: ipBound, now: 10 }))).toBeNull();
  expect(capture(() => guardOtpVerify(other, 'b@example.com', { env: ipBound, now: 11 }))).toMatchObject({ status: 429 });
});

test('rate limiting can be configured or disabled with environment variables', () => {
  const settings = rateLimitSettings({
    OTP_SEND_COOLDOWN_SECONDS: '30',
    OTP_SEND_EMAIL_LIMIT: '4',
    OTP_SEND_IP_LIMIT: '9',
    OTP_VERIFY_EMAIL_LIMIT: '7',
    OTP_VERIFY_WINDOW_MINUTES: '5',
  });
  expect(settings).toMatchObject({
    disabled: false,
    sendCooldownMs: 30_000,
    sendEmailLimit: 4,
    sendIpLimit: 9,
    verifyEmailLimit: 7,
    verifyWindowMs: 5 * 60 * 1000,
  });
  expect(settings.sendWindowMs).toBe(60 * 60 * 1000);

  expect(rateLimitSettings({ RATE_LIMIT_DISABLED: 'true' }).disabled).toBe(true);
  expect(rateLimitSettings({ OTP_SEND_EMAIL_LIMIT: 'not-a-number' }).sendEmailLimit).toBe(5);

  const disabled = { RATE_LIMIT_DISABLED: '1' };
  expect(capture(() => {
    guardOtpSend(request(), 'spam@example.com', { env: disabled, now: 1 });
    guardOtpSend(request(), 'spam@example.com', { env: disabled, now: 2 });
  })).toBeNull();
});

test('the OTP endpoint answers 429 with Retry-After once the email budget is spent', async ({ request: api }) => {
  const email = `rate-limit-${Date.now()}@example.com`;
  const statuses = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await api.post('/api/auth/otp', { data: { action: 'send', email, language: 'en' } });
    statuses.push(response.status());
    if (response.status() === 429) {
      expect(response.headers()['retry-after']).toMatch(/^\d+$/);
      await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMITED', error: expect.any(String) });
    }
  }

  expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
  expect(statuses[3]).toBe(429);
});
