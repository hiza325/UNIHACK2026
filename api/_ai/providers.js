/*
 * Server-only provider catalogue for the AI Learning gateway.
 * Never import this file from browser code: it describes where API keys are read.
 * Only the variable NAMES live here; actual key values come from process.env.
 *
 * Order is intentional:
 *   1. GroqCloud      — primary
 *   2. Cloudflare     — fallback
 *   3. Gemini         — optional legacy provider
 *   4. AnyRouter       — optional legacy fallback
 *
 * AI_PROVIDER_ORDER can override this order at runtime.
 */
export const AI_PROVIDER_ENV = Object.freeze({
  groq: Object.freeze({ apiKey: 'GROQ_API_KEY', model: 'GROQ_MODEL' }),
  cloudflare: Object.freeze({ apiKey: 'CLOUDFLARE_API_TOKEN', model: 'CLOUDFLARE_AI_MODEL', accountId: 'CLOUDFLARE_ACCOUNT_ID' }),
  gemini: Object.freeze({ apiKey: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' }),
  anyrouter: Object.freeze({ apiKey: 'ANYROUTER_LEARNING_API_KEY', model: 'ANYROUTER_LEARNING_MODEL' }),
});

export const GROQ_PRIMARY_API_KEY_ENV = 'GROQ_API_KEY';
export const GROQ_SECONDARY_API_KEY_ENV = 'GROQ_API_KEY_2';
export const CLOUDFLARE_ACCOUNT_ID_ENV = 'CLOUDFLARE_ACCOUNT_ID';
export const CLOUDFLARE_API_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN';
export const CLOUDFLARE_API_TOKEN_SECONDARY_ENV = 'CLOUDFLARE_API_TOKEN_2';
export const GEMINI_PRIMARY_API_KEY_ENV = 'GEMINI_API_KEY';
export const GEMINI_SECONDARY_API_KEY_ENV = 'GEMINI_API_KEY_2';
export const ANYROUTER_PRIMARY_API_KEY_ENV = 'ANYROUTER_LEARNING_API_KEY';
export const ANYROUTER_SECONDARY_API_KEY_ENV = 'ANYROUTER_LEARNING_API_KEY_2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';

function groqConfigured({ apiKey }) {
  return apiKey.length > 0;
}

function cloudflareConfigured({ apiKey, accountId }) {
  return apiKey.length > 0 && accountId.length > 0;
}

export const AI_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'groq',
    label: 'GroqCloud',
    role: 'primary',
    apiKeyEnv: AI_PROVIDER_ENV.groq.apiKey,
    modelEnv: AI_PROVIDER_ENV.groq.model,
    accountIdEnv: null,
    isConfigured: groqConfigured,
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/docs/models',
    buildRequest({ apiKey, model, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
      return {
        url: GROQ_API_URL,
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
    },
    extractText(data) {
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },
    extractError(data) {
      return data?.error?.message || data?.message || '';
    },
  }),
  Object.freeze({
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    role: 'fallback',
    apiKeyEnv: AI_PROVIDER_ENV.cloudflare.apiKey,
    modelEnv: AI_PROVIDER_ENV.cloudflare.model,
    accountIdEnv: AI_PROVIDER_ENV.cloudflare.accountId,
    isConfigured: cloudflareConfigured,
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/models/',
    buildRequest({ apiKey, model, accountId, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
      return {
        url: `${CLOUDFLARE_API_BASE}/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
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
    },
    extractText(data) {
      const content = data?.choices?.[0]?.message?.content || data?.result?.response;
      return typeof content === 'string' ? content : '';
    },
    extractError(data) {
      return data?.errors?.[0]?.message || data?.error?.message || data?.message || '';
    },
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Google Gemini',
    role: 'optional',
    apiKeyEnv: AI_PROVIDER_ENV.gemini.apiKey,
    modelEnv: AI_PROVIDER_ENV.gemini.model,
    accountIdEnv: null,
    isConfigured: groqConfigured,
    defaultModel: 'gemini-3.5-flash',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    buildRequest({ apiKey, model, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
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
    role: 'optional',
    apiKeyEnv: AI_PROVIDER_ENV.anyrouter.apiKey,
    modelEnv: AI_PROVIDER_ENV.anyrouter.model,
    accountIdEnv: null,
    isConfigured: groqConfigured,
    defaultModel: 'anyrouter/free',
    docsUrl: 'https://docs.anyrouter.dev/api-reference/chat-completions',
    buildRequest({ apiKey, model, systemPrompt, userPrompt, temperature, maxOutputTokens, json }) {
      return {
        url: 'https://anyrouter.dev/api/v1/chat/completions',
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
    },
    extractText(data) {
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },
    extractError(data) {
      return data?.error?.message || data?.message || data?.error?.code || '';
    },
  }),
]);

export function findAiProvider(id) {
  return AI_PROVIDERS.find(provider => provider.id === id) || null;
}