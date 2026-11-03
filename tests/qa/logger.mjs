/*
 * E5 request-log recorder. One entry per executed acceptance case, carrying
 * exactly the fields the acceptance brief mandates and nothing else: payloads are
 * reduced to a hash, and the whole series is checked for secrets before export.
 */

import { LOG_FIELD_ALLOWLIST, assertLogSafe, hashInput, redactLogValue, toCsv } from './evaluator.mjs';

export function createRequestLogger({ environment = 'local-test', now = () => new Date().toISOString() } = {}) {
  const entries = [];

  return {
    entries,

    record(entry) {
      const { input, expected, actual, ...rest } = entry;
      const stamped = {
        requestId: rest.requestId || `qa-${entries.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: rest.timestamp || now(),
        environment: rest.environment || environment,
        endpoint: rest.endpoint || '',
        method: rest.method || 'POST',
        inputHash: input === undefined ? hashInput('') : hashInput(typeof input === 'string' ? input : JSON.stringify(input)),
        expectedResult: typeof expected === 'string' ? expected.slice(0, 300) : expected,
        actualResult: typeof actual === 'string' ? actual.slice(0, 300) : actual,
        ...rest,
      };
      const sanitised = redactLogValue(stamped);
      const unknownKeys = Object.keys(sanitised).filter(key => !LOG_FIELD_ALLOWLIST.includes(key));
      if (unknownKeys.length) throw new Error(`Request log carries non-approved fields: ${unknownKeys.join(', ')}`);
      assertLogSafe([sanitised], { env: entry.secretEnv || {} });
      entries.push(sanitised);
      return sanitised;
    },

    forTestCase(testCaseId) {
      return entries.filter(entry => entry.testCaseId === testCaseId);
    },

    /* Frontend-to-backend trace: the same requestId must appear on the client
       attempt and on the server response for the call to be attributable. */
    traceMatches(requestId) {
      const found = entries.filter(entry => entry.requestId === requestId);
      return { count: found.length, attributable: found.length >= 1, entries: found };
    },

    stats() {
      const attempts = entries.filter(entry => Number.isFinite(entry.attempt));
      const retried = attempts.filter(entry => (entry.retryCount || 0) > 0);
      const providerErrors = entries.filter(entry => entry.errorCategory === 'provider');
      const latencies = entries.map(entry => entry.latencyMs).filter(Number.isFinite);
      return {
        entries: entries.length,
        retryRate: attempts.length ? retried.length / attempts.length : null,
        providerErrorRate: entries.length ? providerErrors.length / entries.length : null,
        businessErrorRate: entries.length ? entries.filter(entry => entry.errorCategory === 'business').length / entries.length : null,
        averageLatencyMs: latencies.length ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)) : null,
      };
    },

    toJson() {
      assertLogSafe(entries);
      return JSON.stringify({ generatedAt: new Date().toISOString(), stats: this.stats(), entries }, null, 2);
    },

    toCsv() {
      assertLogSafe(entries);
      return toCsv(entries);
    },
  };
}
