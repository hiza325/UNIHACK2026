#!/usr/bin/env node
/**
 * Local-only RLS smoke test for public.zk_proofs.
 *
 * Refuses non-local Supabase URLs. Never prints keys. Never writes production
 * data. Apply the migration to a LOCAL Supabase instance before running:
 *
 *   ZK_RLS_SUPABASE_URL=http://127.0.0.1:54321 \
 *   ZK_RLS_ANON_KEY=<local anon key> \
 *   ZK_RLS_AUTHENTICATED_JWT=<local signed-in test JWT> \
 *   ZK_RLS_SERVICE_ROLE_KEY=<local service role key> \
 *   node scripts/zk-rls-smoke.mjs
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ZK_RLS_SUPABASE_URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ZK_RLS_SUPABASE_URL must be HTTP(S)');
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Refusing non-local Supabase URL; this script is local-only');
  }
  return url.origin;
}

async function request(baseUrl, key, jwt, path, init = {}) {
  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
      ...(init.headers || {}),
    },
  });
}

async function expectDenied(label, baseUrl, key, jwt, path, init) {
  let response;
  try {
    response = await request(baseUrl, key, jwt, path, init);
  } catch {
    fail(`${label}: request failed`);
    return;
  }
  if (response.ok) {
    fail(`${label}: unexpectedly allowed (${response.status})`);
    return;
  }
  if (![401, 403].includes(response.status)) {
    fail(`${label}: expected 401/403, got ${response.status}`);
    return;
  }
  console.log(`PASS: ${label} denied (${response.status})`);
}

async function main() {
  const baseUrl = localBaseUrl(requireEnv('ZK_RLS_SUPABASE_URL'));
  const anon = requireEnv('ZK_RLS_ANON_KEY');
  const authenticated = requireEnv('ZK_RLS_AUTHENTICATED_JWT');
  const service = requireEnv('ZK_RLS_SERVICE_ROLE_KEY');

  const serviceRead = await request(baseUrl, service, service, 'zk_proofs?select=id&limit=1');
  if (!serviceRead.ok) {
    fail(`service_role read failed (${serviceRead.status}); is the local migration applied?`);
  } else {
    console.log('PASS: service_role can read zk_proofs');
  }

  await expectDenied('anon select', baseUrl, anon, anon, 'zk_proofs?select=id&limit=1', { method: 'GET' });
  await expectDenied('authenticated select', baseUrl, anon, authenticated, 'zk_proofs?select=id&limit=1', { method: 'GET' });
  await expectDenied('anon insert', baseUrl, anon, anon, 'zk_proofs', { method: 'POST', body: '{}' });
  await expectDenied('authenticated insert', baseUrl, anon, authenticated, 'zk_proofs', { method: 'POST', body: '{}' });
  await expectDenied('anon update', baseUrl, anon, anon, 'zk_proofs?id=eq.00000000-0000-4000-8000-000000000000', { method: 'PATCH', body: '{"status":"revoked"}' });
  await expectDenied('authenticated update', baseUrl, anon, authenticated, 'zk_proofs?id=eq.00000000-0000-4000-8000-000000000000', { method: 'PATCH', body: '{"status":"revoked"}' });
  await expectDenied('anon delete', baseUrl, anon, anon, 'zk_proofs?id=eq.00000000-0000-4000-8000-000000000000', { method: 'DELETE' });
  await expectDenied('authenticated delete', baseUrl, anon, authenticated, 'zk_proofs?id=eq.00000000-0000-4000-8000-000000000000', { method: 'DELETE' });

  if (process.exitCode) {
    console.error('RLS smoke: FAILED');
  } else {
    console.log('RLS smoke: PASSED');
  }
}

main().catch(error => {
  console.error(`RLS smoke: ${error.message}`);
  process.exitCode = 1;
});
