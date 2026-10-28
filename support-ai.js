import { SUPPORT_AI_CONFIG } from './support-ai-config.js';

const REQUEST_TIMEOUT_MS = 25000;
const MAX_MESSAGE_CHARS = 1200;

function normalizedMessages(messages) {
  return messages.slice(-SUPPORT_AI_CONFIG.maxHistory).map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: String(item.text || '').slice(0, MAX_MESSAGE_CHARS),
  }));
}

function supportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function requestProxy(messages, language, currentView) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SUPPORT_AI_CONFIG.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, language, currentView }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fallbackCode = response.status === 429
        ? 'RATE_LIMITED'
        : response.status === 400
          ? 'INVALID_INPUT'
          : response.status === 504
            ? 'TIMEOUT'
            : 'UNAVAILABLE';
      throw supportError(data?.error || `Support proxy returned ${response.status}`, data?.code || fallbackCode);
    }
    const text = data.text || data.reply || data.message;
    if (!text) throw supportError('Support proxy returned no text', 'EMPTY_RESPONSE');
    return { text: String(text), suggestions: Array.isArray(data.suggestions) ? data.suggestions : [] };
  } catch (error) {
    if (error?.name === 'AbortError') throw supportError('Support proxy timed out', 'TIMEOUT');
    if (error?.code) throw error;
    throw supportError('Support proxy is unreachable', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

export async function requestSupportReply(messages, language, currentView) {
  const history = normalizedMessages(messages);
  if (SUPPORT_AI_CONFIG.proxyUrl) return requestProxy(history, language, currentView);
  throw supportError('Support AI is not configured', 'NOT_CONFIGURED');
}
