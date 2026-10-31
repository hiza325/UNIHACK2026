/*
 * Server-only provider catalogue for the AI Learning gateway.
 * Never import this file from browser code: it describes where API keys are read.
 * Only the variable NAMES live here; actual key values come from process.env.
 *
 * Order is intentional:
 *   1. Groq        — primary (OpenAI-compatible)
 *   2. Gemini      — fallback
 *   3. AnyRouter   — last-resort fallback
 *
 * AnyRouter uses a dedicated AI Learning key so it cannot consume or expose the
 * key used by the website support widget (ANYROUTER_API_KEY).
 */

export const AI_PROVIDER_ENV = Object.freeze({
  groq: Object.freeze({ apiKey: 'GROQ_API_KEY', model: 'GROQ_MODEL' }),
  gemini: Object.freeze({ apiKey: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' }),
  anyrouter: Object.freeze({ apiKey: 'ANYROUTER_LEARNING_API_KEY', model: 'ANYROUTER_LEARNING_MODEL' }),
});

// Groq Cloud uses its own key namespace (gsk_...). A second key may be stored
// for a separate project/environment, but the gateway never auto-rotates keys
// to bypass quota.
export const GROQ_PRIMARY_API_KEY_ENV = 'GROQ_API_KEY';
export const GROQ_SECONDARY_API_KEY_ENV = 'GROQ_API_KEY_2';

// Gemini may be configured with a primary key and an optional second key for a
// separate project/environment. The gateway deliberately uses only the primary
// key; the second key is never rotated into a request to bypass quota.
export const GEMINI_PRIMARY_API_KEY_ENV = 'GEMINI_API_KEY';
export const GEMINI_SECONDARY_API_KEY_ENV = 'GEMINI_API_KEY_2';

// AnyRouter uses a dedicated AI Learning key so it cannot consume or expose the
// key used by the website support widget (ANYROUTER_API_KEY). A second learning
// key may be stored for a separate project/environment, but it is not rotated.
export const ANYROUTER_PRIMARY_API_KEY_ENV = 'ANYROUTER_LEARNING_API_KEY';
export const ANYROUTER_SECONDARY_API_KEY_ENV = 'ANYROUTER_LEARNING_API_KEY_2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANYROUTER_API_URL = 'https://anyrouter.dev/api/v1/chat/completions';

function geminiEndpoint(model) {
  return `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
}

// Groq and AnyRouter both speak the OpenAI chat-completions dialect, so they
// share one request builder and one response parser.
function openAiCompatibleRequest(url, { apiKey, model, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxOutputTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  };
}

function extractOpenAiText(data) {
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function extractOpenAiError(data) {
  return data?.error?.message || data?.message || data?.error?.code || '';
}

export const AI_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'groq',
    label: 'Groq Cloud',
    role: 'primary',
    apiKeyEnv: AI_PROVIDER_ENV.groq.apiKey,
    modelEnv: AI_PROVIDER_ENV.groq.model,
    defaultModel: 'openai/gpt-oss-120b',
    docsUrl: 'https://console.groq.com/keys',
    buildRequest(input) {
      return openAiCompatibleRequest(GROQ_API_URL, input);
    },
    extractText: extractOpenAiText,
    extractError: extractOpenAiError,
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Google Gemini',
    role: 'fallback',
    apiKeyEnv: AI_PROVIDER_ENV.gemini.apiKey,
    modelEnv: AI_PROVIDER_ENV.gemini.model,
    defaultModel: 'gemini-3.5-flash',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    buildRequest({ apiKey, model, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
      return {
        url: geminiEndpoint(model),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      };
    },
    extractText(data) {
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return '';
      return parts.map(part => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n');
    },
    extractError(data) {
      return data?.error?.message || data?.message || '';
    },
  }),
  Object.freeze({
    id: 'anyrouter',
    label: 'AnyRouter',
    role: 'fallback',
    apiKeyEnv: AI_PROVIDER_ENV.anyrouter.apiKey,
    modelEnv: AI_PROVIDER_ENV.anyrouter.model,
    defaultModel: 'anyrouter/free',
    docsUrl: 'https://docs.anyrouter.dev/api-reference/chat-completions',
    buildRequest(input) {
      return openAiCompatibleRequest(ANYROUTER_API_URL, input);
    },
    extractText: extractOpenAiText,
    extractError: extractOpenAiError,
  }),
]);

export function findAiProvider(id) {
  return AI_PROVIDERS.find(provider => provider.id === id) || null;
}
