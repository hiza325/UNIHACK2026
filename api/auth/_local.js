import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { noStore, parseBody } from './_supabase.js';
import { localProfile, profileName, saveLocalProfile } from './_profile.js';
import { avatarHandler } from './_avatar.js';

/*
 * Server-side "enter locally" sign-in for development machines only.
 *
 * This module is intentionally not a route of its own: the Vercel Hobby plan
 * caps a deployment at 12 serverless functions, so api/auth/session.js
 * delegates to it for /api/auth/local (see vercel.json and isLocalAuthRequest).
 *
 * Availability is decided entirely by the server: the endpoint exists in every
 * deployment but refuses to issue a session unless it is NOT production
 * (no VERCEL, NODE_ENV !== 'production') AND LOCAL_AUTH_ENABLED=1 is set
 * explicitly. There is no URL parameter, client flag, or request header that
 * can enable it. The issued account is always role "user" — never an
 * administrator — and it is not a Supabase user, so it cannot reach data
 * owned by real accounts.
 */

const LOCAL_COOKIE = 'paradox-local';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCAL_AUTH_ERROR = 'Local authentication is not configured';
const LOCAL_AUTH_CODE = 'LOCAL_AUTH_NOT_CONFIGURED';
const DEV_SECRET = 'paradox-local-development-only';

function production(env) {
  return env.VERCEL === '1' || env.NODE_ENV === 'production';
}

export function localAuthConfig(env = process.env) {
  if (production(env)) return null;
  if (String(env.LOCAL_AUTH_ENABLED || '').trim() !== '1') return null;
  const email = String(env.LOCAL_AUTH_EMAIL || 'local@paradox.test').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = String(env.LOCAL_AUTH_NAME || 'Local user').trim().slice(0, 80) || 'Local user';
  const secret = String(env.LOCAL_AUTH_SECRET || DEV_SECRET);
  return { email, name, secret };
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function issueToken(config, timestampMs = Date.now()) {
  const session = { sub: 'local', email: config.email, name: config.name, role: 'user', iat: timestampMs, exp: timestampMs + SESSION_TTL_SECONDS * 1000, jti: randomUUID() };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return { session, token: `${payload}.${hmac(config.secret, payload)}` };
}

function verifyToken(token, config, timestampMs = Date.now()) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || !safeEqual(signature, hmac(config.secret, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'local' || !Number.isFinite(data.exp) || data.exp < timestampMs) return null;
    return data;
  } catch {
    return null;
  }
}

function publicLocalUser(data, env = process.env) {
  return {
    id: `local-${data.jti}`,
    name: localProfile(data.email, env)?.name || data.name || 'Local user',
    email: data.email,
    role: 'user',
    status: 'active',
    createdAt: null,
    verifiedAt: null,
    lastLoginAt: new Date(data.iat).toISOString(),
  };
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function requestCookie(req) {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCAL_COOKIE && rest.length) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function isLocalAuthRequest(req) {
  if (req?.query?.localAuth === '1' || req?.query?.localAuth === 1) return true;
  const host = String(req?.headers?.host || 'localhost');
  try {
    const url = new URL(String(req?.url || '/'), `http://${host}`);
    if (url.searchParams.get('localAuth') === '1') return true;
    return url.pathname === '/api/auth/local';
  } catch {
    return false;
  }
}

export function createLocalAuthHandler({ env = process.env, now = Date.now } = {}) {
  return function handler(req, res) {
    noStore(res);
    const config = localAuthConfig(env);
    if (req.query?.avatar) {
      const session = config && verifyToken(requestCookie(req), config, now());
      if (!session) return res.status(401).json({ code: 'SESSION_INVALID', error: 'Session is invalid or has expired' });
      return avatarHandler(req, res, { source: 'local', id: session.email }, env);
    }
    if (req.method === 'GET') {
      if (!config) return res.status(200).json({ available: false });
      const session = verifyToken(requestCookie(req), config, now());
      return res.status(200).json({ available: true, ...(session ? { user: publicLocalUser(session, env) } : {}) });
    }
    if (!config) {
      res.setHeader('Allow', 'GET');
      return res.status(403).json({ error: LOCAL_AUTH_ERROR, code: LOCAL_AUTH_CODE });
    }
    if (req.method === 'POST') {
      const { session, token } = issueToken(config, now());
      res.setHeader('Set-Cookie', cookie(LOCAL_COOKIE, token, SESSION_TTL_SECONDS));
      return res.status(200).json({ user: publicLocalUser(session, env) });
    }
    if (req.method === 'PATCH') {
      const session = verifyToken(requestCookie(req), config, now());
      if (!session) return res.status(401).json({ error: 'Session is invalid or has expired', code: 'SESSION_INVALID' });
      try {
        saveLocalProfile(session.email, profileName(parseBody(req)), env);
        return res.status(200).json({ user: publicLocalUser(session, env) });
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Profile could not be saved' });
      }
    }
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', cookie(LOCAL_COOKIE, '', 0));
      return res.status(200).json({ loggedOut: true });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  };
}

export function localSessionForRequest(req, env = process.env, now = Date.now) {
  const config = localAuthConfig(env);
  if (!config) return null;
  const session = verifyToken(requestCookie(req), config, now());
  if (!session) return null;
  return { user: publicLocalUser(session, env), learnerId: `local:${session.email}` };
}

export default createLocalAuthHandler();
