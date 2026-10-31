/*
 * Shared server-only AI gateway for AI Learning.
 *
 * Responsibilities:
 * - resolve provider order (Groq primary, Gemini fallback, AnyRouter last resort,
 *   optional AI_PROVIDER_ORDER override);
 * - read API keys from environment variables only and never expose them downstream;
 * - enforce a per-attempt timeout and a bounded total deadline;
 * - retry retryable failures (timeouts, network errors, 408/425/429/5xx, empty or invalid output);
 * - fall back to the next configured provider after retries are exhausted or the failure is fatal;
 * - validate the returned payload through a caller-supplied validator before accepting it;
 * - return normalised provenance metadata and redact secrets from every error surface.
 */

import { AI_PROVIDERS, findAiProvider, GROQ_PRIMARY_API_KEY_ENV, GROQ_SECONDARY_API_KEY_ENV, GEMINI_PRIMARY_API_KEY_ENV, GEMINI_SECONDARY_API_KEY_ENV, ANYROUTER_PRIMARY_API_KEY_ENV, ANYROUTER_SECONDARY_API_KEY_ENV } from './providers.js';

export const AI_GATEWAY_DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  totalTimeoutMs: 30000,
  maxRetries: 1,
  retryDelayMs: 300,
  maxRetryLimit: 3,
  maxDelayMs: 1500,
});

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SECRET_PATTERNS = [
  [/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [redacted]'],
  [/\bAIza[0-9A-Za-z\-_]{20,}/g, '[redacted]'],
  [/\bgsk_[A-Za-z0-9]{10,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9\-_]{10,}/g, '[redacted]'],
  [/\bds-[A-Za-z0-9\-_]{10,}/g, '[redacted]'],
];

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultDiagnosticLogger(env) {
  return env?.VERCEL === '1' || env?.NODE_ENV === 'production' ? console : null;
}

function logGatewayDiagnostic(logger, event, details = {}) {
  if (!logger) return;
  const write = typeof logger.warn === 'function' ? logger.warn : logger.log;
  if (typeof write !== 'function') return;
  try {
    write.call(logger, { event, ...details });
  } catch {
    // Diagnostics must never interrupt an AI request.
  }
}

function toInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function redact(text, env) {
  let output = String(text == null ? '' : text);
  for (const provider of AI_PROVIDERS) {
    const value = String(env?.[provider.apiKeyEnv] || '').trim();
    if (value.length >= 8) output = output.split(value).join('[redacted]');
  }
  for (const keyName of Object.keys(env || {})) {
    if (/^(GROQ_API_KEY|GEMINI_API_KEY|ANYROUTER_LEARNING_API_KEY)(?:_\d+)?$/.test(keyName)) {
      const value = String(env?.[keyName] || '').trim();
      if (value.length >= 8) output = output.split(value).join('[redacted]');
    }
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) output = output.replace(pattern, replacement);
  return output.slice(0, 600);
}

function gatewayError(code, message, { status = 502, details, retryable = false } = {}) {
  const error = new Error(message);
  error.name = 'AiGatewayError';
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  if (details) error.details = details;
  return error;
}

function attemptFailure(message, { code = 'UPSTREAM_ERROR', status = 502, retryable = true, httpStatus } = {}) {
  const error = gatewayError(code, message, { status, retryable });
  if (httpStatus) error.httpStatus = httpStatus;
  return error;
}

function readProviderOrder(env) {
  const configured = String(env?.AI_PROVIDER_ORDER || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(configured)].filter(id => Boolean(findAiProvider(id)));
  return unique.length ? unique : null;
}

export function resolveAiProviders({ env = process.env, providers = AI_PROVIDERS, providerOrder } = {}) {
  const requested = (providerOrder && providerOrder.length ? providerOrder : null)
    || readProviderOrder(env)
    || providers.map(provider => provider.id);
  const seen = new Set();
  return requested
    .map(id => providers.find(provider => provider.id === id))
    .filter(provider => {
      if (!provider || seen.has(provider.id)) return false;
      seen.add(provider.id);
      return true;
    })
    .map(provider => {
      const apiKey = String(env?.[provider.apiKeyEnv] || '').trim();
      const model = String(env?.[provider.modelEnv] || '').trim() || provider.defaultModel;
      return { provider, apiKey, model, configured: apiKey.length > 0 };
    });
}

function describeEntry(entry) {
  return {
    id: entry.provider.id,
    label: entry.provider.label,
    role: entry.provider.role,
    configured: entry.configured,
    model: entry.model,
    requiredEnv: entry.provider.apiKeyEnv,
    modelEnv: entry.provider.modelEnv,
  };
}

/**
 * Safe, secret-free readiness snapshot. Only variable names and booleans are
 * returned so it can power a health endpoint and operator diagnostics.
 */
export function describeAiProviderStatus({ env = process.env, providers = AI_PROVIDERS, providerOrder } = {}) {
  const entries = resolveAiProviders({ env, providers, providerOrder });
  const described = entries.map(describeEntry);
  const [primary] = described;
  const fallback = described.length > 1 ? described[described.length - 1] : null;
  const groqKeysConfigured = Object.keys(env || {}).filter(name => /^GROQ_API_KEY(?:_\d+)?$/.test(name) && String(env?.[name] || '').trim().length > 0).length;
  const geminiKeysConfigured = Object.keys(env || {}).filter(name => /^GEMINI_API_KEY(?:_\d+)?$/.test(name) && String(env?.[name] || '').trim().length > 0).length;
  const anyrouterKeysConfigured = Object.keys(env || {}).filter(name => /^ANYROUTER_LEARNING_API_KEY(?:_\d+)?$/.test(name) && String(env?.[name] || '').trim().length > 0).length;
  return {
    ready: entries.some(entry => entry.configured),
    order: entries.map(entry => entry.provider.id),
    primary: primary || null,
    fallback,
    providers: described,
    configured: entries.filter(entry => entry.configured).map(entry => entry.provider.id),
    missingEnv: entries.filter(entry => !entry.configured).map(entry => entry.provider.apiKeyEnv),
    groqKeys: {
      activeEnv: GROQ_PRIMARY_API_KEY_ENV,
      configuredCount: groqKeysConfigured,
      backupEnv: GROQ_SECONDARY_API_KEY_ENV,
      backupConfigured: groqKeysConfigured > 1,
    },
    groqKeyCount: groqKeysConfigured,
    groqBackupKeyConfigured: groqKeysConfigured > 1,
    geminiKeys: {
      activeEnv: GEMINI_PRIMARY_API_KEY_ENV,
      configuredCount: geminiKeysConfigured,
      backupEnv: GEMINI_SECONDARY_API_KEY_ENV,
      backupConfigured: geminiKeysConfigured > 1,
    },
    geminiKeyCount: geminiKeysConfigured,
    geminiBackupKeyConfigured: geminiKeysConfigured > 1,
    anyrouterKeys: {
      activeEnv: ANYROUTER_PRIMARY_API_KEY_ENV,
      configuredCount: anyrouterKeysConfigured,
      backupEnv: ANYROUTER_SECONDARY_API_KEY_ENV,
      backupConfigured: anyrouterKeysConfigured > 1,
    },
    anyrouterKeyCount: anyrouterKeysConfigured,
    anyrouterBackupKeyConfigured: anyrouterKeysConfigured > 1,
  };
}

export function resolveAiGatewaySettings({ env = process.env, timeoutMs, totalTimeoutMs, maxRetries, retryDelayMs } = {}) {
  return Object.freeze({
    timeoutMs: toInteger(timeoutMs ?? env?.AI_PROVIDER_TIMEOUT_MS, AI_GATEWAY_DEFAULTS.timeoutMs, 100, 60000),
    totalTimeoutMs: toInteger(totalTimeoutMs ?? env?.AI_TOTAL_TIMEOUT_MS, AI_GATEWAY_DEFAULTS.totalTimeoutMs, 100, 120000),
    maxRetries: toInteger(maxRetries ?? env?.AI_MAX_RETRIES, AI_GATEWAY_DEFAULTS.maxRetries, 0, AI_GATEWAY_DEFAULTS.maxRetryLimit),
    retryDelayMs: toInteger(retryDelayMs ?? env?.AI_RETRY_DELAY_MS, AI_GATEWAY_DEFAULTS.retryDelayMs, 0, 5000),
  });
}

export function createAiGateway({
  env = process.env,
  fetcher = globalThis.fetch,
  providers = AI_PROVIDERS,
  providerOrder,
  timeoutMs,
  totalTimeoutMs,
  maxRetries,
  retryDelayMs,
  sleep = defaultSleep,
  now = Date.now,
  logger,
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('AI gateway requires a fetch implementation');
  const entries = resolveAiProviders({ env, providers, providerOrder });
  const settings = resolveAiGatewaySettings({ env, timeoutMs, totalTimeoutMs, maxRetries, retryDelayMs });
  const maxAttemptsPerProvider = settings.maxRetries + 1;
  const diagnosticLogger = logger === undefined ? defaultDiagnosticLogger(env) : logger;

  const status = () => describeAiProviderStatus({ env, providers, providerOrder });

  async function requestFromProvider(entry, { systemPrompt, userPrompt, temperature, maxOutputTokens, json, attemptTimeoutMs }) {
    const request = entry.provider.buildRequest({
      apiKey: entry.apiKey,
      model: entry.model,
      systemPrompt,
      userPrompt,
      temperature,
      maxOutputTokens,
      json,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetcher(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const data = typeof response?.json === 'function' ? await response.json().catch(() => ({})) : {};
      if (!response?.ok) {
        const retryable = RETRYABLE_HTTP_STATUSES.has(Number(response?.status));
        const detail = entry.provider.extractError(data) || `${entry.provider.label} returned HTTP ${response?.status}`;
        throw attemptFailure(detail, {
          code: Number(response?.status) === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
          status: retryable ? 503 : 502,
          retryable,
          httpStatus: Number(response?.status),
        });
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function classifyFailure(error, entry) {
    if (error?.name === 'AbortError') {
      return gatewayError('TIMEOUT', `${entry.provider.label} timed out`, { status: 504, retryable: true });
    }
    if (error?.code === 'INVALID_OUTPUT') {
      return gatewayError('INVALID_OUTPUT', redact(error.message || 'AI output failed validation', env), {
        status: 502,
        retryable: true,
        details: { provider: entry.provider.id },
      });
    }
    if (error?.code === 'EMPTY_RESPONSE') {
      return gatewayError('EMPTY_RESPONSE', `${entry.provider.label} returned no text`, { status: 502, retryable: true });
    }
    if (error?.name === 'AiGatewayError') {
      return gatewayError(error.code, redact(error.message, env), {
        status: error.status,
        retryable: error.retryable,
        details: { provider: entry.provider.id, httpStatus: error.httpStatus || null },
      });
    }
    if (error instanceof TypeError) {
      return gatewayError('NETWORK_ERROR', `${entry.provider.label} is unreachable`, { status: 503, retryable: true });
    }
    if (error instanceof SyntaxError) {
      return gatewayError('INVALID_OUTPUT', `${entry.provider.label} returned malformed JSON`, { status: 502, retryable: true });
    }
    return gatewayError('UPSTREAM_ERROR', redact(error?.message || `${entry.provider.label} failed`, env), {
      status: 502,
      retryable: Number(error?.httpStatus) ? RETRYABLE_HTTP_STATUSES.has(Number(error.httpStatus)) : true,
    });
  }

  function aggregateFailure(failures, trace) {
    const codes = trace.filter(item => item.attempt > 0).map(item => item.code);
    const onlyTimeouts = codes.length > 0 && codes.every(code => code === 'TIMEOUT');
    const onlyInvalid = codes.length > 0 && codes.every(code => code === 'INVALID_OUTPUT' || code === 'EMPTY_RESPONSE');
    const onlyRateLimited = codes.length > 0 && codes.every(code => code === 'RATE_LIMITED');
    const code = onlyTimeouts ? 'TIMEOUT' : onlyInvalid ? 'INVALID_OUTPUT' : onlyRateLimited ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
    const status = code === 'TIMEOUT' ? 504 : code === 'RATE_LIMITED' ? 503 : 502;
    const message = code === 'TIMEOUT'
      ? 'AI providers timed out'
      : code === 'RATE_LIMITED'
        ? 'AI providers are rate limited'
        : code === 'INVALID_OUTPUT'
          ? 'AI output failed validation'
          : 'AI providers are temporarily unavailable';
    const last = failures[failures.length - 1];
    return gatewayError(code, message, {
      status,
      details: {
        providers: describeAiProviderStatus({ env, providers, providerOrder }),
        attempts: trace,
        lastError: last ? redact(last.message, env) : null,
      },
    });
  }

  async function complete({ systemPrompt, userPrompt, temperature = 0.1, maxOutputTokens = 2200, json = true, validate } = {}) {
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) throw new TypeError('systemPrompt is required');
    if (typeof userPrompt !== 'string' || !userPrompt.trim()) throw new TypeError('userPrompt is required');
    if (!entries.some(entry => entry.configured)) {
      logGatewayDiagnostic(diagnosticLogger, 'ai_gateway_not_configured', {
        providers: entries.map(entry => ({ provider: entry.provider.id, configured: entry.configured })),
      });
      throw gatewayError('NOT_CONFIGURED', 'No AI provider is configured', { status: 503, details: status() });
    }

    const startedAt = now();
    const deadline = startedAt + settings.totalTimeoutMs;
    const trace = [];
    const failures = [];

    for (const entry of entries) {
      if (!entry.configured) {
        trace.push({
          provider: entry.provider.id,
          model: entry.model,
          attempt: 0,
          code: 'NOT_CONFIGURED',
          retryable: false,
          durationMs: 0,
        });
        continue;
      }

      for (let attempt = 1; attempt <= maxAttemptsPerProvider; attempt += 1) {
        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
          const exhausted = gatewayError('TIMEOUT', 'AI gateway deadline exceeded', { status: 504, retryable: false });
          failures.push(exhausted);
          trace.push({
            provider: entry.provider.id,
            model: entry.model,
            attempt,
            code: 'TIMEOUT',
            retryable: false,
            durationMs: 0,
          });
          break;
        }

        const attemptStartedAt = now();
        try {
          const data = await requestFromProvider(entry, {
            systemPrompt,
            userPrompt,
            temperature,
            maxOutputTokens,
            json,
            attemptTimeoutMs: Math.min(settings.timeoutMs, remainingMs),
          });
          const text = String(entry.provider.extractText(data) || '').trim();
          if (!text) throw gatewayError('EMPTY_RESPONSE', 'Provider returned no text', { status: 502, retryable: true });
          const value = typeof validate === 'function' ? await validate(text) : text;
          trace.push({
            provider: entry.provider.id,
            model: entry.model,
            attempt,
            code: 'OK',
            retryable: false,
            durationMs: now() - attemptStartedAt,
          });
          return {
            value,
            text,
            provider: entry.provider.id,
            model: entry.model,
            providerModel: `${entry.provider.id}/${entry.model}`,
            attempts: trace.filter(item => item.attempt > 0).length,
            retryCount: trace.filter(item => item.attempt > 0).length - 1,
            latencyMs: now() - startedAt,
            fallbackUsed: trace.some(item => item.attempt > 0 && item.provider !== entry.provider.id),
            trace,
          };
        } catch (error) {
          const failure = classifyFailure(error, entry);
          failures.push(failure);
          const attemptTrace = {
            provider: entry.provider.id,
            model: entry.model,
            attempt,
            code: failure.code,
            retryable: failure.retryable,
            durationMs: now() - attemptStartedAt,
          };
          trace.push(attemptTrace);
          logGatewayDiagnostic(diagnosticLogger, 'ai_gateway_attempt_failed', {
            ...attemptTrace,
            model: redact(attemptTrace.model, env),
            upstreamStatus: Number(failure.details?.httpStatus) || null,
          });
          if (!failure.retryable || attempt >= maxAttemptsPerProvider) break;
          const delay = Math.min(settings.retryDelayMs * 2 ** (attempt - 1), AI_GATEWAY_DEFAULTS.maxDelayMs);
          if (delay > 0) await sleep(delay);
        }
      }
    }

    const aggregate = aggregateFailure(failures, trace);
    logGatewayDiagnostic(diagnosticLogger, 'ai_gateway_failed', {
      code: aggregate.code,
      status: aggregate.status,
      durationMs: now() - startedAt,
      attempts: trace.map(item => ({
        provider: item.provider,
        model: redact(item.model, env),
        attempt: item.attempt,
        code: item.code,
        retryable: item.retryable,
        durationMs: item.durationMs,
      })),
    });
    throw aggregate;
  }

  return Object.freeze({
    complete,
    status,
    config: settings,
    providers: Object.freeze(entries.map(entry => Object.freeze(describeEntry(entry)))),
  });
}
