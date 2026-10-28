import { createHmac, timingSafeEqual } from 'node:crypto';

const APPEAL_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function secret(env) {
  const value = env.OTP_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!value) throw Object.assign(new Error('Suspension appeal service is not configured'), { status: 503 });
  return value;
}

function sign(value, env) {
  return createHmac('sha256', secret(env)).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSuspensionAppealToken(user, env = process.env, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: String(user.email || '').toLowerCase(),
    expiresAt: now + APPEAL_TOKEN_LIFETIME_MS,
  })).toString('base64url');
  return `${payload}.${sign(payload, env)}`;
}

export function verifySuspensionAppealToken(token, env = process.env, now = Date.now()) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, env))) {
    throw Object.assign(new Error('Invalid suspension appeal token'), { status: 403 });
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.email || !Number.isFinite(data.expiresAt) || data.expiresAt < now) throw new Error();
    return data;
  } catch {
    throw Object.assign(new Error('Invalid or expired suspension appeal token'), { status: 403 });
  }
}
