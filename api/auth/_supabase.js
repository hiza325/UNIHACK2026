import { emailOtpConfigured } from './_mail.js';
import { createSuspensionAppealToken } from './_suspension.js';

const ACCESS_COOKIE = 'paradox-access';
const REFRESH_COOKIE = 'paradox-refresh';
const INVALID_SESSION_MESSAGE = 'Session is invalid or has expired';
const SUSPENDED_MESSAGE = 'This account is suspended';
const AUTH_UNAVAILABLE_MESSAGE = 'Authentication service is temporarily unavailable';

const INVALID_SESSION_CODES = new Set([
  'bad_jwt', 'session_expired', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used',
]);

function invalidSessionError() {
  return Object.assign(new Error(INVALID_SESSION_MESSAGE), { status: 401, code: 'SESSION_INVALID' });
}

function authServiceUnavailable() {
  return Object.assign(new Error(AUTH_UNAVAILABLE_MESSAGE), { status: 503, code: 'AUTH_SERVICE_UNAVAILABLE' });
}

function safeUpstreamMessage(errorCode, status) {
  switch (errorCode) {
    case 'invalid_credentials': return 'Invalid email or password';
    case 'email_not_confirmed': return 'Email address is not verified';
    case 'user_banned': return SUSPENDED_MESSAGE;
    case 'email_exists':
    case 'user_already_exists': return 'This email is already registered';
    case 'weak_password': return 'Password does not meet the security requirements';
    case 'same_password': return 'New password must be different from the current password';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Too many requests. Please try again later.';
    case 'bad_jwt':
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used': return INVALID_SESSION_MESSAGE;
    default: return status >= 500 ? AUTH_UNAVAILABLE_MESSAGE : 'Authentication request failed';
  }
}

function isSuspended(user) {
  const bannedUntil = user?.banned_until ? new Date(user.banned_until) : null;
  return Boolean(bannedUntil && !Number.isNaN(bannedUntil.getTime()) && bannedUntil > new Date());
}

export function noStore(res) {
  if (!res?.setHeader) return res;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie');
  return res;
}

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
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw authServiceUnavailable();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Map upstream failures to a small, safe vocabulary. Raw GoTrue/Supabase
    // messages (which may contain token fragments or provider details) never
    // leave this function.
    if (response.status >= 500) throw authServiceUnavailable();
    const upstreamCode = String(
      data?.error_code || (typeof data?.code === 'string' ? data.code : '') || '',
    ).trim().toLowerCase();
    const hint = String(data?.msg || data?.message || data?.error_description || '');
    const error = new Error(safeUpstreamMessage(upstreamCode, response.status));
    error.status = response.status;
    error.upstreamCode = upstreamCode;
    error.banned = upstreamCode === 'user_banned'
      || (!INVALID_SESSION_CODES.has(upstreamCode) && /bann|suspend/i.test(hint));
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter;
    throw error;
  }
  return data;
}

export async function findAuthUserByEmail(email, env = process.env) {
  const normalized = String(email || '').trim().toLowerCase();
  const data = await supabaseRequest('/auth/v1/admin/users?page=1&per_page=1000', { method: 'GET', service: true, env });
  return (Array.isArray(data?.users) ? data.users : []).find(user => String(user.email || '').toLowerCase() === normalized) || null;
}

export function publicUser(user, env = process.env) {
  const config = authConfig(env);
  const email = String(user.email || '').toLowerCase();
  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0],
    email,
    role: user.app_metadata?.role === 'admin' || config.adminEmails.includes(email) ? 'admin' : 'user',
    status: isSuspended(user) ? 'suspended' : 'active',
    createdAt: user.created_at,
    verifiedAt: user.email_confirmed_at || user.confirmed_at || null,
    lastLoginAt: user.last_sign_in_at || null,
    suspensionReason: user.app_metadata?.suspension_reason || '',
    suspensionAppeal: user.app_metadata?.suspension_appeal || null,
  };
}

export function suspendedAccountError(user, env = process.env) {
  return Object.assign(new Error('This account is suspended'), {
    status: 403,
    code: 'ACCOUNT_SUSPENDED',
    suspensionReason: user.app_metadata?.suspension_reason || 'other',
    appealToken: createSuspensionAppealToken(user, env),
  });
}

async function authoritativeUser(user, env) {
  const config = authConfig(env);
  if (!user?.id) throw invalidSessionError();
  // The ban check must fail closed. Without the service role key we cannot
  // prove the account is active, so deny access instead of trusting the token.
  if (!config.serviceKey) throw authServiceUnavailable();
  let current;
  try {
    current = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'GET', service: true, env });
  } catch (error) {
    if (error.status === 404) throw invalidSessionError();
    if (error.status === 429) throw error;
    throw authServiceUnavailable();
  }
  if (!current?.id) throw invalidSessionError();
  if (isSuspended(current)) throw suspendedAccountError(current, env);
  return current;
}

// Only used after GoTrue has already rejected the token as `user_banned`, so
// the signature has been verified upstream. We read `sub` solely to attach the
// authoritative ban metadata (reason + appeal token); authorization decisions
// still come from the admin record fetched with the service key.
function tokenSubject(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return '';
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data?.sub === 'string' ? data.sub : '';
  } catch {
    return '';
  }
}

async function suspendedErrorForToken(accessToken, env) {
  const config = authConfig(env);
  const subject = tokenSubject(accessToken);
  if (config.serviceKey && subject) {
    try {
      const current = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(subject)}`, { method: 'GET', service: true, env });
      if (isSuspended(current)) return suspendedAccountError(current, env);
    } catch {
      // Fall back to the GoTrue ban signal below.
    }
  }
  return Object.assign(new Error(SUSPENDED_MESSAGE), {
    status: 403, code: 'ACCOUNT_SUSPENDED', suspensionReason: 'other',
  });
}

export async function currentUser(req, res, env = process.env) {
  authConfig(env);
  const values = cookies(req);
  let accessToken = values[ACCESS_COOKIE];
  if (accessToken) {
    let user;
    try {
      user = await supabaseRequest('/auth/v1/user', { method: 'GET', token: accessToken, env });
    } catch (error) {
      if (error.status === 403 && error.banned) throw await suspendedErrorForToken(accessToken, env);
      if (error.status === 401) {
        // Expired access tokens are refreshed below when a refresh token exists.
      } else if (error.status === 429 || !error.status || error.status >= 500) {
        throw error;
      } else {
        // 403 bad JWT (malformed or wrong signature) and any other rejection
        // are invalid sessions, never suspensions.
        throw invalidSessionError();
      }
    }
    if (user) return { user: await authoritativeUser(user, env), accessToken };
  }
  if (!values[REFRESH_COOKIE]) throw invalidSessionError();
  let refreshed;
  try {
    refreshed = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: values[REFRESH_COOKIE] }, env });
  } catch (error) {
    if (error.status === 429 || !error.status || error.status >= 500) throw error;
    throw invalidSessionError();
  }
  if (!refreshed?.access_token || !refreshed?.user) throw invalidSessionError();
  setSession(res, refreshed);
  accessToken = refreshed.access_token;
  return { user: await authoritativeUser(refreshed.user, env), accessToken };
}

export async function requireAdmin(req, res, env = process.env) {
  const session = await currentUser(req, res, env);
  if (publicUser(session.user, env).role !== 'admin') throw Object.assign(new Error('Administrator access required'), { status: 403 });
  return session;
}

export function sendError(res, error) {
  noStore(res);
  const status = Number(error.status) || 500;
  if (status === 429) res.setHeader('Retry-After', String(Number(error.retryAfter) || 60));
  const message = status >= 500
    ? AUTH_UNAVAILABLE_MESSAGE
    : error.code === 'ACCOUNT_SUSPENDED'
      ? SUSPENDED_MESSAGE
      : error.code === 'SESSION_INVALID'
        ? INVALID_SESSION_MESSAGE
        : (error.message || 'Authentication request failed');
  res.status(status).json({
    error: message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.suspensionReason ? { suspensionReason: error.suspensionReason } : {}),
    ...(error.appealToken ? { appealToken: error.appealToken } : {}),
    ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
  });
}
