export function createPracticeService({ enabled = false, apiBaseUrl = '/api', fetcher = globalThis.fetch } = {}) {
  const baseUrl = String(apiBaseUrl).replace(/\/$/, '');

  async function request(path = '', options = {}) {
    if (!enabled) throw Object.assign(new Error('Practice API is disabled'), { code: 'PRACTICE_DISABLED', status: 503 });
    const response = await fetcher(`${baseUrl}/practice${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Practice request failed'), { code: data.code || 'PRACTICE_REQUEST_FAILED', status: response.status });
    return data;
  }

  return {
    enabled,
    async getOverview(lang) {
      return request(`?lang=${encodeURIComponent(lang || 'vi')}`);
    },
    async submitAttempt({ challengeSlug, selectedOption, clientAttemptId, lang }) {
      return request('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submitAttempt',
          challengeSlug,
          selectedOption,
          clientAttemptId,
          lang: lang || 'vi',
        }),
      });
    },
  };
}
