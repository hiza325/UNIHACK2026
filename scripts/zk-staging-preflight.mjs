#!/usr/bin/env node
/**
 * Read-only staging preflight for ZK Proof of Learning.
 *
 * This script never applies migrations, writes rows, prints keys, or targets
 * production. It only checks that the staging project ref is correct and that
 * PostgREST exposes zk_proofs to service_role while denying anon/authenticated.
 */

const PRODUCTION_REF = 'bwjpnyifsoiwoetxflzf';
const DEFAULT_STAGING_REF = 'ekkyygjlshrhibrdmhlx';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function fail(message, code = 'ZK_STAGING_PREFLIGHT_FAILED') {
  throw Object.assign(new Error(message), { code });
}

export function resolveStagingTarget(env = process.env) {
  const raw = String(env.SUPABASE_URL || '').trim();
  if (!raw) fail('SUPABASE_URL is required', 'ZK_STAGING_PREFLIGHT_CONFIG_MISSING');
  let parsed;
  try { parsed = new URL(raw); } catch { fail('SUPABASE_URL is invalid', 'ZK_STAGING_PREFLIGHT_CONFIG_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('SUPABASE_URL is invalid', 'ZK_STAGING_PREFLIGHT_CONFIG_INVALID');

  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) {
    if (String(env.ZK_STAGING_PREFLIGHT_ALLOW_LOCAL || '') !== '1') {
      fail('Local Supabase is not staging; set ZK_STAGING_PREFLIGHT_ALLOW_LOCAL=1 for a local dry run', 'ZK_STAGING_PREFLIGHT_LOCAL_NOT_ALLOWED');
    }
    return { baseUrl: parsed.origin, projectRef: null, environment: 'local' };
  }
  if (!host.endsWith('.supabase.co')) fail('SUPABASE_URL is not a Supabase project URL', 'ZK_STAGING_PREFLIGHT_UNTRUSTED_HOST');
  const projectRef = host.split('.')[0];
  if (projectRef === PRODUCTION_REF) fail('Refusing production Supabase project', 'ZK_STAGING_PREFLIGHT_PRODUCTION');
  const expected = String(env.ZK_STAGING_SUPABASE_PROJECT_REF || DEFAULT_STAGING_REF).trim().toLowerCase();
  if (expected === PRODUCTION_REF) fail('Expected staging ref cannot be production', 'ZK_STAGING_PREFLIGHT_CONFIG_INVALID');
  if (projectRef !== expected) fail('Supabase project does not match approved staging project', 'ZK_STAGING_PREFLIGHT_PROJECT_MISMATCH');
  return { baseUrl: parsed.origin, projectRef, environment: 'staging' };
}

async function request(fetcher, target, apikey, authorization, path) {
  const response = await fetcher(`${target.baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey,
      Authorization: `Bearer ${authorization}`,
      Accept: 'application/json',
    },
  });
  return response.status;
}

export async function runStagingPreflight({ env = process.env, fetcher = globalThis.fetch } = {}) {
  if (String(env.ZK_STAGING_PREFLIGHT_CONFIRMED || '') !== '1') {
    fail('Set ZK_STAGING_PREFLIGHT_CONFIRMED=1 to run the staging preflight', 'ZK_STAGING_PREFLIGHT_NOT_CONFIRMED');
  }
  const target = resolveStagingTarget(env);
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!serviceKey || !anonKey) fail('SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required', 'ZK_STAGING_PREFLIGHT_CONFIG_MISSING');
  if (typeof fetcher !== 'function') fail('fetch is unavailable', 'ZK_STAGING_PREFLIGHT_CONFIG_INVALID');

  const serviceStatus = await request(fetcher, target, serviceKey, serviceKey, 'zk_proofs?select=id&limit=1');
  if (serviceStatus !== 200) fail(`service_role read failed (${serviceStatus})`, 'ZK_STAGING_PREFLIGHT_SERVICE_FAILED');

  const anonStatus = await request(fetcher, target, anonKey, anonKey, 'zk_proofs?select=id&limit=1');
  if (![401, 403].includes(anonStatus)) fail(`anon read was not denied (${anonStatus})`, 'ZK_STAGING_PREFLIGHT_ANON_ALLOWED');

  let authenticatedStatus = null;
  const authenticatedJwt = String(env.ZK_STAGING_AUTHENTICATED_JWT || '').trim();
  if (authenticatedJwt) {
    authenticatedStatus = await request(fetcher, target, anonKey, authenticatedJwt, 'zk_proofs?select=id&limit=1');
    if (![401, 403].includes(authenticatedStatus)) fail(`authenticated read was not denied (${authenticatedStatus})`, 'ZK_STAGING_PREFLIGHT_AUTHENTICATED_ALLOWED');
  }

  return Object.freeze({
    environment: target.environment,
    projectRef: target.projectRef,
    serviceStatus,
    anonStatus,
    authenticatedStatus,
  });
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('zk-staging-preflight.mjs');
if (invokedDirectly) {
  runStagingPreflight()
    .then(result => {
      process.stdout.write(`[zk-staging] PASS environment=${result.environment} projectRef=${result.projectRef || 'local'}\n`);
      process.stdout.write(`[zk-staging] service_role=${result.serviceStatus} anon=${result.anonStatus}`);
      if (result.authenticatedStatus !== null) process.stdout.write(` authenticated=${result.authenticatedStatus}`);
      process.stdout.write('\n');
    })
    .catch(error => {
      process.stderr.write(`[zk-staging] BLOCKED ${error?.code || 'ZK_STAGING_PREFLIGHT_FAILED'}: ${error?.message || error}\n`);
      process.exitCode = 1;
    });
}
