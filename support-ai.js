import { SUPPORT_AI_CONFIG } from './support-ai-config.js';

// Backend total deadline is 45s; allow transport/JSON parsing to finish too.
const REQUEST_TIMEOUT_MS = 50000;
const MAX_MESSAGE_CHARS = 1200;

function normalizedMessages(messages) {
  return messages.slice(-SUPPORT_AI_CONFIG.maxHistory).map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    // Bound historical context only; never truncate the displayed reply or user question.
    text: item.role === 'assistant' ? String(item.text || '').slice(0, MAX_MESSAGE_CHARS) : String(item.text || ''),
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
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (response.ok) throw supportError('Support response was interrupted or invalid', 'INTERRUPTED_RESPONSE');
      data = {}; // Preserve HTTP rate-limit/timeout classification for proxy HTML errors.
    }
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
    return { text: String(text), status: data.status || (data.degraded ? 'degraded' : 'incomplete'), code: data.code,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [] };
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
  if (history.some(item => item.role === 'user' && item.text.length > MAX_MESSAGE_CHARS)) {
    throw supportError('Message is too long', 'INVALID_INPUT');
  }
  if (SUPPORT_AI_CONFIG.proxyUrl) return requestProxy(history, language, currentView);
  throw supportError('Support AI is not configured', 'NOT_CONFIGURED');
}
