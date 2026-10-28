import { createHash } from 'node:crypto';

// In-memory sliding windows. Serverless instances keep their own counters, so a
// cold start resets them; the limits are still enough to stop a single client
// from spamming the SMTP provider from one warm instance.
const buckets = new Map();
const cooldowns = new Map();
const MAX_ENTRIES = 5000;
const COOLDOWN_TTL_MS = 24 * 60 * 60 * 1000;

function readNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const number = Number(raw);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

export function rateLimitSettings(env = process.env) {
  return {
    disabled: readBoolean(env.RATE_LIMIT_DISABLED),
    sendCooldownMs: readNumber(env.OTP_SEND_COOLDOWN_SECONDS, 60, { max: 86_400 }) * 1000,
    sendWindowMs: readNumber(env.OTP_SEND_WINDOW_MINUTES, 60, { min: 1, max: 1440 }) * 60 * 1000,
    sendEmailLimit: readNumber(env.OTP_SEND_EMAIL_LIMIT, 5, { min: 1, max: 10_000 }),
    sendIpLimit: readNumber(env.OTP_SEND_IP_LIMIT, 20, { min: 1, max: 100_000 }),
    verifyWindowMs: readNumber(env.OTP_VERIFY_WINDOW_MINUTES, 15, { min: 1, max: 1440 }) * 60 * 1000,
    verifyEmailLimit: readNumber(env.OTP_VERIFY_EMAIL_LIMIT, 10, { min: 1, max: 10_000 }),
    verifyIpLimit: readNumber(env.OTP_VERIFY_IP_LIMIT, 50, { min: 1, max: 100_000 }),
  };
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('base64url').slice(0, 24);
}

export function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req?.headers?.['x-real-ip'] || '').trim();
  const socketIp = String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '').trim();
  const address = forwarded || realIp || socketIp || 'unknown';
  return address.replace(/^::ffff:/i, '').slice(0, 64);
}

function prune(now) {
  if (buckets.size <= MAX_ENTRIES && cooldowns.size <= MAX_ENTRIES) return;
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
  for (const [key, seenAt] of cooldowns) if (now - seenAt > COOLDOWN_TTL_MS) cooldowns.delete(key);
  while (buckets.size > MAX_ENTRIES) buckets.delete(buckets.keys().next().value);
  while (cooldowns.size > MAX_ENTRIES) cooldowns.delete(cooldowns.keys().next().value);
}

function consume(key, limit, windowMs, now) {
  if (limit <= 0 || windowMs <= 0) return { allowed: true, retryAfterMs: 0 };
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= limit) return { allowed: false, retryAfterMs: Math.max(1, entry.resetAt - now) };
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

function waitForCooldown(key, windowMs, now) {
  if (windowMs <= 0) return 0;
  const seenAt = cooldowns.get(key);
  if (seenAt !== undefined && now - seenAt < windowMs) return Math.max(1, windowMs - (now - seenAt));
  cooldowns.set(key, now);
  return 0;
}

export function rateLimitError(retryAfterMs) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Object.assign(new Error('Too many requests. Please try again later.'), {
    status: 429,
    code: 'RATE_LIMITED',
    retryAfter,
  });
}

export function guardOtpSend(req, email, options = {}) {
  const env = options.env || process.env;
  const settings = rateLimitSettings(env);
  if (settings.disabled) return;
  const now = options.now ?? Date.now();
  const ip = clientIp(req);
  const wait = waitForCooldown(`cooldown:send:${digest(email)}`, settings.sendCooldownMs, now);
  if (wait) throw rateLimitError(wait);
  const checks = [
    [`send:email:${digest(email)}`, settings.sendEmailLimit, settings.sendWindowMs],
    [`send:ip:${digest(ip)}`, settings.sendIpLimit, settings.sendWindowMs],
  ];
  for (const [key, limit, windowMs] of checks) {
    const result = consume(key, limit, windowMs, now);
    if (!result.allowed) throw rateLimitError(result.retryAfterMs);
  }
  prune(now);
}

export function guardOtpVerify(req, email, options = {}) {
  const env = options.env || process.env;
  const settings = rateLimitSettings(env);
  if (settings.disabled) return;
  const now = options.now ?? Date.now();
  const ip = clientIp(req);
  const checks = [
    [`verify:email:${digest(email)}`, settings.verifyEmailLimit, settings.verifyWindowMs],
    [`verify:ip:${digest(ip)}`, settings.verifyIpLimit, settings.verifyWindowMs],
  ];
  for (const [key, limit, windowMs] of checks) {
    const result = consume(key, limit, windowMs, now);
    if (!result.allowed) throw rateLimitError(result.retryAfterMs);
  }
  prune(now);
}

export function resetRateLimitState() {
  buckets.clear();
  cooldowns.clear();
}
