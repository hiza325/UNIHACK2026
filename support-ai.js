import { SUPPORT_AI_CONFIG } from './support-ai-config.js';

function normalizedMessages(messages) {
  return messages.slice(-SUPPORT_AI_CONFIG.maxHistory).map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    text: String(item.text || '').slice(0, 1200),
  }));
}

async function requestProxy(messages, language, currentView) {
  const response = await fetch(SUPPORT_AI_CONFIG.proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, language, currentView }),
  });
  if (!response.ok) throw new Error(`Support proxy returned ${response.status}`);
  const data = await response.json();
  const text = data.text || data.reply || data.message;
  if (!text) throw new Error('Support proxy returned no text');
  return String(text);
}

export async function requestSupportReply(messages, language, currentView) {
  const history = normalizedMessages(messages);
  if (SUPPORT_AI_CONFIG.proxyUrl) return requestProxy(history, language, currentView);
  const error = new Error('Support AI is not configured');
  error.code = 'NOT_CONFIGURED';
  throw error;
}
