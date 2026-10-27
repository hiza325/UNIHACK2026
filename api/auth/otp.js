import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

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

function createChallenge(email, code, secret, now = Date.now()) {
  const expiresAt = now + OTP_LIFETIME_MS;
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt,
    codeHash: hmac(secret, `${email}:${code}:${expiresAt}`),
  })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function verifyChallenge(email, code, challenge, secret, now = Date.now()) {
  const [payload, signature, extra] = String(challenge || '').split('.');
  if (!payload || !signature || extra || !safeEqual(signature, hmac(secret, payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.email !== email || !Number.isFinite(data.expiresAt) || data.expiresAt < now) return false;
    return safeEqual(data.codeHash, hmac(secret, `${email}:${code}:${data.expiresAt}`));
  } catch {
    return false;
  }
}

function emailCopy(language, code) {
  if (language === 'en') return {
    subject: 'Your PARADOX verification code',
    html: `<h2>Verify your PARADOX account</h2><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
  };
  if (language === 'jp') return {
    subject: 'PARADOX 認証コード',
    html: `<h2>PARADOXアカウントを認証</h2><p>認証コード：</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>このコードは10分後に期限切れになります。他人に共有しないでください。</p>`,
  };
  return {
    subject: 'Mã xác nhận tài khoản PARADOX',
    html: `<h2>Xác nhận tài khoản PARADOX</h2><p>Mã OTP của bạn là:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.</p>`,
  };
}

async function sendEmail(email, code, language, env, fetcher) {
  if (!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) return false;
  const copy = emailCopy(language, code);
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
  if (action === 'send') {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const challenge = createChallenge(email, code, secret, options.now?.() ?? Date.now());
    const delivered = await sendEmail(email, code, ['vi', 'en', 'jp'].includes(payload?.language) ? payload.language : 'vi', env, fetcher);
    if (!delivered && production) throw Object.assign(new Error('Email service is not configured'), { status: 503 });
    return { challenge, expiresIn: OTP_LIFETIME_MS / 1000, ...(delivered ? {} : { developmentCode: code }) };
  }

  if (action === 'verify') {
    const code = String(payload?.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error('Invalid verification code'), { status: 400 });
    const verified = verifyChallenge(email, code, payload?.challenge, secret, options.now?.() ?? Date.now());
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
    return res.status(200).json(await processOtpRequest(payload));
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({ error: status < 500 ? error.message : 'OTP service is temporarily unavailable' });
  }
}
