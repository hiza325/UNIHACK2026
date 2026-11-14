import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProfile, updateLocalProfile } from './_profile.js';

export const avatarError = (code, status = 503) => Object.assign(new Error(code), { code, status });
export const DEFAULT_AVATAR_BUCKET = 'profile-avatars';
const AVATAR_BUCKET_NAME = /^[a-z0-9-]+$/;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const blank = () => ({ key: null, pending: [], started: {}, retired: [], events: [] });

// Names only — never include the values of server-side secrets in logs or
// responses. AVATAR_STORAGE_BUCKET is optional because the migration and the
// documented deployment both use the same well-known private bucket.
export function avatarStorageConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(env.AVATAR_STORAGE_BUCKET || DEFAULT_AVATAR_BUCKET).trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!secret) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!AVATAR_BUCKET_NAME.test(bucket)) missing.push('AVATAR_STORAGE_BUCKET');
  if (missing.length) {
    const error = avatarError('AVATAR_NOT_CONFIGURED');
    error.missing = missing;
    throw error;
  }
  return { url, secret, bucket };
}
export function avatarOwner(source, id) {
  return source === 'local' ? createHash('sha256').update(id).digest('hex') : id;
}
export function validAvatarKey(key, owner) {
  return typeof key === 'string' && key.startsWith(`${owner}/`) && /^[0-9a-f-]+\/[0-9a-f-]{36}\.webp$/.test(key);
}

export function createAvatarStore({ source, id, env = process.env }) {
  const owner = avatarOwner(source, id);
  const check = key => { if (!validAvatarKey(key, owner)) throw avatarError('AVATAR_INVALID_KEY', 400); };
  if (source === 'local') {
    const root = env.LOCAL_AVATAR_DIR || fileURLToPath(new URL('../../.data/avatars/', import.meta.url));
    return {
      owner,
      async state() { return localProfile(id, env)?.avatar || blank(); },
      async mutate(action, key = null) {
        if (key) check(key);
        const state = localProfile(id, env)?.avatar || blank();
        if (action === 'rate') {
          state.events = state.events.filter(time => time > Date.now() - 600000);
          if (state.events.length >= 10) throw avatarError('AVATAR_RATE_LIMITED', 429);
          state.events.push(Date.now());
        } else if (action === 'enqueue') {
          state.pending = [...new Set([...state.pending, key])];
          state.started[key] = Date.now();
        }
        else if (action === 'activate') {
          if (key && (!state.pending.includes(key) || state.started[key] <= Date.now() - 600000)) throw avatarError('AVATAR_INVALID_KEY', 400);
          if (state.key && state.key !== key) state.retired = [...new Set([...state.retired, state.key])];
          state.key = key;
          state.pending = state.pending.filter(item => item !== key);
          delete state.started[key];
        } else if (action === 'expire') {
          const expired = state.pending.filter(item => state.started[item] <= Date.now() - 600000);
          state.retired = [...new Set([...state.retired, ...expired])];
          state.pending = state.pending.filter(item => !expired.includes(item));
          expired.forEach(item => { delete state.started[item]; });
        } else if (action === 'clean' && key !== state.key) {
          state.pending = state.pending.filter(item => item !== key);
          state.retired = state.retired.filter(item => item !== key);
          delete state.started[key];
        } else throw avatarError('AVATAR_INVALID_OPERATION', 400);
        updateLocalProfile(id, { avatar: state }, env);
        return state;
      },
      async put(key, bytes) { check(key); await mkdir(join(root, owner), { recursive: true }); await writeFile(join(root, key), bytes, { flag: 'wx' }); },
      async get(key) { check(key); return readFile(join(root, key)); },
      async remove(key) { check(key); try { await unlink(join(root, key)); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
    };
  }
  const { url, secret, bucket } = avatarStorageConfig(env);
  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
  // Low-level call used for the bucket probe, where a 404 means "not created
  // yet" rather than a transport failure.
  async function storageFetch(path, options = {}) {
    try { return await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000) }); }
    catch { throw avatarError('AVATAR_STORAGE_UNAVAILABLE'); }
  }
  async function request(path, options = {}) {
    const response = await storageFetch(path, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.message === 'AVATAR_RATE_LIMITED') throw avatarError('AVATAR_RATE_LIMITED', 429);
      // PostgREST reports a missing migration as a missing table/function.
      // Surface it separately so operators know to run the SQL migration
      // instead of chasing a generic storage outage.
      if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code)) throw avatarError('AVATAR_STORAGE_NOT_READY');
      const objectRead = (!options.method || options.method === 'GET') && path.startsWith('/storage/v1/object/');
      if (response.status === 404 && objectRead) throw avatarError('AVATAR_NOT_FOUND', 404);
      throw avatarError('AVATAR_STORAGE_UNAVAILABLE');
    }
    return response;
  }
  const objectPath = key => { check(key); return `/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`; };
  // The migration creates the private bucket. If a deployment skipped the SQL
  // migration (or the bucket was deleted), create it lazily with the service
  // role. Existing buckets are never made public or otherwise modified.
  let privateBucket;
  const bucketPath = `/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  async function verifyPrivateBucket() {
    let response = await storageFetch(bucketPath);
    if (response.status === 404) {
      await storageFetch('/storage/v1/bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: MAX_AVATAR_BYTES, allowed_mime_types: ['image/webp'] }),
      });
      response = await storageFetch(bucketPath);
    }
    if (!response.ok) throw avatarError('AVATAR_STORAGE_UNAVAILABLE');
    const info = await response.json().catch(() => ({}));
    if (info.public !== false) throw avatarError('AVATAR_NOT_CONFIGURED');
  }
  function ensurePrivateBucket() {
    privateBucket ||= verifyPrivateBucket().catch(error => { privateBucket = null; throw error; });
    return privateBucket;
  }
  return {
    owner,
    async state() {
      const response = await request(`/rest/v1/avatar_profiles?learner_id=eq.${encodeURIComponent(id)}&select=state`);
      return (await response.json())[0]?.state || blank();
    },
    async mutate(action, key = null) {
      if (key) check(key);
      const response = await request('/rest/v1/rpc/avatar_mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_id: id, operation: action, object_key: key }) });
      return response.json();
    },
    async put(key, bytes) { await ensurePrivateBucket(); await request(objectPath(key), { method: 'POST', headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false' }, body: bytes }); },
    async get(key) { await ensurePrivateBucket(); return Buffer.from(await (await request(objectPath(key))).arrayBuffer()); },
    async remove(key) { check(key); await request(`/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) }); },
  };
}
