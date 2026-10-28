import { test, expect } from '@playwright/test';
import signupHandler from '../api/auth/signup.js';
import verifyHandler from '../api/auth/verify.js';
import adminUsersHandler from '../api/admin/users.js';
import sessionHandler from '../api/auth/session.js';

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('Supabase auth sends signup OTP, creates HttpOnly session and protects admin users', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS: process.env.ADMIN_EMAILS, GMAIL_USER: process.env.GMAIL_USER, GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD, OTP_SECRET: process.env.OTP_SECRET };
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_EMAILS: 'admin@example.com' });
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  delete process.env.OTP_SECRET;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/signup')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com', identities: [{}] }), { status: 200 });
    if (url.endsWith('/auth/v1/verify')) return new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, user: { id: 'admin-id', email: 'admin@example.com', user_metadata: { full_name: 'Admin' } } }), { status: 200 });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com', user_metadata: { full_name: 'Admin' } }), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/admin-id')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com', user_metadata: { full_name: 'Admin' } }), { status: 200 });
    if (url.includes('/auth/v1/admin/users?')) return new Response(JSON.stringify({ users: [{ id: 'user-id', email: 'user@example.com', created_at: '2026-01-01T00:00:00.000Z' }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  };

  try {
    const signupRes = responseRecorder();
    await signupHandler({ method: 'POST', body: { name: 'Admin', email: 'admin@example.com', password: 'Password123!' } }, signupRes);
    expect(signupRes.statusCode).toBe(200);
    expect(signupRes.payload).toEqual({ requiresOtp: true });

    const verifyRes = responseRecorder();
    await verifyHandler({ method: 'POST', body: { email: 'admin@example.com', code: '123456' } }, verifyRes);
    expect(verifyRes.payload.user.role).toBe('admin');
    expect(verifyRes.headers['Set-Cookie'].join(';')).toContain('HttpOnly');

    const adminRes = responseRecorder();
    await adminUsersHandler({ method: 'GET', headers: { cookie: 'paradox-access=access-token' } }, adminRes);
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.payload.users[0].email).toBe('user@example.com');
    expect(calls.find(call => call.url.includes('/admin/users')).options.headers.apikey).toBe('service-key');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('session rejects and clears an already-open session after the account is suspended', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-id', email: 'user@example.com' }), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/user-id')) return new Response(JSON.stringify({ id: 'user-id', email: 'user@example.com', banned_until: '2099-01-01T00:00:00.000Z' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=active-token; paradox-refresh=refresh-token' } }, response);

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(response.headers['Set-Cookie'].join(';')).toContain('paradox-access=');
    expect(response.headers['Set-Cookie'].join(';')).toContain('Max-Age=0');
    expect(calls.some(call => call.url.includes('grant_type=refresh_token'))).toBe(false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('session forwards a Supabase 403 without refreshing the suspended session', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ message: 'User is banned' }), { status: 403 });
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=active-token; paradox-refresh=refresh-token' } }, response);

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(response.headers['Set-Cookie'].join(';')).toContain('Max-Age=0');
    expect(calls.some(call => call.url.includes('grant_type=refresh_token'))).toBe(false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
