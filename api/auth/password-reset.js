import { randomInt } from 'node:crypto';
import { emailOtpConfigured } from './_mail.js';
import { guardOtpSend, guardOtpVerify } from './_rate-limit.js';
import { createChallenge, processOtpRequest } from './otp.js';
import { parseBody, sendError, supabaseRequest } from './_supabase.js';

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error('Invalid email address'), { status: 400 });
  }
  return email;
}

function normalizePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) {
    throw Object.assign(new Error('Password must contain 8 to 128 characters'), { status: 400 });
  }
  return password;
}

async function findConfirmedUser(email, request, env) {
  const data = await request('/auth/v1/admin/users?page=1&per_page=1000', { method: 'GET', service: true, env });
  const user = (Array.isArray(data?.users) ? data.users : []).find(item => String(item.email || '').toLowerCase() === email);
  return user && (user.email_confirmed_at || user.confirmed_at) ? user : null;
}

export async function processPasswordReset(payload, options = {}) {
  const env = options.env || process.env;
  const request = options.request || supabaseRequest;
  const email = normalizeEmail(payload?.email);
  const action = payload?.action;

  if (action === 'request') {
    if (!emailOtpConfigured(env)) throw Object.assign(new Error('Email service is not configured'), { status: 503 });
    const user = await findConfirmedUser(email, request, env);
    // Always return the same public shape so this endpoint cannot be used to
    // discover which email addresses have accounts.
    if (!user) {
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      return { sent: true, challenge: createChallenge(email, code, env.OTP_SECRET, 'password-reset', Date.now(), new Date().toISOString()) };
    }
    const otp = await processOtpRequest(
      { action: 'send', email, language: payload.language, purpose: 'password-reset', context: String(user.updated_at || '') },
      { env, ...(options.otpOptions || {}) },
    );
    return { sent: true, challenge: otp.challenge, ...(otp.developmentCode ? { developmentCode: otp.developmentCode } : {}) };
  }

  if (action === 'confirm') {
    const password = normalizePassword(payload?.password);
    const user = await findConfirmedUser(email, request, env);
    if (!user) throw Object.assign(new Error('Invalid or expired verification code'), { status: 400 });
    await processOtpRequest(
      {
        action: 'verify', email, code: payload?.code, challenge: payload?.challenge,
        purpose: 'password-reset', context: String(user.updated_at || ''),
      },
      { env, ...(options.otpOptions || {}) },
    );
    await request(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT', body: { password }, service: true, env,
    });
    return { reset: true };
  }

  throw Object.assign(new Error('Unknown password reset action'), { status: 400 });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (body.action === 'request') guardOtpSend(req, email);
    else if (body.action === 'confirm') guardOtpVerify(req, email);
    const result = await processPasswordReset(body);
    return res.status(200).json({
      ...(body.action === 'request' ? { sent: true, challenge: result.challenge } : { reset: true }),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
