import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localProfile, updateLocalProfile } from './_profile.js';

export const avatarError = (code, status = 503) => Object.assign(new Error(code), { code, status });
const blank = () => ({ key: null, pending: [], started: {}, retired: [], events: [] });
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
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.AVATAR_STORAGE_BUCKET;
  if (!url || !secret || !/^[a-z0-9-]+$/.test(bucket || '')) throw avatarError('AVATAR_NOT_CONFIGURED');
  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
  async function request(path, options = {}) {
    let response;
    try { response = await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000) }); }
    catch { throw avatarError('AVATAR_STORAGE_UNAVAILABLE'); }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.message === 'AVATAR_RATE_LIMITED') throw avatarError('AVATAR_RATE_LIMITED', 429);
      throw avatarError('AVATAR_STORAGE_UNAVAILABLE');
    }
    return response;
  }
  const objectPath = key => { check(key); return `/storage/v1/object/${bucket}/${key}`; };
  let privateBucket;
  async function ensurePrivateBucket() {
    privateBucket ||= request(`/storage/v1/bucket/${bucket}`).then(response => response.json());
    if ((await privateBucket).public !== false) throw avatarError('AVATAR_NOT_CONFIGURED');
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
