import { SUPPORT_AI_CONFIG } from './support-ai-config.js';

// The support endpoint is a local FAQ lookup, so it should answer quickly; the
// allowance covers a cold serverless start without waiting on an AI provider.
const REQUEST_TIMEOUT_MS = 20000;
const MAX_MESSAGE_CHARS = 1200;

function normalizedMessages(messages) {
  return messages.slice(-SUPPORT_AI_CONFIG.maxHistory).map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: String(item.text || ''),
  }));
}

function supportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
    try {
      data = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (response.ok) throw supportError('Support response was interrupted or invalid', 'INTERRUPTED_RESPONSE');
      data = {};
    }

    if (!response.ok) {
      const fallbackCode = response.status === 429
        ? 'RATE_LIMITED'
        : response.status === 400
          ? 'INVALID_INPUT'
          : response.status === 504
            ? 'TIMEOUT'
            : 'UNAVAILABLE';
      throw supportError(data?.error || `Support lookup returned ${response.status}`, data?.code || fallbackCode);
    }

    const text = data.text || data.reply || data.message;
    if (!text) throw supportError('Support lookup returned no text', 'EMPTY_RESPONSE');

    return {
      text: String(text),
      status: data.status || 'answered',
      answers: asArray(data.answers),
      unmatched: asArray(data.unmatched),
      outOfScope: asArray(data.outOfScope),
      candidates: asArray(data.candidates),
      notes: asArray(data.notes),
      notice: typeof data.notice === 'string' ? data.notice : null,
      sources: asArray(data.sources),
      suggestions: asArray(data.suggestions),
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw supportError('Support lookup timed out', 'TIMEOUT');
    if (error?.code) throw error;
    throw supportError('Support lookup is unreachable', 'NETWORK_ERROR');
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
  throw supportError('Support lookup is not configured', 'NOT_CONFIGURED');
}
