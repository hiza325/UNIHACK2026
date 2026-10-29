import { AI_GATEWAY_DEFAULTS, describeAiProviderStatus, resolveAiGatewaySettings } from '../_ai/gateway.js';

/**
 * Read-only provider readiness probe.
 *
 * Returns only provider ids, model ids, environment variable NAMES and
 * booleans. It never returns key values, prompts, or learner data, so it is
 * safe to call from the browser while configuring AI Learning.
 */
export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const settings = resolveAiGatewaySettings();
  const ai = describeAiProviderStatus();
  return res.status(200).json({
    ai,
    gateway: {
      timeoutMs: settings.timeoutMs,
      totalTimeoutMs: settings.totalTimeoutMs,
      maxRetries: settings.maxRetries,
      retryDelayMs: settings.retryDelayMs,
      maxRetryLimit: AI_GATEWAY_DEFAULTS.maxRetryLimit,
      validation: 'server-side JSON schema',
      fallback: ai.order.join(' -> '),
    },
  });
}
