import { composeSupportReply } from './_support-compose.js';

const LANGUAGES = new Set(['vi', 'en', 'jp']);

const MAX_BODY_CHARS = 20000;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1200;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60 * 1000;

const requestWindows = new Map();

function inputError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_INPUT' });
}

export function resolveLanguage(value) {
  return LANGUAGES.has(value) ? value : 'vi';
}

function allowRequest(req, now = Date.now()) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || 'local';
  const recent = (requestWindows.get(key) || []).filter(timestamp => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  requestWindows.set(key, recent);
  if (requestWindows.size > 1000) {
    for (const [client, timestamps] of requestWindows) {
      if (!timestamps.some(timestamp => now - timestamp < RATE_WINDOW_MS)) requestWindows.delete(client);
    }
  }
  return true;
}

/**
 * Rejects cross-site browser calls while still allowing same-origin requests and
 * server-to-server calls that do not send an Origin header.
 */
export function isAllowedOrigin(req) {
  const origin = String(req?.headers?.origin || '').trim();
  if (!origin) return true;
  const allowed = String(process.env.SUPPORT_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  const host = String(req?.headers?.host || '').trim().toLowerCase();
  try {
    const parsed = new URL(origin);
    return Boolean(host) && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-MAX_MESSAGES)
    .map(message => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: String(message?.text || message?.content || '').trim(),
    }))
    .filter(message => message.content);
}

function userMessages(messages) {
  return messages.filter(message => message.role === 'user');
}

/**
 * FAQ-only reply. There is no AI provider, prompt, token budget or upstream
 * network call in this path: retrieval and composition are local and
 * deterministic.
 */
export async function generateSupportReply(payload) {
  const language = resolveLanguage(payload?.language);
  const messages = normalizeMessages(payload?.messages);
  const users = userMessages(messages);
  if (!users.length) throw inputError('A user message is required');
  if (users.some(message => message.content.length > MAX_MESSAGE_CHARS)) {
    throw inputError(`Messages must not exceed ${MAX_MESSAGE_CHARS} characters`);
  }

  const query = users[users.length - 1].content;
  let reply = composeSupportReply({ query, language });

  // A short follow-up such as "còn cái đó thì sao" has no anchor of its own.
  // Re-run it with the previous user question, without inventing an answer.
  if (reply.status === 'not_found' && users.length > 1) {
    const combined = composeSupportReply({
      query: `${users[users.length - 2].content} ${query}`,
      language,
    });
    if (combined.status !== 'not_found') reply = combined;
  }

  return reply;
}

/**
 * Backwards-compatible string wrapper used by existing callers and tests.
 */
export async function createSupportReply(payload) {
  const reply = await generateSupportReply(payload);
  return reply.text;
}

function parseBody(req) {
  if (req.body === undefined || req.body === null || req.body === '') return {};
  if (typeof req.body === 'string') {
    if (req.body.length > MAX_BODY_CHARS) throw Object.assign(inputError('Request body is too large'), { status: 413 });
    try {
      return JSON.parse(req.body);
    } catch {
      throw inputError('Request body must be valid JSON');
    }
  }
  if (typeof req.body !== 'object') throw inputError('Request body must be a JSON object');
  return req.body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Origin not allowed', code: 'FORBIDDEN_ORIGIN' });
  }

  if (!allowRequest(req)) {
    return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
  }

  try {
    const payload = parseBody(req);
    const reply = await generateSupportReply(payload);
    return res.status(200).json(reply);
  } catch (error) {
    const status = Number(error.status) || 500;
    const code = error.code || (status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
    const message = status < 500
      ? String(error.message || 'Invalid request')
      : 'Support lookup is temporarily unavailable';
    return res.status(status).json({ error: message, code });
  }
}
