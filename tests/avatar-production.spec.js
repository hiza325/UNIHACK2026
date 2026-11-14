import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { avatarHandler } from '../api/auth/_avatar.js';
import { createAvatarStore, avatarStorageConfig, DEFAULT_AVATAR_BUCKET } from '../api/auth/_avatar-store.js';

// Exercises the Supabase branch of the avatar pipeline without contacting a
// real project. The fake implements only the PostgREST/Storage endpoints used
// by api/auth/_avatar-store.js and deliberately enforces the service-role
// header so the test proves the server-side credential path.
test.describe.configure({ mode: 'serial' });

let server;
let base;
let env;
let png;
let migrationsApplied;
const buckets = new Map();
const objects = new Map();
const profiles = new Map();

const SERVICE_KEY = 'test-service-role-key';
const blank = () => ({ key: null, pending: [], started: {}, retired: [], events: [] });

function stateFor(id) {
  if (!profiles.has(id)) profiles.set(id, blank());
  return profiles.get(id);
}

function mutate(owner, operation, key = null) {
  const state = stateFor(owner);
  const now = Date.now();
  if (operation === 'rate') {
    state.events = state.events.filter(time => time > now - 600000);
    if (state.events.length >= 10) return { error: 'AVATAR_RATE_LIMITED' };
    state.events.push(now);
  } else if (operation === 'enqueue' && key) {
    if (!state.pending.includes(key)) state.pending.push(key);
    state.started[key] = now;
  } else if (operation === 'activate') {
    if (key && (!state.pending.includes(key) || !(state.started[key] > now - 600000))) return { error: 'AVATAR_INVALID_KEY' };
    if (state.key && state.key !== key) state.retired = [...new Set([...state.retired, state.key])];
    state.key = key || null;
    if (key) {
      state.pending = state.pending.filter(item => item !== key);
      delete state.started[key];
    }
  } else if (operation === 'expire') {
    for (const item of [...state.pending]) {
      if (state.started[item] > now - 600000) continue;
      state.retired = [...new Set([...state.retired, item])];
      state.pending = state.pending.filter(entry => entry !== item);
      delete state.started[item];
    }
  } else if (operation === 'clean' && key !== state.key) {
    state.pending = state.pending.filter(item => item !== key);
    state.retired = state.retired.filter(item => item !== key);
    delete state.started[key];
  } else {
    return { error: 'AVATAR_INVALID_OPERATION' };
  }
  return { state };
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function authorized(req) {
  return req.headers.apikey === SERVICE_KEY && req.headers.authorization === `Bearer ${SERVICE_KEY}`;
}

test.beforeAll(async () => {
  png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#573491' } }).png().toBuffer();
  server = createServer(async (req, res) => {
    try {
      if (!authorized(req)) return json(res, 401, { message: 'Missing service role' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;

      if (path.startsWith('/storage/v1/bucket')) {
        const id = decodeURIComponent(path.slice('/storage/v1/bucket/'.length));
        if (req.method === 'GET') {
          if (!buckets.has(id)) return json(res, 404, { error: 'not_found', message: 'Bucket not found' });
          return json(res, 200, { id, name: id, public: buckets.get(id).public });
        }
        if (req.method === 'POST') {
          const payload = JSON.parse((await body(req)).toString('utf8'));
          if (!buckets.has(payload.id)) buckets.set(payload.id, { public: payload.public === true });
          return json(res, 200, { name: payload.id });
        }
      }

      if (path.startsWith('/storage/v1/object/')) {
        const rest = path.slice('/storage/v1/object/'.length);
        const slash = rest.indexOf('/');
        if (req.method === 'GET') {
          const key = decodeURIComponent(rest.slice(slash + 1));
          if (!objects.has(key)) return json(res, 404, { error: 'not_found', message: 'Object not found' });
          res.writeHead(200, { 'Content-Type': 'image/webp' });
          return res.end(objects.get(key));
        }
        if (req.method === 'POST') {
          const key = decodeURIComponent(rest.slice(slash + 1));
          if (objects.has(key)) return json(res, 400, { message: 'The resource already exists' });
          objects.set(key, await body(req));
          return json(res, 200, { Key: key });
        }
        if (req.method === 'DELETE') {
          const payload = JSON.parse((await body(req)).toString('utf8'));
          for (const key of payload.prefixes || []) objects.delete(key);
          return json(res, 200, []);
        }
      }

      if (path === '/rest/v1/avatar_profiles' && req.method === 'GET') {
        if (!migrationsApplied) return json(res, 404, { code: 'PGRST205', message: 'Could not find the table public.avatar_profiles' });
        const id = url.searchParams.get('learner_id')?.replace(/^eq\./, '');
        return json(res, 200, profiles.has(id) ? [{ state: profiles.get(id) }] : []);
      }

      if (path === '/rest/v1/rpc/avatar_mutate' && req.method === 'POST') {
        if (!migrationsApplied) return json(res, 404, { code: 'PGRST202', message: 'Could not find the function public.avatar_mutate' });
        const payload = JSON.parse((await body(req)).toString('utf8'));
        const result = mutate(payload.owner_id, payload.operation, payload.object_key);
        if (result.error) return json(res, 400, { code: 'P0001', message: result.error });
        return json(res, 200, result.state);
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      return json(res, 500, { message: error.message });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  env = { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

function response() {
  const headers = {};
  let statusCode = 200;
  let payload;
  const res = {
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; return res; },
    status(code) { statusCode = code; return res; },
    json(value) { payload = value; return res; },
    send(value) { payload = value; return res; },
  };
  return { res, read: () => ({ statusCode, headers, payload }) };
}

async function call(method, id, { body: requestBody, avatar } = {}) {
  const { res, read } = response();
  await avatarHandler({
    method,
    headers: { origin: base, host: new URL(base).host },
    body: requestBody === undefined ? undefined : (typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)),
    query: avatar ? { avatar } : {},
  }, res, { source: 'supabase', id }, env);
  return read();
}

test.beforeEach(() => {
  migrationsApplied = true;
  buckets.clear();
  objects.clear();
  profiles.clear();
});

test('defaults to the migration bucket and completes upload, display, replace and removal', async () => {
  expect(avatarStorageConfig(env).bucket).toBe(DEFAULT_AVATAR_BUCKET);
  const owner = randomUUID();
  const other = randomUUID();

  const saved = await call('POST', owner, { body: { mime: 'image/png', image: png.toString('base64') } });
  expect(saved.statusCode).toBe(200);
  expect(saved.payload.avatarUrl).toMatch(/^\/api\/auth\/session\?avatar=image&v=[0-9a-f-]+\.webp$/);
  expect(buckets.get(DEFAULT_AVATAR_BUCKET)).toEqual({ public: false });

  const firstKey = `${owner}/${saved.payload.avatarUrl.split('v=')[1]}`;
  expect(objects.has(firstKey)).toBe(true);
  const meta = await call('GET', owner, { avatar: 'meta' });
  expect(meta.payload).toMatchObject({ avatarUrl: saved.payload.avatarUrl, cleanupPending: false });

  const image = await call('GET', owner, { avatar: 'image' });
  expect(image.statusCode).toBe(200);
  expect(image.headers['content-type']).toBe('image/webp');
  expect(await sharp(image.payload).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 });

  expect((await call('GET', other, { avatar: 'meta' })).payload.avatarUrl).toBeNull();
  expect((await call('GET', other, { avatar: 'image' })).statusCode).toBe(404);

  const replaced = await call('POST', owner, { body: { mime: 'image/png', image: png.toString('base64') } });
  expect(replaced.statusCode).toBe(200);
  expect(replaced.payload.avatarUrl).not.toBe(saved.payload.avatarUrl);
  expect(objects.has(firstKey)).toBe(false);

  const removed = await call('DELETE', owner);
  expect(removed.payload).toMatchObject({ avatarUrl: null, cleanupPending: false });
  expect(objects.size).toBe(0);
  expect((await call('GET', owner, { avatar: 'image' })).statusCode).toBe(404);
});

test('missing credentials and missing migration produce actionable error codes', async () => {
  const owner = randomUUID();
  expect(() => createAvatarStore({ source: 'supabase', id: owner, env: {} })).toThrow();
  try { createAvatarStore({ source: 'supabase', id: owner, env: {} }); }
  catch (error) {
    expect(error.code).toBe('AVATAR_NOT_CONFIGURED');
    expect(error.missing).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  }

  migrationsApplied = false;
  const notReady = await call('POST', owner, { body: { mime: 'image/png', image: png.toString('base64') } });
  expect(notReady.statusCode).toBe(503);
  expect(notReady.payload.code).toBe('AVATAR_STORAGE_NOT_READY');
});

test('a public bucket is rejected instead of exposing avatar images', async () => {
  buckets.set(DEFAULT_AVATAR_BUCKET, { public: true });
  const owner = randomUUID();
  const store = createAvatarStore({ source: 'supabase', id: owner, env });
  await expect(store.put(`${owner}/${randomUUID()}.webp`, png)).rejects.toMatchObject({ code: 'AVATAR_NOT_CONFIGURED' });
});
