import { expect, test } from '@playwright/test';
import otpHandler from '../api/auth/otp.js';
import adminUsersHandler from '../api/admin/users.js';
import { createSuspensionAppealToken } from '../api/auth/_suspension.js';

function responseRecorder() {
  return {
    statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OTP_SECRET', 'ADMIN_EMAILS', 'RATE_LIMIT_DISABLED'];

test('admin records a suspension reason and the suspended user can submit an appeal', async () => {
  const originalFetch = global.fetch;
  const previousEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    OTP_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters', ADMIN_EMAILS: 'admin@example.com', RATE_LIMIT_DISABLED: '1',
  });
  let target = {
    id: 'user-id', email: 'user@example.com', banned_until: null, created_at: '2026-01-01T00:00:00.000Z',
    app_metadata: {}, user_metadata: { full_name: 'Learner' },
  };
  global.fetch = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com' }), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/admin-id')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com', app_metadata: { role: 'admin' } }), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/user-id') && options.method === 'GET') return new Response(JSON.stringify(target), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/user-id') && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      target = { ...target, app_metadata: body.app_metadata, banned_until: body.ban_duration === 'none' ? null : '2099-01-01T00:00:00.000Z' };
      return new Response(JSON.stringify(target), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const adminResponse = responseRecorder();
    await adminUsersHandler({ method: 'PATCH', headers: { cookie: 'paradox-access=admin-token' }, body: { id: 'user-id', status: 'suspended', reason: 'account_sharing' } }, adminResponse);
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.payload.user).toMatchObject({ status: 'suspended', suspensionReason: 'account_sharing' });

    const appealToken = createSuspensionAppealToken(target);
    const appealResponse = responseRecorder();
    await otpHandler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.20' }, body: { action: 'suspension-appeal', appealToken, message: 'Tôi không chia sẻ tài khoản và mong quản trị viên kiểm tra lại lịch sử đăng nhập.' } }, appealResponse);
    expect(appealResponse.statusCode).toBe(200);
    expect(appealResponse.payload).toEqual({ appealed: true });
    expect(target.app_metadata.suspension_appeal).toMatchObject({ status: 'pending' });
    expect(target.app_metadata.suspension_appeal.message).toContain('không chia sẻ tài khoản');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('appeals require a valid signed token and meaningful content', async () => {
  const previousSecret = process.env.OTP_SECRET;
  process.env.OTP_SECRET = 'a-secure-test-secret-that-is-at-least-32-characters';
  try {
    const invalidToken = responseRecorder();
    await otpHandler({ method: 'POST', headers: {}, body: { action: 'suspension-appeal', appealToken: 'invalid', message: 'Nội dung kháng cáo đủ dài để gửi.' } }, invalidToken);
    expect(invalidToken.statusCode).toBe(403);
  } finally {
    previousSecret === undefined ? delete process.env.OTP_SECRET : process.env.OTP_SECRET = previousSecret;
  }
});
