function practiceStoreError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

export function practiceStoreConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) throw practiceStoreError('Practice database is not configured', 'PRACTICE_DATABASE_NOT_CONFIGURED', 503);
  return { url, serviceKey };
}

export function createPracticeStore({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const config = practiceStoreConfig(env);

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
      throw practiceStoreError('Practice database is unavailable', 'PRACTICE_DATABASE_UNAVAILABLE', 503, error);
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const duplicate = response.status === 409 || data?.code === '23505';
      throw practiceStoreError(
        duplicate ? 'Practice attempt already exists' : 'Practice database request failed',
        duplicate ? 'PRACTICE_DATABASE_CONFLICT' : 'PRACTICE_DATABASE_ERROR',
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
    async listChallenges() {
      return listAll('practice_challenges', { select: '*', is_active: 'eq.true', order: 'sort_order.asc,slug.asc' });
    },
    async findChallenge(slug) {
      return request('practice_challenges', { query: { select: '*', slug: `eq.${slug}`, limit: '1' }, single: true });
    },
    async listAttempts(learnerId) {
      return listAll('practice_attempts', {
        select: 'id,challenge_slug,client_attempt_id,selected_option,is_correct,attempted_at',
        learner_id: `eq.${learnerId}`,
        order: 'attempted_at.asc,id.asc',
      });
    },
    async findAttempt(learnerId, clientAttemptId) {
      return request('practice_attempts', {
        query: {
          select: 'id,challenge_slug,client_attempt_id,selected_option,is_correct,attempted_at',
          learner_id: `eq.${learnerId}`,
          client_attempt_id: `eq.${clientAttemptId}`,
          limit: '1',
        },
        single: true,
      });
    },
    async insertAttempt(record) {
      try {
        return await request('practice_attempts', { method: 'POST', body: record, single: true });
      } catch (error) {
        if (error.code === 'PRACTICE_DATABASE_CONFLICT') {
          const existing = await this.findAttempt(record.learner_id, record.client_attempt_id);
          if (existing) return existing;
        }
        throw error;
      }
    },
  };
}
