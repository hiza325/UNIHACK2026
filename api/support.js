import { SUPPORT_PROMPT } from '../support-prompt.js';

const ANYROUTER_URL = 'https://anyrouter.dev/api/v1/chat/completions';
const DEFAULT_MODEL = 'anyrouter/free';
const LANGUAGES = new Set(['vi', 'en', 'jp']);

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-10).map(message => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.text || message?.content || '').trim().slice(0, 1200),
  })).filter(message => message.content);
}

export async function createAnyRouterSupportReply(payload, options = {}) {
  const apiKey = options.apiKey || process.env.ANYROUTER_API_KEY;
  if (!apiKey) {
    const error = new Error('ANYROUTER_API_KEY is not configured');
    error.status = 503;
    throw error;
  }

  const messages = normalizeMessages(payload?.messages);
  if (!messages.length) {
    const error = new Error('A message is required');
    error.status = 400;
    throw error;
  }

  const language = LANGUAGES.has(payload?.language) ? payload.language : 'vi';
  const currentView = String(payload?.currentView || 'landing').slice(0, 40);
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(ANYROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || process.env.ANYROUTER_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: `${SUPPORT_PROMPT}\nInterface language: ${language}. Current view: ${currentView}.` },
        ...messages,
      ],
      temperature: 0.25,
      max_tokens: 350,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `AnyRouter returned ${response.status}`);
    error.status = 502;
    throw error;
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const error = new Error('AnyRouter returned no text');
    error.status = 502;
    throw error;
  }
  return text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const text = await createAnyRouterSupportReply(payload);
    return res.status(200).json({ text });
  } catch (error) {
    const status = Number(error.status) || 500;
    const message = status === 400 ? error.message : 'Support AI is temporarily unavailable';
    return res.status(status).json({ error: message });
  }
}
