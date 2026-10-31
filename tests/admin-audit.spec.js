import { expect, test } from '@playwright/test';
import { createAdminAuditLog } from '../api/admin/_audit.js';
import { createAdminUsersHandler } from '../api/admin/users.js';
import { createCredentialsHandler } from '../api/credentials/index.js';

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAILS', 'RATE_LIMIT_DISABLED'];

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

async function withAdminEnv(run) {
  const originalFetch = global.fetch;
  const previousEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ADMIN_EMAILS: 'admin@example.com',
    RATE_LIMIT_DISABLED: '1',
  });
  global.fetch = async url => {
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com' }), { status: 200 });
    if (url.endsWith('/auth/v1/admin/users/admin-id')) return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@example.com', app_metadata: { role: 'admin' } }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    await run();
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

function createRecorder() {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(null, { status: 201 });
    },
  };
}

test('Audit log is disabled and silent when the service role key is missing', async () => {
  let calls = 0;
  const log = createAdminAuditLog({ env: {}, fetcher: async () => { calls += 1; return new Response(null, { status: 201 }); } });

  expect(log.configured).toBe(false);
  expect(await log.record({ action: 'credential.revoke', actorId: 'admin-id', targetType: 'credential', targetId: 'PXP-1' })).toBe(false);
  expect(calls).toBe(0);
});

test('Audit log writes who/what/when through the service role only', async () => {
  const recorder = createRecorder();
  const log = createAdminAuditLog({
    env: { SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-key' },
    fetcher: recorder.fetcher,
    now: () => Date.parse('2026-11-01T00:00:00.000Z'),
  });

  const written = await log.record({
    action: 'user.suspend',
    actorId: 'admin-id',
    actorEmail: 'admin@example.com',
    targetType: 'user',
    targetId: 'user-id',
    metadata: { reason: 'account_sharing' },
  });

  expect(written).toBe(true);
  expect(recorder.calls).toHaveLength(1);
  const [{ url, options }] = recorder.calls;
  expect(url).toBe('https://project.supabase.co/rest/v1/admin_audit_log');
  expect(options.method).toBe('POST');
  expect(options.headers.apikey).toBe('service-key');
  expect(options.headers.Authorization).toBe('Bearer service-key');
  expect(options.headers.Prefer).toBe('return=minimal');
  expect(JSON.parse(options.body)).toEqual({
    action: 'user.suspend',
    actor_id: 'admin-id',
    actor_email: 'admin@example.com',
    target_type: 'user',
    target_id: 'user-id',
    metadata: { reason: 'account_sharing' },
    created_at: '2026-11-01T00:00:00.000Z',
  });
});

test('Audit log rejects unknown actions and never throws on a failing upstream', async () => {
  const log = createAdminAuditLog({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' },
    fetcher: async () => { throw new Error('network down'); },
  });

  expect(await log.record({ action: 'credential.revoke', actorId: 'admin-id', targetType: 'credential' })).toBe(false);
  expect(await log.record({ action: 'user.delete_everything', actorId: 'admin-id', targetType: 'user' })).toBe(false);
  expect(await log.record({ action: 'credential.revoke', actorId: '', targetType: 'credential' })).toBe(false);
});

test('Suspending an account records an audit entry with the acting admin', async () => {
  const audits = [];
  const originalFetch = global.fetch;
  await withAdminEnv(async () => {
    const forward = global.fetch;
    global.fetch = async (url, options = {}) => {
      if (url.endsWith('/auth/v1/admin/users/user-id') && options.method === 'GET') return new Response(JSON.stringify({ id: 'user-id', email: 'user@example.com', app_metadata: {} }), { status: 200 });
      if (url.endsWith('/auth/v1/admin/users/user-id') && options.method === 'PUT') return new Response(JSON.stringify({ id: 'user-id', email: 'user@example.com' }), { status: 200 });
      return forward(url, options);
    };
    const handler = createAdminUsersHandler({ auditFactory: () => ({ record: async entry => { audits.push(entry); return true; } }) });
    const res = responseRecorder();
    await handler({ method: 'PATCH', headers: { cookie: 'paradox-access=admin-token' }, body: { id: 'user-id', status: 'suspended', reason: 'account_sharing' } }, res);
    expect(res.statusCode).toBe(200);
  });
  global.fetch = originalFetch;

  expect(audits).toEqual([{
    action: 'user.suspend',
    actorId: 'admin-id',
    actorEmail: 'admin@example.com',
    targetType: 'user',
    targetId: 'user-id',
    metadata: { reason: 'account_sharing' },
  }]);
});

test('Revoking a credential records an audit entry with the acting admin', async () => {
  const audits = [];
  await withAdminEnv(async () => {
    const handler = createCredentialsHandler({
      storeFactory: () => ({}),
      serviceFactory: () => ({
        revoke: async credentialCode => ({ credentialCode, blockchainStatus: 'revoked' }),
      }),
      auditFactory: () => ({ record: async entry => { audits.push(entry); return true; } }),
    });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { cookie: 'paradox-access=admin-token' }, body: { action: 'revoke', credentialCode: 'PXP-TEST-2026-0001' } }, res);
    expect(res.statusCode).toBe(200);
  });

  expect(audits).toEqual([{
    action: 'credential.revoke',
    actorId: 'admin-id',
    actorEmail: 'admin@example.com',
    targetType: 'credential',
    targetId: 'PXP-TEST-2026-0001',
    metadata: {},
  }]);
});
