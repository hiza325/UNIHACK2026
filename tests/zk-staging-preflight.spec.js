import { expect, test } from '@playwright/test';

import { resolveStagingTarget, runStagingPreflight } from '../scripts/zk-staging-preflight.mjs';

function expectCode(fn, code) {
  let error;
  try { fn(); } catch (caught) { error = caught; }
  expect(error?.code).toBe(code);
}

test('staging preflight rejects production and mismatched projects', () => {
  expectCode(() => resolveStagingTarget({
    SUPABASE_URL: 'https://bwjpnyifsoiwoetxflzf.supabase.co',
  }), 'ZK_STAGING_PREFLIGHT_PRODUCTION');

  expectCode(() => resolveStagingTarget({
    SUPABASE_URL: 'https://wrongref.supabase.co',
  }), 'ZK_STAGING_PREFLIGHT_PROJECT_MISMATCH');

  expectCode(() => resolveStagingTarget({
    SUPABASE_URL: 'http://127.0.0.1:54321',
  }), 'ZK_STAGING_PREFLIGHT_LOCAL_NOT_ALLOWED');
});

test('staging preflight requires explicit confirmation', async () => {
  await expect(runStagingPreflight({
    env: { SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co' },
    fetcher: async () => ({ status: 200 }),
  })).rejects.toMatchObject({ code: 'ZK_STAGING_PREFLIGHT_NOT_CONFIRMED' });
});

test('staging preflight accepts service-role access with anon/authenticated denial', async () => {
  const calls = [];
  const result = await runStagingPreflight({
    env: {
      SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key',
      ZK_STAGING_AUTHENTICATED_JWT: 'auth-jwt',
      ZK_STAGING_PREFLIGHT_CONFIRMED: '1',
    },
    fetcher: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      if (options.headers.Authorization === 'Bearer service-key') return { status: 200 };
      return { status: options.headers.Authorization === 'Bearer auth-jwt' ? 403 : 401 };
    },
  });
  expect(result).toMatchObject({
    environment: 'staging',
    projectRef: 'ekkyygjlshrhibrdmhlx',
    serviceStatus: 200,
    anonStatus: 401,
    authenticatedStatus: 403,
  });
  expect(calls).toHaveLength(3);
});

test('staging preflight fails if service-role or anon access is wrong', async () => {
  await expect(runStagingPreflight({
    env: {
      SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key',
      ZK_STAGING_PREFLIGHT_CONFIRMED: '1',
    },
    fetcher: async (url, options) => ({ status: options.headers.Authorization === 'Bearer service-key' ? 404 : 200 }),
  })).rejects.toMatchObject({ code: 'ZK_STAGING_PREFLIGHT_SERVICE_FAILED' });

  await expect(runStagingPreflight({
    env: {
      SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key',
      ZK_STAGING_PREFLIGHT_CONFIRMED: '1',
    },
    fetcher: async (url, options) => ({ status: 200 }),
  })).rejects.toMatchObject({ code: 'ZK_STAGING_PREFLIGHT_ANON_ALLOWED' });
});
