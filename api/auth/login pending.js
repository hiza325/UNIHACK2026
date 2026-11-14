import crypto from 'node:crypto';

const COOKIE = 'paradox_login_pending';
const TTL_SECONDS = 10 * 60;

function secret() {
  const value = process.env.LOGIN_PENDING_SECRET;
  if (!value || value.length < 32) throw Object.assign(new Error('LOGIN_PENDING_SECRET is not configured'), { status: 500 });
  return value;
}
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function cookieFlags(maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** Remembers "password was correct for this email" for 10 minutes, without creating a session. */
export function setPendingLogin(res, email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + TTL_SECONDS * 1000 })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; ${cookieFlags(TTL_SECONDS)}`);
}

export function clearPendingLogin(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieFlags(0)}`);
}

/** Returns the email whose password step succeeded, or null. */
export function readPendingLogin(req) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, signature] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.email && data.exp > Date.now() ? String(data.email) : null;
  } catch { return null; }
}