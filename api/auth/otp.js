import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { emailProvider, formatSender } from './_mail.js';
import { guardOtpSend, guardOtpVerify } from './_rate-limit.js';
import { processPasswordReset } from './_password-reset.js';
import { supabaseRequest } from './_supabase.js';
import { verifySuspensionAppealToken } from './_suspension.js';

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_URL = 'https://api.resend.com/emails';

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    const error = new Error('Invalid email address');
    error.status = 400;
    throw error;
  }
  return email;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createChallenge(email, code, secret, purpose = 'signup', now = Date.now(), context = '') {
  const expiresAt = now + OTP_LIFETIME_MS;
  const payload = Buffer.from(JSON.stringify({
    email,
    purpose,
    context,
    expiresAt,
    codeHash: hmac(secret, `${email}:${code}:${expiresAt}`),
  })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function verifyChallenge(email, code, challenge, secret, purpose = 'signup', now = Date.now(), context = '') {
  const [payload, signature, extra] = String(challenge || '').split('.');
  if (!payload || !signature || extra || !safeEqual(signature, hmac(secret, payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.email !== email || data.purpose !== purpose || data.context !== context || !Number.isFinite(data.expiresAt) || data.expiresAt < now) return false;
    return safeEqual(data.codeHash, hmac(secret, `${email}:${code}:${data.expiresAt}`));
  } catch {
    return false;
  }
}

function emailCopy(language, code, purpose = 'signup') {
  if (purpose === 'password-reset') {
    if (language === 'en') return {
      subject: 'Reset your PARADOX password',
      html: `<h2>Reset your PARADOX password</h2><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
      text: `Reset your PARADOX password\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this, you can ignore this email.`,
    };
    if (language === 'jp') return {
      subject: 'PARADOX パスワード再設定コード',
      html: `<h2>PARADOXのパスワードを再設定</h2><p>認証コード：</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>このコードは10分後に期限切れになります。心当たりがない場合は、このメールを無視してください。</p>`,
      text: `PARADOXのパスワードを再設定\n\n認証コード：${code}\n\nこのコードは10分後に期限切れになります。`,
    };
    return {
      subject: 'Đặt lại mật khẩu PARADOX',
      html: `<h2>Đặt lại mật khẩu PARADOX</h2><p>Mã xác nhận của bạn là:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
      text: `Đặt lại mật khẩu PARADOX\n\nMã xác nhận của bạn là: ${code}\n\nMã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    };
  }
  if (language === 'en') return {
    subject: 'Your PARADOX verification code',
    html: `<h2>Verify your PARADOX account</h2><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
    text: `Verify your PARADOX account\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
  };
  if (language === 'jp') return {
    subject: 'PARADOX 認証コード',
    html: `<h2>PARADOXアカウントを認証</h2><p>認証コード：</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>このコードは10分後に期限切れになります。他人に共有しないでください。</p>`,
    text: `PARADOXアカウントを認証\n\n認証コード：${code}\n\nこのコードは10分後に期限切れになります。他人に共有しないでください。`,
  };
  return {
    subject: 'Mã xác nhận tài khoản PARADOX',
    html: `<h2>Xác nhận tài khoản PARADOX</h2><p>Mã OTP của bạn là:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.</p>`,
    text: `Xác nhận tài khoản PARADOX\n\nMã OTP của bạn là: ${code}\n\nMã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.`,
  };
}

async function sendEmail(email, code, language, purpose, env, fetcher, suppliedTransporter, transportFactory) {
  const copy = emailCopy(language, code, purpose);
  const provider = emailProvider(env);
  if (provider) {
    const transporter = suppliedTransporter || (transportFactory || (await import('nodemailer')).createTransport)(provider.transportOptions);
    try {
      await transporter.sendMail({
        from: formatSender(provider),
        to: email,
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
      });
    } catch (error) {
      throw Object.assign(new Error('Email delivery failed'), { status: 502, code: 'EMAIL_DELIVERY_FAILED', cause: error });
    }
    return true;
  }
  if (!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) return false;
  const response = await fetcher(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.OTP_FROM_EMAIL, to: [email], subject: copy.subject, html: copy.html }),
  });
  if (!response.ok) throw Object.assign(new Error('Email provider rejected the request'), { status: 502 });
  return true;
}

export async function processOtpRequest(payload, options = {}) {
  const env = options.env || process.env;
  const fetcher = options.fetcher || fetch;
  const production = env.NODE_ENV === 'production' || env.VERCEL === '1';
  const secret = env.OTP_SECRET || (production ? '' : 'paradox-local-development-only');
  if (!secret || (production && secret.length < 32)) throw Object.assign(new Error('OTP service is not configured'), { status: 503 });

  const action = payload?.action;
  const email = normalizeEmail(payload?.email);
  const purpose = payload?.purpose === 'password-reset' ? 'password-reset' : 'signup';
  const context = String(payload?.context || '');
  if (action === 'send') {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const challenge = createChallenge(email, code, secret, purpose, options.now?.() ?? Date.now(), context);
    const delivered = await sendEmail(email, code, ['vi', 'en', 'jp'].includes(payload?.language) ? payload.language : 'vi', payload?.purpose, env, fetcher, options.transporter, options.transportFactory);
    if (!delivered && production) throw Object.assign(new Error('Email service is not configured'), { status: 503 });
    return { challenge, expiresIn: OTP_LIFETIME_MS / 1000, ...(delivered ? {} : { developmentCode: code }) };
  }

  if (action === 'verify') {
    const code = String(payload?.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error('Invalid verification code'), { status: 400 });
    const verified = verifyChallenge(email, code, payload?.challenge, secret, purpose, options.now?.() ?? Date.now(), context);
    if (!verified) throw Object.assign(new Error('Invalid or expired verification code'), { status: 400 });
    return { verified: true };
  }

  throw Object.assign(new Error('Unknown OTP action'), { status: 400 });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = String(payload?.email || '').trim().toLowerCase();
    if (payload?.action === 'password-reset-request') {
      guardOtpSend(req, email);
      const result = await processPasswordReset({ ...payload, action: 'request' });
      return res.status(200).json({ sent: true, challenge: result.challenge });
    }
    if (payload?.action === 'password-reset-confirm') {
      guardOtpVerify(req, email);
      await processPasswordReset({ ...payload, action: 'confirm' });
      return res.status(200).json({ reset: true });
    }
    if (payload?.action === 'suspension-appeal') {
      const identity = verifySuspensionAppealToken(payload?.appealToken);
      guardOtpVerify(req, identity.email);
      const message = String(payload?.message || '').trim();
      if (message.length < 20 || message.length > 2000) return res.status(400).json({ error: 'Appeal must contain 20 to 2000 characters' });
      const user = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(identity.id)}`, { method: 'GET', service: true });
      const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
      if (String(user.email || '').toLowerCase() !== identity.email || !bannedUntil || bannedUntil <= new Date()) return res.status(409).json({ error: 'This account is not suspended' });
      await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(identity.id)}`, {
        method: 'PUT', service: true,
        body: { app_metadata: { ...(user.app_metadata || {}), suspension_appeal: { message, status: 'pending', submitted_at: new Date().toISOString() } } },
      });
      return res.status(200).json({ appealed: true });
    }
    if (payload?.action === 'send') guardOtpSend(req, email);
    else if (payload?.action === 'verify') guardOtpVerify(req, email);
    return res.status(200).json(await processOtpRequest(payload));
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status === 429) res.setHeader('Retry-After', String(Number(error.retryAfter) || 60));
    return res.status(status).json({
      error: status < 500 ? error.message : 'OTP service is temporarily unavailable',
      ...(error.code ? { code: error.code } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    });
  }
}
