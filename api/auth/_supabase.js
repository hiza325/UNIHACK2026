import { emailOtpConfigured } from './_mail.js';

const ACCESS_COOKIE = 'paradox-access';
const REFRESH_COOKIE = 'paradox-refresh';

export function authConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !anonKey) throw Object.assign(new Error('Authentication service is not configured'), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
  return { url, anonKey, serviceKey, adminEmails: String(env.ADMIN_EMAILS || 'admin@paradox.ai,huyclasswiz@gmail.com,huyriuuu@gmail.com,lamnguyen080306@gmail.com').split(',').map(email => email.trim().toLowerCase()).filter(Boolean) };
}

// Deprecated alias kept for callers that used the Gmail-only helper. It now
// covers both generic SMTP and Gmail App Password delivery.
export function gmailOtpConfigured(env = process.env) {
  return emailOtpConfigured(env);
}

export function parseBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function normalizeCredentials(body, includeName = false) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error('Invalid email address'), { status: 400 });
  if (password.length < 8 || password.length > 128) throw Object.assign(new Error('Password must contain 8 to 128 characters'), { status: 400 });
  const result = { email, password };
  if (includeName) {
    result.name = String(body.name || '').trim().slice(0, 80);
    if (!result.name) throw Object.assign(new Error('Name is required'), { status: 400 });
  }
  return result;
}

function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2));
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function setSession(res, session) {
  if (!session?.access_token || !session?.refresh_token) return;
  res.setHeader('Set-Cookie', [cookie(ACCESS_COOKIE, session.access_token, Number(session.expires_in) || 3600), cookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30)]);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)]);
}

export async function supabaseRequest(path, { method = 'POST', body, token, service = false, env = process.env } = {}) {
  const config = authConfig(env);
  const key = service ? config.serviceKey : config.anonKey;
  if (service && !key) throw Object.assign(new Error('Admin service is not configured'), { status: 503, code: 'ADMIN_NOT_CONFIGURED' });
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || data.error_description || 'Authentication request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function publicUser(user, env = process.env) {
  const config = authConfig(env);
  const email = String(user.email || '').toLowerCase();
  const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0],
    email,
    role: user.app_metadata?.role === 'admin' || config.adminEmails.includes(email) ? 'admin' : 'user',
    status: bannedUntil && bannedUntil > new Date() ? 'suspended' : 'active',
    createdAt: user.created_at,
    verifiedAt: user.email_confirmed_at || user.confirmed_at || null,
    lastLoginAt: user.last_sign_in_at || null,
  };
}

export async function currentUser(req, res, env = process.env) {
  authConfig(env);
  const values = cookies(req);
  let accessToken = values[ACCESS_COOKIE];
  if (accessToken) {
    try { return { user: await supabaseRequest('/auth/v1/user', { method: 'GET', token: accessToken, env }), accessToken }; }
    catch (error) { if (![401, 403].includes(error.status)) throw error; }
  }
  if (!values[REFRESH_COOKIE]) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const refreshed = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: values[REFRESH_COOKIE] }, env });
  setSession(res, refreshed);
  accessToken = refreshed.access_token;
  return { user: refreshed.user, accessToken };
}

export async function requireAdmin(req, res, env = process.env) {
  const session = await currentUser(req, res, env);
  if (publicUser(session.user, env).role !== 'admin') throw Object.assign(new Error('Administrator access required'), { status: 403 });
  return session;
}

export function sendError(res, error) {
  const status = Number(error.status) || 500;
  res.status(status).json({ error: status >= 500 ? 'Authentication service is temporarily unavailable' : error.message, ...(error.code ? { code: error.code } : {}) });
}
