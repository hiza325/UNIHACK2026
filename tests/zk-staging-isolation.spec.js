import { expect, test } from '@playwright/test';

import { zkStagingDatabaseContext, zkStoreConfig } from '../api/zk/_store.js';

function expectCode(fn, code) {
  let error;
  try { fn(); } catch (caught) { error = caught; }
  expect(error?.code).toBe(code);
}

test('local Supabase URL is allowed for ZK store', () => {
  expect(zkStagingDatabaseContext({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  })).toMatchObject({ environment: 'local', projectRef: null });
});

test('approved staging Supabase URL is allowed', () => {
  expect(zkStagingDatabaseContext({
    SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  })).toMatchObject({ environment: 'staging', projectRef: 'ekkyygjlshrhibrdmhlx' });
});

test('production Supabase URL is rejected', () => {
  expectCode(() => zkStagingDatabaseContext({
    SUPABASE_URL: 'https://bwjpnyifsoiwoetxflzf.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  }), 'ZK_PRODUCTION_DATABASE_FORBIDDEN');
});

test('mismatched staging project ref is rejected', () => {
  expectCode(() => zkStagingDatabaseContext({
    SUPABASE_URL: 'https://wrongref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  }), 'ZK_STAGING_PROJECT_MISMATCH');
});

test('unknown or non-Supabase host is rejected', () => {
  expectCode(() => zkStagingDatabaseContext({
    SUPABASE_URL: 'https://example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  }), 'ZK_DATABASE_PROJECT_UNTRUSTED');
});

test('missing URL and production override fail closed', () => {
  expectCode(() => zkStoreConfig({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }), 'ZK_DATABASE_NOT_CONFIGURED');
  expectCode(() => zkStagingDatabaseContext({
    SUPABASE_URL: 'https://ekkyygjlshrhibrdmhlx.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    ZK_STAGING_SUPABASE_PROJECT_REF: 'bwjpnyifsoiwoetxflzf',
  }), 'ZK_STAGING_PROJECT_CONFIG_INVALID');
});
