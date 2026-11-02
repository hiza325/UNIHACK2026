/*
 * Deployment-shape guards.
 *
 * Vercel's Hobby plan rejects a deployment that contains more than 12
 * serverless functions ("No more than 12 Serverless Functions can be added to
 * a Deployment on the Hobby plan"). The repository already hit that ceiling
 * once, in commit 77b443b, which folded api/ai/status.js into api/debate.js.
 * These tests keep the count visible and prove that the public paths the app
 * calls are still reachable through vercel.json rewrites.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import sessionHandler from '../api/auth/session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOBBY_FUNCTION_LIMIT = 12;

// Vercel turns every file under api/ into a function unless a path segment
// starts with "_" (helpers such as api/_ai/* or api/auth/_local.js).
async function listServerlessFunctions(directory = path.join(root, 'api')) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await listServerlessFunctions(absolute));
    } else if (entry.name.endsWith('.js')) {
      found.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return found;
}

test('the deployment stays within the 12-function Hobby limit', async () => {
  const functions = await listServerlessFunctions();
  expect(functions.length, `serverless functions: ${functions.join(', ')}`).toBeLessThanOrEqual(HOBBY_FUNCTION_LIMIT);
  // The public routes the browser calls must still exist somewhere in the list.
  expect(functions).toEqual(expect.arrayContaining([
    'api/debate.js',
    'api/support.js',
    'api/auth/session.js',
    'api/auth/login.js',
    'api/admin/users.js',
    'api/credentials/index.js',
    'api/learning-records/index.js',
  ]));
  // A local-auth file that is a route of its own would exceed the limit again.
  expect(functions).not.toContain('api/auth/local.js');
});

test('vercel.json routes every public path that has no function of its own', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const routes = new Map((config.rewrites || []).map(rule => [rule.source, rule.destination]));
  expect(routes.get('/api/ai/status')).toBe('/api/debate?aiStatus=1');
  expect(routes.get('/api/auth/local')).toBe('/api/auth/session?localAuth=1');
});

test('the session endpoint serves /api/auth/local through the local-auth handler', async () => {
  // Pin the switch: this test proves routing, not that local sign-in is on.
  process.env.VERCEL = '';
  process.env.NODE_ENV = 'test';
  process.env.LOCAL_AUTH_ENABLED = '';

  const makeRes = () => ({
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });

  // GET is answered even when local sign-in is switched off, which the plain
  // session endpoint never does: it would need a Supabase session instead.
  const status = makeRes();
  await sessionHandler({ method: 'GET', url: '/api/auth/local', headers: { host: 'localhost' }, query: {} }, status);
  expect(status.statusCode).toBe(200);
  expect(status.payload).toEqual({ available: false });
  expect(status.headers['Cache-Control']).toMatch(/no-store/);
  expect(status.headers['Set-Cookie']).toBeUndefined();

  const blocked = makeRes();
  await sessionHandler({ method: 'POST', url: '/api/auth/local', headers: { host: 'localhost' }, query: {} }, blocked);
  expect(blocked.statusCode).toBe(403);
  expect(blocked.payload.code).toBe('LOCAL_AUTH_NOT_CONFIGURED');
  expect(blocked.headers['Set-Cookie']).toBeUndefined();

  // The rewrite marker alone is enough: Vercel may report the rewritten path.
  const rewritten = makeRes();
  await sessionHandler({ method: 'GET', url: '/api/auth/session?localAuth=1', headers: { host: 'localhost' }, query: { localAuth: '1' } }, rewritten);
  expect(rewritten.payload).toEqual({ available: false });
});
