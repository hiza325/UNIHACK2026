import { test, expect } from '@playwright/test';
import signupHandler from '../api/auth/signup.js';
import verifyHandler from '../api/auth/verify.js';
import adminUsersHandler from '../api/admin/users.js';
import sessionHandler from '../api/auth/session.js';
import loginHandler from '../api/auth/login.js';
import credentialsHandler from '../api/credentials/index.js';
import learningRecordsHandler from '../api/learning-records/index.js';

const AUTH_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAILS', 'OTP_SECRET'];

function snapshotEnv() {
  return Object.fromEntries(AUTH_ENV_KEYS.map(key => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) value === undefined ? delete process.env[key] : process.env[key] = value;
}

function useTestAuthEnv() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ADMIN_EMAILS: 'admin@example.com',
    OTP_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
  });
}

function unsignedJwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

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

test('session fails closed when the authoritative ban lookup fails', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return jsonResponse({ id: 'user-id', email: 'user@example.com' });
    if (String(url).endsWith('/auth/v1/admin/users/user-id')) {
      return jsonResponse({ msg: 'database connection failed' }, 500);
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=access-token' } }, response);

    expect(response.statusCode).toBe(503);
    expect(response.payload).toEqual({
      error: 'Authentication service is temporarily unavailable',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
    expect(response.payload.user).toBeUndefined();
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session fails closed when the service role key is unavailable', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return jsonResponse({ id: 'user-id', email: 'user@example.com' });
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=access-token' } }, response);

    expect(response.statusCode).toBe(503);
    expect(response.payload.code).toBe('AUTH_SERVICE_UNAVAILABLE');
    expect(response.payload.user).toBeUndefined();
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session treats a Supabase user_banned 403 as ACCOUNT_SUSPENDED without refreshing', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, OTP_SECRET: process.env.OTP_SECRET };
  useTestAuthEnv();
  const token = unsignedJwt({ sub: 'user-id', email: 'user@example.com' });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return jsonResponse({ code: 403, error_code: 'user_banned', msg: 'User is banned' }, 403);
    if (url.endsWith('/auth/v1/admin/users/user-id')) {
      return jsonResponse({
        id: 'user-id', email: 'user@example.com', banned_until: '2099-01-01T00:00:00.000Z',
        app_metadata: { suspension_reason: 'account_sharing' },
      });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: `paradox-access=${token}; paradox-refresh=refresh-token` } }, response);

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ code: 'ACCOUNT_SUSPENDED', suspensionReason: 'account_sharing' });
    expect(response.payload.appealToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.payload)).not.toContain('User is banned');
    expect(response.headers['Cache-Control']).toBe('private, no-store');
    expect(response.headers['Set-Cookie'].join(';')).toContain('Max-Age=0');
    expect(calls.some(call => call.url.includes('grant_type=refresh_token'))).toBe(false);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session maps a malformed JWT 403 to SESSION_INVALID and hides upstream details', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  const refreshCalls = [];
  global.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({
        code: 403,
        error_code: 'bad_jwt',
        msg: 'invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments',
      }, 403);
    }
    refreshCalls.push(String(url));
    return new Response('{}', { status: 500 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=not-a-jwt; paradox-refresh=refresh-token' } }, response);

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ error: 'Session is invalid or has expired', code: 'SESSION_INVALID' });
    expect(response.headers['Cache-Control']).toBe('private, no-store');
    const cleared = response.headers['Set-Cookie'].join(';');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('SameSite=Strict');
    expect(cleared).toContain('Path=/');
    expect(refreshCalls).toHaveLength(0);
    expect(JSON.stringify(response.payload)).not.toMatch(/invalid JWT|malformed|segments|signature/i);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session never infers suspension from a 403 without a ban signal', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse({ msg: 'invalid JWT: unable to parse or verify signature, token is malformed' }, 403);
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=not-a-jwt' } }, response);

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ error: 'Session is invalid or has expired', code: 'SESSION_INVALID' });
    expect(JSON.stringify(response.payload)).not.toContain('ACCOUNT_SUSPENDED');
    expect(JSON.stringify(response.payload)).not.toContain('invalid JWT');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session returns SESSION_INVALID for an expired JWT without a refresh token', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async () => jsonResponse({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: token is expired' }, 401);

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=expired-token' } }, response);

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ error: 'Session is invalid or has expired', code: 'SESSION_INVALID' });
    expect(response.headers['Cache-Control']).toBe('private, no-store');
    expect(JSON.stringify(response.payload)).not.toContain('invalid JWT');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('session still refreshes an expired access token when the refresh token is valid', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) return jsonResponse({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: token is expired' }, 401);
    if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
      return jsonResponse({
        access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600,
        user: { id: 'user-id', email: 'user@example.com' },
      });
    }
    if (String(url).endsWith('/auth/v1/admin/users/user-id')) return jsonResponse({ id: 'user-id', email: 'user@example.com' });
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=expired-token; paradox-refresh=refresh-token' } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.payload.user).toMatchObject({ id: 'user-id', email: 'user@example.com', status: 'active' });
    expect(response.headers['Cache-Control']).toBe('private, no-store');
    expect(response.headers['Set-Cookie'].join(';')).toContain('new-access-token');
    expect(calls.filter(url => url.includes('grant_type=refresh_token'))).toHaveLength(1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('auth service failures return a generic 503 without leaking database details', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  let mode = 'server-error';
  global.fetch = async () => {
    if (mode === 'server-error') {
      return jsonResponse({ msg: 'database connection failed for postgres://user:secret@private-host' }, 500);
    }
    throw new Error('connect ECONNREFUSED 10.1.2.3:5432');
  };

  try {
    const serverError = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=access-token' } }, serverError);
    expect(serverError.statusCode).toBe(503);
    expect(serverError.payload).toEqual({
      error: 'Authentication service is temporarily unavailable',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
    expect(serverError.headers['Cache-Control']).toBe('private, no-store');
    expect(JSON.stringify(serverError.payload)).not.toMatch(/database|postgres|secret|ECONNREFUSED/i);

    mode = 'network-error';
    const networkError = responseRecorder();
    await sessionHandler({ method: 'GET', headers: { cookie: 'paradox-access=access-token' } }, networkError);
    expect(networkError.statusCode).toBe(503);
    expect(networkError.payload.code).toBe('AUTH_SERVICE_UNAVAILABLE');
    expect(JSON.stringify(networkError.payload)).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|5432/);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('login only reports ACCOUNT_SUSPENDED for the authoritative GoTrue ban signal', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/token?grant_type=password')) {
      return jsonResponse({ code: 400, error_code: 'user_banned', msg: 'User is banned' }, 400);
    }
    if (String(url).includes('/auth/v1/admin/users?')) {
      return jsonResponse({
        users: [{
          id: 'user-id', email: 'user@example.com', banned_until: '2099-01-01T00:00:00.000Z',
          app_metadata: { suspension_reason: 'policy_violation' },
        }],
      });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await loginHandler({ method: 'POST', body: { email: 'user@example.com', password: 'Password123!' } }, response);

    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ code: 'ACCOUNT_SUSPENDED', suspensionReason: 'policy_violation' });
    expect(response.payload.appealToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.payload)).not.toContain('User is banned');
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('login keeps invalid credentials generic and does not cache the response', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async () => jsonResponse({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);

  try {
    const response = responseRecorder();
    await loginHandler({ method: 'POST', body: { email: 'user@example.com', password: 'WrongPassword1!' } }, response);

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: 'Invalid email or password' });
    expect(JSON.stringify(response.payload)).not.toContain('Invalid login credentials');
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('valid login still creates an HttpOnly, private session', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/token?grant_type=password')) {
      return jsonResponse({
        access_token: 'valid-access-token', refresh_token: 'valid-refresh-token', expires_in: 3600,
        user: { id: 'admin-id', email: 'admin@example.com', user_metadata: { full_name: 'Admin' } },
      });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const response = responseRecorder();
    await loginHandler({ method: 'POST', body: { email: 'admin@example.com', password: 'Password123!' } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.payload.user).toMatchObject({ id: 'admin-id', email: 'admin@example.com', role: 'admin' });
    const cookies = response.headers['Set-Cookie'].join(';');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Secure');
    expect(cookies).toContain('SameSite=Strict');
    expect(cookies).toContain('Path=/');
    expect(cookies).toContain('paradox-access=valid-access-token');
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

test('credential and learning-record APIs return no-store auth errors without upstream details', async () => {
  const originalFetch = global.fetch;
  const previousEnv = snapshotEnv();
  useTestAuthEnv();
  global.fetch = async () => jsonResponse({
    code: 403, error_code: 'bad_jwt',
    msg: 'invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments',
  }, 403);

  try {
    for (const handler of [credentialsHandler, learningRecordsHandler]) {
      const response = responseRecorder();
      await handler({ method: 'GET', headers: { cookie: 'paradox-access=not-a-jwt' }, query: {} }, response);
      expect(response.statusCode).toBe(401);
      expect(response.payload).toMatchObject({ code: 'SESSION_INVALID' });
      expect(response.headers['Cache-Control']).toBe('private, no-store');
      expect(JSON.stringify(response.payload)).not.toMatch(/invalid JWT|malformed|segments/i);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});
