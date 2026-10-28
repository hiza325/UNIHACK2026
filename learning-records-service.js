function serviceError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

export function createLearningRecordsService({ enabled = false, apiBaseUrl = '/api', fetcher = globalThis.fetch } = {}) {
  const baseUrl = String(apiBaseUrl).replace(/\/$/, '');

  async function request(path = '', options = {}) {
    if (!enabled) throw serviceError('Learning record API is disabled', 'LEARNING_RECORDS_DISABLED', 503);
    const response = await fetcher(`${baseUrl}/learning-records${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw serviceError(data.error || 'Learning record request failed', data.code || 'LEARNING_RECORD_REQUEST_FAILED', response.status);
    return data;
  }

  function post(body) {
    return request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  return {
    enabled,
    async createSession(payload) {
      return post({ action: 'createSession', ...payload });
    },
    async createSubmission(sessionId, solution) {
      const data = await post({ action: 'createSubmission', sessionId, solution });
      return data.submission;
    },
    async abandonSession(sessionId) {
      const data = await post({ action: 'abandonSession', sessionId });
      return data.session;
    },
    async listSessions({ limit = 100, offset = 0, activeOnly = false } = {}) {
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(activeOnly ? { status: 'active' } : {}) });
      const data = await request(`?${query}`);
      return data.sessions;
    },
    async getSession(sessionId) {
      const data = await request(`?${new URLSearchParams({ id: sessionId })}`);
      return data.session;
    },
    async listEligibleEvaluations({ limit = 50, offset = 0 } = {}) {
      const data = await request(`?${new URLSearchParams({ view: 'evaluations', limit: String(limit), offset: String(offset) })}`);
      return data.evaluations;
    },
  };
}
