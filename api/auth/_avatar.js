import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { noStore, parseBody } from './_supabase.js';
import { avatarError, createAvatarStore } from './_avatar-store.js';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export async function normalizeAvatar(body) {
  const types = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!types[body?.mime] || typeof body?.image !== 'string') throw avatarError('AVATAR_INVALID_TYPE', 415);
  if (body.image.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4) throw avatarError('AVATAR_TOO_LARGE', 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || body.image.length % 4) throw avatarError('AVATAR_INVALID_IMAGE', 400);
  const bytes = Buffer.from(body.image, 'base64');
  if (bytes.length > MAX_AVATAR_BYTES) throw avatarError('AVATAR_TOO_LARGE', 413);
  try {
    const image = sharp(bytes, { limitInputPixels: 25000000, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== types[body.mime] || (metadata.pages || 1) !== 1) throw new Error('Unsupported image');
    return await image.rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch { throw avatarError('AVATAR_INVALID_IMAGE', 400); }
}

// Uploads are registered before writing. Retired objects remain in a durable
// cleanup queue until deletion succeeds. Never delete the current object.
export async function cleanupAvatars(store) {
  let state;
  try { state = await store.mutate('expire'); } catch { return true; }
  let deferred = false;
  for (const key of state.retired) {
    if (key === state.key) continue;
    try { await store.remove(key); await store.mutate('clean', key); }
    catch { deferred = true; }
  }
  return deferred;
}

// Serialize local/in-instance changes. Database mutations are independently
// row-locked across remote instances. Upload leases expire after ten minutes;
// expired pending keys can no longer be activated and are safe to clean up.
const queues = new Map();
async function exclusive(owner, run) {
  const previous = queues.get(owner) || Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  queues.set(owner, current);
  try { return await current; } finally { if (queues.get(owner) === current) queues.delete(owner); }
}

export async function avatarHandler(req, res, identity, env = process.env) {
  noStore(res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const store = createAvatarStore({ ...identity, env });
    const base = identity.source === 'local' ? '/api/auth/local' : '/api/auth/session';
    const summary = state => ({ avatarUrl: state.key ? `${base}?avatar=image&v=${encodeURIComponent(state.key.split('/')[1])}` : null, cleanupPending: state.retired.length > 0 });
    if (req.method === 'GET') {
      const state = await store.state();
      if (req.query?.avatar !== 'image') return res.status(200).json(summary(state));
      if (!state.key) return res.status(404).json({ code: 'AVATAR_NOT_FOUND' });
      const bytes = await store.get(state.key);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.status(200).send(bytes);
    }
    if (!['POST', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    }
    // Same-origin browser writes only. Authentication remains mandatory for
    // non-browser clients that do not send Origin / Sec-Fetch-Site.
    if (req.headers?.['sec-fetch-site'] === 'cross-site') throw avatarError('AVATAR_FORBIDDEN', 403);
    const origin = req.headers?.origin;
    if (origin) {
      let originHost;
      try { originHost = new URL(origin).host; } catch { throw avatarError('AVATAR_FORBIDDEN', 403); }
      if (originHost !== req.headers?.host) throw avatarError('AVATAR_FORBIDDEN', 403);
    }
    return await exclusive(`${identity.source}:${store.owner}`, async () => {
      await store.mutate('rate');
      let next = null;
      if (req.method === 'POST') {
        let body;
        try { body = parseBody(req); } catch { throw avatarError('AVATAR_INVALID_IMAGE', 400); }
        const bytes = await normalizeAvatar(body);
        next = `${store.owner}/${randomUUID()}.webp`;
        await store.mutate('enqueue', next);
        try { await store.put(next, bytes); }
        catch (error) {
          try { await store.remove(next); await store.mutate('clean', next); } catch { /* Durable pending key remains for maintenance. */ }
          throw error;
        }
      }
      const state = await store.mutate('activate', next);
      const cleanupPending = await cleanupAvatars(store);
      return res.status(200).json({ ...summary(state), cleanupPending });
    });
  } catch (error) {
    if (error.status === 429) res.setHeader('Retry-After', '600');
    if (error.code === 'ENOENT') return res.status(404).json({ code: 'AVATAR_NOT_FOUND' });
    // Safe operational hint for server logs: variable names only, never values.
    if (error.code === 'AVATAR_NOT_CONFIGURED' && error.missing?.length) {
      console.warn(`Avatar storage is not configured; missing environment variables: ${error.missing.join(', ')}`);
    }
    // Never return raw filesystem/upstream error codes to the browser.
    const status = Number(error.status) || 503;
    const code = /^AVATAR_[A-Z_]+$/.test(String(error.code || '')) ? error.code : 'AVATAR_STORAGE_UNAVAILABLE';
    return res.status(status).json({ code, error: 'Avatar request could not be completed' });
  }
}
