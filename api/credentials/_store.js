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

// The metadata-attestation columns are additive. Until the migration is applied,
// a PATCH/POST that includes them would fail; retry once without them so
// issuance keeps working and the credential is simply reported as UNVERIFIED.
function stripOptionalMetadataColumns(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.metadata_attestation === undefined && body.metadata_attested_at === undefined && body.metadata === undefined) return null;
  const { metadata_attestation, metadata_attested_at, metadata, ...rest } = body;
  return rest;
}

function isMissingMetadataColumnError(response, data) {
  if (response.ok) return false;
  const code = String(data?.code || '');
  const message = String(data?.message || data?.details || '');
  if (code === 'PGRST204' || code === '42703') return true;
  return (/metadata_attestation|metadata_attested_at|metadata/i.test(message)) && /column|schema cache/i.test(message);
}

export function createCredentialStore({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const config = credentialStoreConfig(env);

  async function request(table, { method = 'GET', query = '', body, single = false } = {}) {
    const url = `${config.url}/rest/v1/${table}${query}`;
    const send = (payload) => fetcher(url, {
      method,
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(payload ? { Prefer: 'return=representation' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    let response = await send(body);
    let data = response.status === 204 ? null : await response.json().catch(() => null);
    if (isMissingMetadataColumnError(response, data)) {
      const fallback = stripOptionalMetadataColumns(body);
      if (fallback) {
        response = await send(fallback);
        data = response.status === 204 ? null : await response.json().catch(() => null);
      }
    }
    if (!response.ok) throw mapStoreError(response, data);
    if (single) return Array.isArray(data) ? (data[0] || null) : data;
    return data || [];
  }

  const filters = values => `?${new URLSearchParams(values).toString()}`;

  return {
    async findLearnerName(learnerId) {
      const response = await fetcher(`${config.url}/auth/v1/admin/users/${encodeURIComponent(learnerId)}`, {
        headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
      });
      if (response.status === 404) throw storeError('Learner was not found', 'LEARNER_NOT_FOUND', 404);
      if (!response.ok) throw storeError('Learner profile could not be read', 'LEARNER_PROFILE_UNAVAILABLE', 503);
      const user = await response.json();
      if (user?.id !== learnerId) throw storeError('Learner profile mismatch', 'LEARNER_PROFILE_MISMATCH', 409);
      // Supabase may store the display name under several metadata keys.
      // Only an explicitly stored profile name is authoritative; never derive one from email.
      const metadata = user.user_metadata || user.raw_user_meta_data || user.app_metadata || {};
      return metadata.full_name || metadata.name || metadata.display_name || metadata.preferred_name || metadata.given_name || null;
    },
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
      const allowed = new Set(['blockchain_status', 'contract_address', 'issuer_address', 'issue_tx_hash', 'revoke_tx_hash', 'issued_at', 'revoked_at', 'verification_checked_at', 'onchain_valid', 'failure_code', 'failure_message', 'confirmation_started_at', 'confirmation_attempts', 'metadata_attestation', 'metadata_attested_at']);
      if (Object.keys(patch).some(key => !allowed.has(key))) {
        throw storeError('Credential metadata cannot be updated', 'CREDENTIAL_IMMUTABLE_FIELD', 409);
      }
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
    async claimRetry(id) {
      return request('learning_credentials', {
        method: 'PATCH',
        query: filters({ id: `eq.${id}`, blockchain_status: 'eq.failed' }),
        body: { blockchain_status: 'submitting', failure_code: null, failure_message: null },
        single: true,
      });
    },
    async updateCredentialForVerify(id, patch, expectedUpdatedAt) {
      if (!expectedUpdatedAt) {
        throw storeError('Credential version is missing', 'CREDENTIAL_VERSION_REQUIRED', 409);
      }

      const allowed = new Set(['blockchain_status', 'contract_address', 'issuer_address', 'issue_tx_hash', 'revoke_tx_hash', 'issued_at', 'revoked_at', 'verification_checked_at', 'onchain_valid', 'failure_code', 'failure_message', 'confirmation_started_at', 'confirmation_attempts', 'metadata_attestation', 'metadata_attested_at']);
      if (Object.keys(patch).some(key => !allowed.has(key))) {
        throw storeError('Credential metadata cannot be updated', 'CREDENTIAL_IMMUTABLE_FIELD', 409);
      }

      const query = filters({
        id: `eq.${id}`,
        updated_at: `eq.${expectedUpdatedAt}`,
        blockchain_status: 'neq.revoked',
        confirmation_started_at: 'is.null',
        select: '*',
      });

      return request('learning_credentials', {
        method: 'PATCH',
        query,
        body: patch,
        single: true,
      });
    },
    async updateCredentialIf(id, patch, claimedAt) {
      const allowed = new Set(['blockchain_status', 'contract_address', 'issuer_address', 'issue_tx_hash', 'revoke_tx_hash', 'issued_at', 'revoked_at', 'verification_checked_at', 'onchain_valid', 'failure_code', 'failure_message', 'confirmation_started_at', 'confirmation_attempts', 'metadata_attestation', 'metadata_attested_at']);
      if (Object.keys(patch).some(key => !allowed.has(key))) {
        throw storeError('Credential metadata cannot be updated', 'CREDENTIAL_IMMUTABLE_FIELD', 409);
      }
      const qClaimed = claimedAt ? '&confirmation_started_at=eq.' + encodeURIComponent(claimedAt) : '';
      const url = config.url + '/rest/v1/learning_credentials?id=eq.' + encodeURIComponent(id) + qClaimed + '&blockchain_status=in.(submitting,pending)&select=*';
      const send = (payloadBody) => fetcher(url, {
        method: 'PATCH',
        headers: {
          apikey: config.serviceKey,
          Authorization: 'Bearer ' + config.serviceKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payloadBody),
      });
      let response = await send(patch);
      let payload = response.status === 204 ? null : await response.json().catch(() => null);
      const fallback = isMissingMetadataColumnError(response, payload) ? stripOptionalMetadataColumns(patch) : null;
      if (fallback) {
        response = await send(fallback);
        payload = response.status === 204 ? null : await response.json().catch(() => null);
      }
      if (!response.ok) throw mapStoreError(response, payload);
      const row = Array.isArray(payload) ? (payload[0] || null) : payload;
      return row ? { ...row } : null;
    },
    async claimConfirm(id) {
      const rows = await request('rpc/claim_credential_confirmation', {
        method: 'POST',
        body: { p_id: id },
        single: false,
      });
      const row = Array.isArray(rows) ? (rows[0] || null) : rows;
      // PostgreSQL composite RPCs can return a truthy object with every field null.
      // A claim is acquired only when the returned row identifies the requested credential.
      return row && typeof row === 'object' && row.id === id ? { ...row } : null;
    },
    async claimRevoke(id) {
      const query = '?id=eq.' + encodeURIComponent(id) + '&blockchain_status=eq.confirmed&revoke_tx_hash=is.null&select=*';
      const response = await fetcher(config.url + '/rest/v1/learning_credentials' + query, {
        method: 'PATCH',
        headers: {
          apikey: config.serviceKey,
          Authorization: 'Bearer ' + config.serviceKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ blockchain_status: 'revoke_pending', confirmation_started_at: null }),
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw mapStoreError(response, data);
      const row = Array.isArray(data) ? (data[0] || null) : data;
      return row ? { ...row } : null;
    },
    async updateCredentialForRevoke(id, patch, expectedUpdatedAt, expectedStatus, revokeTxHash) {
      const allowed = new Set(['blockchain_status', 'contract_address', 'issuer_address', 'issue_tx_hash', 'revoke_tx_hash', 'issued_at', 'revoked_at', 'verification_checked_at', 'onchain_valid', 'failure_code', 'failure_message', 'confirmation_started_at', 'confirmation_attempts', 'metadata_attestation', 'metadata_attested_at']);
      if (Object.keys(patch).some(key => !allowed.has(key))) {
        throw storeError('Credential metadata cannot be updated', 'CREDENTIAL_IMMUTABLE_FIELD', 409);
      }
      let query = '?id=eq.' + encodeURIComponent(id) + '&updated_at=eq.' + encodeURIComponent(expectedUpdatedAt) + '&blockchain_status=eq.' + encodeURIComponent(expectedStatus) + '&select=*';
      if (revokeTxHash) {
        query += '&revoke_tx_hash=eq.' + encodeURIComponent(revokeTxHash);
      }
      return request('learning_credentials', { method: 'PATCH', query, body: patch, single: true });
    },
    async updateCredentialForReconcile(id, patch, expectedUpdatedAt) {
      const allowed = new Set(['blockchain_status', 'contract_address', 'issuer_address', 'issue_tx_hash', 'revoke_tx_hash', 'issued_at', 'revoked_at', 'verification_checked_at', 'onchain_valid', 'failure_code', 'failure_message', 'confirmation_started_at', 'confirmation_attempts', 'metadata_attestation', 'metadata_attested_at']);
      if (Object.keys(patch).some(key => !allowed.has(key))) {
        throw storeError('Credential metadata cannot be updated', 'CREDENTIAL_IMMUTABLE_FIELD', 409);
      }
      const query = '?id=eq.' + encodeURIComponent(id) + '&updated_at=eq.' + encodeURIComponent(expectedUpdatedAt) + '&blockchain_status=in.(submitting,pending)&select=*';
      return request('learning_credentials', { method: 'PATCH', query, body: patch, single: true });
    },
    async findByEvaluationId(evaluationId) {
      return request('learning_credentials', {
        query: filters({ select: '*', evaluation_id: `eq.${evaluationId}`, limit: '1' }),
        single: true,
      });
    },
    async listPendingCredentials(minAgeMinutes = 2) {
      const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
      return request('learning_credentials', {
        query: filters({ select: '*', blockchain_status: 'in.(submitting,pending)', created_at: `lt.${cutoff}`, order: 'created_at.asc', limit: '50' }),
      });
    },
  };
}
