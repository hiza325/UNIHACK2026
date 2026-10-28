function storeError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

export function credentialStoreConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) throw storeError('Credential database is not configured', 'CREDENTIAL_DATABASE_NOT_CONFIGURED', 503);
  return { url, serviceKey };
}

function mapStoreError(response, data) {
  const duplicate = response.status === 409 || data?.code === '23505';
  return storeError(
    duplicate ? 'Credential or evidence already exists in the database' : 'Credential database request failed',
    duplicate ? 'DUPLICATE_CREDENTIAL_DATABASE' : 'CREDENTIAL_DATABASE_ERROR',
    duplicate ? 409 : 502,
  );
}

export function createCredentialStore({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const config = credentialStoreConfig(env);

  async function request(table, { method = 'GET', query = '', body, single = false } = {}) {
    const response = await fetcher(`${config.url}/rest/v1/${table}${query}`, {
      method,
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(body ? { Prefer: 'return=representation' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw mapStoreError(response, data);
    if (single) return Array.isArray(data) ? (data[0] || null) : data;
    return data || [];
  }

  const filters = values => `?${new URLSearchParams(values).toString()}`;

  return {
    async findByCode(code) {
      return request('learning_credentials', {
        query: filters({ select: '*', credential_code: `eq.${code}`, limit: '1' }),
        single: true,
      });
    },
    async listByLearner(learnerId) {
      return request('learning_credentials', {
        query: filters({ select: '*', learner_id: `eq.${learnerId}`, order: 'created_at.desc' }),
      });
    },
    async insertCredential(record) {
      return request('learning_credentials', { method: 'POST', body: record, single: true });
    },
    async updateCredential(id, patch) {
      return request('learning_credentials', {
        method: 'PATCH', query: filters({ id: `eq.${id}` }), body: patch, single: true,
      });
    },
    async insertTransaction(record) {
      return request('credential_transactions', { method: 'POST', body: record, single: true });
    },
    async updateTransaction(id, patch) {
      return request('credential_transactions', {
        method: 'PATCH', query: filters({ id: `eq.${id}` }), body: patch, single: true,
      });
    },
  };
}
