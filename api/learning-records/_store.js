function recordStoreError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

export function learningRecordStoreConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) throw recordStoreError('Learning record database is not configured', 'LEARNING_RECORD_DATABASE_NOT_CONFIGURED', 503);
  return { url, serviceKey };
}

export function createLearningRecordStore({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const config = learningRecordStoreConfig(env);

  async function request(table, { method = 'GET', query = {}, body, single = false } = {}) {
    let response;
    try {
      const suffix = Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
      response = await fetcher(`${config.url}/rest/v1/${table}${suffix}`, {
        method,
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw recordStoreError('Learning record database is unavailable', 'LEARNING_RECORD_DATABASE_UNAVAILABLE', 503, error);
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const duplicate = response.status === 409 || data?.code === '23505';
      throw recordStoreError(
        duplicate ? 'Learning record already exists' : 'Learning record database request failed',
        duplicate ? 'LEARNING_RECORD_CONFLICT' : 'LEARNING_RECORD_DATABASE_ERROR',
        duplicate ? 409 : 502,
      );
    }
    return single ? (Array.isArray(data) ? data[0] || null : data) : data || [];
  }

  async function listAll(table, query, { pageSize = 500 } = {}) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await request(table, { query: { ...query, limit: String(pageSize), offset: String(offset) } });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  return {
    async insertSession(record) {
      return request('learning_sessions', { method: 'POST', body: record, single: true });
    },
    async updateSession(id, learnerId, patch) {
      return request('learning_sessions', { method: 'PATCH', query: { id: `eq.${id}`, learner_id: `eq.${learnerId}` }, body: patch, single: true });
    },
    async findSession(id, learnerId) {
      return request('learning_sessions', { query: { select: '*', id: `eq.${id}`, learner_id: `eq.${learnerId}`, limit: '1' }, single: true });
    },
    async listSessions(learnerId, { limit = 50, offset = 0, activeOnly = false } = {}) {
      return request('learning_sessions', {
        query: {
          select: '*', learner_id: `eq.${learnerId}`, order: 'started_at.desc', limit: String(limit), offset: String(offset),
          ...(activeOnly ? { status: 'in.(in_progress,analysis_unavailable)' } : {}),
        },
      });
    },
    async insertSubmission(record) {
      return request('learning_submissions', { method: 'POST', body: record, single: true });
    },
    async updateSubmission(id, learnerId, patch) {
      return request('learning_submissions', { method: 'PATCH', query: { id: `eq.${id}`, learner_id: `eq.${learnerId}` }, body: patch, single: true });
    },
    async findSubmission(id, sessionId, learnerId) {
      return request('learning_submissions', { query: { select: '*', id: `eq.${id}`, session_id: `eq.${sessionId}`, learner_id: `eq.${learnerId}`, limit: '1' }, single: true });
    },
    async listSubmissions(sessionId, learnerId) {
      return request('learning_submissions', { query: { select: '*', session_id: `eq.${sessionId}`, learner_id: `eq.${learnerId}`, order: 'attempt_number.asc' } });
    },
    async latestSubmission(sessionId, learnerId) {
      return request('learning_submissions', { query: { select: '*', session_id: `eq.${sessionId}`, learner_id: `eq.${learnerId}`, order: 'attempt_number.desc', limit: '1' }, single: true });
    },
    async insertInteractions(records) {
      if (!records.length) return [];
      return request('learning_interactions', { method: 'POST', body: records });
    },
    async listInteractions(sessionId, learnerId) {
      return request('learning_interactions', { query: { select: '*', session_id: `eq.${sessionId}`, learner_id: `eq.${learnerId}`, order: 'created_at.asc,id.asc' } });
    },
    async insertEvaluation(record) {
      return request('learning_evaluations', { method: 'POST', body: record, single: true });
    },
    async listEvaluations(sessionId, learnerId) {
      return request('learning_evaluations', { query: { select: '*', session_id: `eq.${sessionId}`, learner_id: `eq.${learnerId}`, order: 'evaluated_at.asc' } });
    },
    async findEvaluation(id, learnerId) {
      return request('learning_evaluations', { query: { select: '*', id: `eq.${id}`, learner_id: `eq.${learnerId}`, limit: '1' }, single: true });
    },
    async listEligibleEvaluations(learnerId, { limit = 50, offset = 0 } = {}) {
      return request('learning_evaluations', { query: { select: '*', learner_id: `eq.${learnerId}`, credential_eligible: 'eq.true', order: 'evaluated_at.desc', limit: String(limit), offset: String(offset) } });
    },
    async listAchievementSessions(learnerId) {
      return listAll('learning_sessions', {
        select: 'id,status,started_at,completed_at',
        learner_id: `eq.${learnerId}`,
        status: 'eq.completed',
        order: 'completed_at.asc,id.asc',
      });
    },
    async listAchievementSubmissions(learnerId) {
      return listAll('learning_submissions', {
        select: 'id,session_id,attempt_number,submission_type,analysis_state,ai_analysis',
        learner_id: `eq.${learnerId}`,
        analysis_state: 'eq.analyzed',
        order: 'submitted_at.asc,id.asc',
      });
    },
    async listAchievementEvaluations(learnerId) {
      return listAll('learning_evaluations', {
        select: 'session_id,submission_id,status',
        learner_id: `eq.${learnerId}`,
        status: 'eq.pass',
        order: 'evaluated_at.asc,id.asc',
      });
    },
  };
}
