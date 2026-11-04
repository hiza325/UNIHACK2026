/**
 * Server-only Supabase store for public ZK proof artifacts.
 *
 * The table is protected by RLS: anon/authenticated have no access and only the
 * service role may read/write. This module also rejects private fields at the
 * boundary so a future caller cannot accidentally persist score/nonce/witness.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const VKEY_HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]+$/;

export const ZK_PROOFS_TABLE = 'zk_proofs';
export const ZK_PROOF_STATUSES = Object.freeze(['active', 'revoked', 'superseded']);

// Never select `*`: a future column must be deliberately added to the public
// projection, not leaked by accident.
export const ZK_PROOF_SELECT = [
  'id',
  'evaluation_id',
  'learner_id',
  'credential_id_hash',
  'evidence_hash',
  'threshold',
  'circuit_version',
  'vkey_hash',
  'commitment',
  'public_signals',
  'proof',
  'attestation',
  'issuer_key_id',
  'issued_at',
  'status',
  'proof_mode',
  'credential_is_test',
  'revoked_at',
  'created_at',
  'updated_at',
].join(',');

const INSERT_COLUMNS = new Set([
  'evaluation_id',
  'learner_id',
  'credential_id_hash',
  'evidence_hash',
  'threshold',
  'circuit_version',
  'vkey_hash',
  'commitment',
  'public_signals',
  'proof',
  'attestation',
  'issuer_key_id',
  'issued_at',
  'status',
  'proof_mode',
  'credential_is_test',
  'revoked_at',
]);

const REQUIRED_COLUMNS = [
  'evaluation_id',
  'learner_id',
  'credential_id_hash',
  'evidence_hash',
  'threshold',
  'circuit_version',
  'vkey_hash',
  'commitment',
  'public_signals',
  'proof',
  'attestation',
  'issuer_key_id',
  'issued_at',
];

const FORBIDDEN_KEYS = new Set([
  'score',
  'assessment_score',
  'assessmentscore',
  'nonce',
  'witness',
  'private_key',
  'privatekey',
  'evaluator_private_key',
  'learner_email',
  'email',
]);

function storeError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function assertNoForbiddenKeys(value, path = 'record') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw storeError(`ZK proof artifact contains a forbidden field: ${path}.${key}`, 'ZK_PROOF_PRIVATE_FIELD', 400);
    }
    assertNoForbiddenKeys(nested, `${path}.${key}`);
  }
}

function requireUuid(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(normalized)) throw storeError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized;
}

function requireBytes32(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!BYTES32.test(normalized)) throw storeError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized;
}

function requireDecimal(value, field) {
  const normalized = String(value ?? '').trim();
  if (!DECIMAL.test(normalized)) throw storeError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized;
}

export function assertInsertRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw storeError('ZK proof record must be an object', 'ZK_INVALID_INPUT', 400);
  }
  assertNoForbiddenKeys(record);

  for (const key of Object.keys(record)) {
    if (!INSERT_COLUMNS.has(key)) {
      throw storeError(`ZK proof field is not writable: ${key}`, 'ZK_INVALID_INPUT', 400);
    }
  }
  for (const key of REQUIRED_COLUMNS) {
    if (record[key] === undefined || record[key] === null || record[key] === '') {
      throw storeError(`ZK proof field is required: ${key}`, 'ZK_INVALID_INPUT', 400);
    }
  }

  const threshold = Number(record.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw storeError('ZK proof threshold is invalid', 'ZK_INVALID_INPUT', 400);
  }
  const issuedAt = new Date(record.issued_at);
  if (Number.isNaN(issuedAt.getTime())) {
    throw storeError('ZK proof issued_at is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (!VKEY_HASH.test(String(record.vkey_hash).trim().toLowerCase())) {
    throw storeError('ZK proof vkey hash is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (String(record.circuit_version).trim().length < 1 || String(record.circuit_version).trim().length > 64) {
    throw storeError('ZK proof circuit version is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (String(record.issuer_key_id).trim().length < 1 || String(record.issuer_key_id).trim().length > 100) {
    throw storeError('ZK proof issuer key ID is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (!Array.isArray(record.public_signals) || record.public_signals.length !== 6
    || !record.public_signals.every(value => DECIMAL.test(String(value)))) {
    throw storeError('ZK public signals are invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (!record.proof || typeof record.proof !== 'object' || Array.isArray(record.proof)) {
    throw storeError('ZK proof is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (!record.attestation || typeof record.attestation !== 'object' || Array.isArray(record.attestation)) {
    throw storeError('ZK attestation is invalid', 'ZK_INVALID_INPUT', 400);
  }
  const status = record.status || 'active';
  if (!ZK_PROOF_STATUSES.includes(status)) {
    throw storeError('ZK proof status is invalid', 'ZK_INVALID_INPUT', 400);
  }
  const proofMode = record.proof_mode || 'demo';
  if (!['demo', 'official'].includes(proofMode)) {
    throw storeError('ZK proof mode is invalid', 'ZK_INVALID_INPUT', 400);
  }
  const credentialIsTest = record.credential_is_test ?? true;
  if (typeof credentialIsTest !== 'boolean') {
    throw storeError('ZK credential test flag is invalid', 'ZK_INVALID_INPUT', 400);
  }
  if (proofMode === 'official' && credentialIsTest) {
    throw storeError('Official proof cannot snapshot a test credential', 'ZK_OFFICIAL_TEST_FORBIDDEN', 400);
  }
  const revokedAt = record.revoked_at ?? null;
  if (status === 'revoked' && !revokedAt) {
    throw storeError('Revoked proof requires revoked_at', 'ZK_INVALID_INPUT', 400);
  }
  if (status !== 'revoked' && revokedAt) {
    throw storeError('Non-revoked proof cannot have revoked_at', 'ZK_INVALID_INPUT', 400);
  }
  if (revokedAt) {
    const revoked = new Date(revokedAt);
    if (Number.isNaN(revoked.getTime())) throw storeError('ZK revoked_at is invalid', 'ZK_INVALID_INPUT', 400);
  }

  return Object.freeze({
    ...record,
    evaluation_id: requireUuid(record.evaluation_id, 'Evaluation ID'),
    learner_id: requireUuid(record.learner_id, 'Learner ID'),
    credential_id_hash: requireBytes32(record.credential_id_hash, 'Credential ID hash'),
    evidence_hash: requireBytes32(record.evidence_hash, 'Evidence hash'),
    threshold,
    circuit_version: String(record.circuit_version).trim(),
    vkey_hash: String(record.vkey_hash).trim().toLowerCase(),
    commitment: requireDecimal(record.commitment, 'Commitment'),
    issuer_key_id: String(record.issuer_key_id).trim(),
    issued_at: issuedAt.toISOString(),
    status,
    proof_mode: proofMode,
    credential_is_test: credentialIsTest,
    revoked_at: revokedAt ? new Date(revokedAt).toISOString() : null,
  });
}

export function zkStagingDatabaseContext(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  if (!url) throw storeError('ZK proof database is not configured', 'ZK_DATABASE_NOT_CONFIGURED', 503);

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw storeError('ZK database URL is invalid', 'ZK_DATABASE_URL_INVALID', 503);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw storeError('ZK database URL is invalid', 'ZK_DATABASE_URL_INVALID', 503);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { environment: 'local', projectRef: null };
  }
  if (!host.endsWith('.supabase.co')) {
    throw storeError('ZK database URL is not a trusted Supabase project URL', 'ZK_DATABASE_PROJECT_UNTRUSTED', 503);
  }

  const projectRef = host.split('.')[0];
  const expectedRef = String(env.ZK_STAGING_SUPABASE_PROJECT_REF || 'ekkyygjlshrhibrdmhlx').trim().toLowerCase();
  if (expectedRef === 'bwjpnyifsoiwoetxflzf') {
    throw storeError('ZK staging project ref cannot target production', 'ZK_STAGING_PROJECT_CONFIG_INVALID', 503);
  }
  if (projectRef === 'bwjpnyifsoiwoetxflzf') {
    throw storeError('ZK database points to the protected production Supabase project', 'ZK_PRODUCTION_DATABASE_FORBIDDEN', 503);
  }
  if (projectRef !== expectedRef) {
    throw storeError('ZK database project does not match the approved staging project', 'ZK_STAGING_PROJECT_MISMATCH', 503);
  }
  return { environment: 'staging', projectRef };
}

export function zkStoreConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) {
    throw storeError('ZK proof database is not configured', 'ZK_DATABASE_NOT_CONFIGURED', 503);
  }
  const database = zkStagingDatabaseContext(env);
  return { url, serviceKey, database };
}

function mapStoreError(response, data) {
  const duplicate = response.status === 409 || data?.code === '23505';
  return storeError(
    duplicate ? 'ZK proof already exists' : 'ZK proof database request failed',
    duplicate ? 'ZK_PROOF_CONFLICT' : 'ZK_DATABASE_ERROR',
    duplicate ? 409 : 502,
  );
}

export function createZkProofStore({ env = process.env, fetcher = globalThis.fetch, now = () => new Date() } = {}) {
  const config = zkStoreConfig(env);

  async function request(table, { method = 'GET', query = {}, body, single = false } = {}) {
    if (typeof fetcher !== 'function') {
      throw storeError('ZK proof database is unavailable', 'ZK_DATABASE_UNAVAILABLE', 503);
    }
    let response;
    try {
      const suffix = Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';
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
      throw storeError('ZK proof database is unavailable', 'ZK_DATABASE_UNAVAILABLE', 503, error);
    }

    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw mapStoreError(response, data);
    return single ? (Array.isArray(data) ? data[0] || null : data) : data || [];
  }

  return {
    async insertProof(record) {
      return request(ZK_PROOFS_TABLE, {
        method: 'POST',
        query: { select: ZK_PROOF_SELECT },
        body: assertInsertRecord(record),
        single: true,
      });
    },

    async findById(id) {
      return request(ZK_PROOFS_TABLE, {
        query: { select: ZK_PROOF_SELECT, id: `eq.${requireUuid(id, 'Proof ID')}`, limit: '1' },
        single: true,
      });
    },

    async findByEvaluationThreshold({ evaluationId, threshold, circuitVersion }) {
      const evaluation = requireUuid(evaluationId, 'Evaluation ID');
      const value = Number(threshold);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw storeError('Threshold is invalid', 'ZK_INVALID_INPUT', 400);
      }
      const version = String(circuitVersion ?? '').trim();
      if (!version) throw storeError('Circuit version is required', 'ZK_INVALID_INPUT', 400);
      return request(ZK_PROOFS_TABLE, {
        query: {
          select: ZK_PROOF_SELECT,
          evaluation_id: `eq.${evaluation}`,
          threshold: `eq.${value}`,
          circuit_version: `eq.${version}`,
          status: 'eq.active',
          order: 'created_at.desc',
          limit: '1',
        },
        single: true,
      });
    },

    async listByLearner(learnerId, { limit = 50, offset = 0 } = {}) {
      const learner = requireUuid(learnerId, 'Learner ID');
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
      const boundedOffset = Math.max(0, Math.min(10_000, Number(offset) || 0));
      return request(ZK_PROOFS_TABLE, {
        query: {
          select: ZK_PROOF_SELECT,
          learner_id: `eq.${learner}`,
          order: 'created_at.desc',
          limit: String(boundedLimit),
          offset: String(boundedOffset),
        },
      });
    },

    async updateStatus(id, status) {
      // Terminal transitions only. There is deliberately no path from
      // revoked/superseded back to active, and no superseded <-> revoked.
      if (status !== 'revoked' && status !== 'superseded') {
        throw storeError('ZK proof transition is not allowed', 'ZK_INVALID_TRANSITION', 409);
      }
      const proofId = requireUuid(id, 'Proof ID');
      const revokedAt = status === 'revoked' ? new Date(now()).toISOString() : null;
      const row = await request(ZK_PROOFS_TABLE, {
        method: 'PATCH',
        query: {
          id: `eq.${proofId}`,
          status: 'eq.active',
          select: ZK_PROOF_SELECT,
        },
        body: { status, revoked_at: revokedAt },
        single: true,
      });
      if (!row) {
        // Atomic conditional update matched no active row. This covers both
        // concurrent revocation and attempts to restore terminal state.
        throw storeError(
          'ZK proof is not active or does not exist',
          'ZK_PROOF_TRANSITION_CONFLICT',
          409,
        );
      }
      return row;
    },
  };
}
