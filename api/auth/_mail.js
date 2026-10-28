const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE = /^(1|true|yes|on)$/i;
const FALSE = /^(0|false|no|off)$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/i;
const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL', 'SMTP_FROM_NAME'];

function configurationError(message) {
  return Object.assign(new Error(message), { status: 503, code: 'EMAIL_NOT_CONFIGURED' });
}

function parseBoolean(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const normalized = String(value).trim();
  if (TRUE.test(normalized)) return true;
  if (FALSE.test(normalized)) return false;
  throw configurationError(`${field} must be true or false`);
}

function cleanName(value) {
  return String(value || '').replace(/["\\<>\r\n]/g, '').trim();
}

function addressOnly(value) {
  const raw = String(value || '').trim();
  return (raw.match(/<([^<>]+)>/)?.[1] || raw).trim();
}

function safeAddress(value, field) {
  const address = addressOnly(value);
  if (!EMAIL.test(address) || address.length > 254 || /[\r\n]/.test(address)) {
    throw configurationError(`${field} must be a valid email address`);
  }
  return address;
}

export function gmailSettings(env = process.env) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  const user = safeAddress(env.GMAIL_USER, 'GMAIL_USER');
  return {
    type: 'gmail',
    transportOptions: {
      service: 'gmail',
      auth: { user, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') },
    },
    fromEmail: user,
    fromName: cleanName(env.GMAIL_FROM_NAME) || 'PARADOX AI',
  };
}

export function smtpSettings(env = process.env) {
  const configured = SMTP_KEYS.some(key => String(env[key] ?? '').trim() !== '');
  if (!configured) return null;

  const host = String(env.SMTP_HOST || '').trim();
  if (!host || /[\s/:]/.test(host)) throw configurationError('SMTP_HOST must be a hostname without a protocol or path');

  const rawPort = String(env.SMTP_PORT ?? '').trim();
  const port = rawPort ? Number(rawPort) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw configurationError('SMTP_PORT must be an integer between 1 and 65535');

  const secureSetting = parseBoolean(env.SMTP_SECURE, 'SMTP_SECURE');
  const secure = secureSetting === null ? port === 465 : secureSetting;

  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  if ((user && !pass) || (!user && pass)) throw configurationError('SMTP_USER and SMTP_PASS must be configured together');
  if (user && /[\r\n]/.test(user)) throw configurationError('SMTP_USER contains invalid characters');

  const fallbackFrom = EMAIL.test(user) ? user : '';
  const fromEmail = safeAddress(env.SMTP_FROM_EMAIL || fallbackFrom || env.OTP_FROM_EMAIL, 'SMTP_FROM_EMAIL');
  const fromName = cleanName(env.SMTP_FROM_NAME || env.GMAIL_FROM_NAME) || 'PARADOX AI';

  const requireTlsSetting = parseBoolean(env.SMTP_REQUIRE_TLS, 'SMTP_REQUIRE_TLS');
  const requireTls = requireTlsSetting === null ? !secure && !LOCAL_HOST.test(host) : requireTlsSetting;
  if (secure && requireTls) throw configurationError('SMTP_REQUIRE_TLS cannot be true when SMTP_SECURE is true');

  return {
    type: 'smtp',
    transportOptions: {
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
      requireTLS: requireTls,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
    fromEmail,
    fromName,
  };
}

export function emailProvider(env = process.env) {
  return smtpSettings(env) || gmailSettings(env);
}

export function emailOtpConfigured(env = process.env) {
  const provider = emailProvider(env);
  return Boolean(provider && env.OTP_SECRET && String(env.OTP_SECRET).length >= 32);
}

export function formatSender(provider) {
  const name = cleanName(provider?.fromName);
  return name ? `"${name}" <${provider.fromEmail}>` : provider.fromEmail;
}
