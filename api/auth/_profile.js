import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function profileName(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw Object.assign(new Error('Name must contain 1–80 characters'), { status: 400, code: 'INVALID_PROFILE_NAME' });
  }
  return name;
}

function profilePath(email, env) {
  const directory = env.LOCAL_PROFILE_DIR || fileURLToPath(new URL('../../.data/profiles/', import.meta.url));
  return { directory, file: join(directory, `${createHash('sha256').update(email).digest('hex')}.json`) };
}

export function localProfile(email, env = process.env) {
  try { return JSON.parse(readFileSync(profilePath(email, env).file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function saveLocalProfile(email, name, env = process.env) {
  return updateLocalProfile(email, { name }, env);
}

export function updateLocalProfile(email, fields, env = process.env) {
  const { directory, file } = profilePath(email, env);
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...localProfile(email, env), ...fields }), 'utf8');
  renameSync(temporary, file);
}
