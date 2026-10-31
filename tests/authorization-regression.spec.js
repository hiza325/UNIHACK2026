import { expect, test } from '@playwright/test';
import { authConfig, publicUser } from '../api/auth/_supabase.js';
import { toPublicCredential, toVerificationView } from '../api/credentials/_service.js';
import { createCredentialsHandler } from '../api/credentials/index.js';

// Addresses that used to be duplicated as the server-side fallback when
// ADMIN_EMAILS was unset. They must never gain authorization implicitly.
const FORMER_FALLBACK_ADMINS = ['admin@paradox.ai', 'huyclasswiz@gmail.com', 'huyriuuu@gmail.com', 'lamnguyen080306@gmail.com'];

const BASE_ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

const PRIVATE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  credential_code: 'PXP-2026-ALG-0001',
  title: 'Critical Thinking Certificate',
  skill: 'Reasoning',
  issued_at: '2026-10-30T00:00:00.000Z',
  blockchain_status: 'confirmed',
  onchain_valid: true,
  verification_checked_at: '2026-10-30T00:00:00.000Z',
  issue_tx_hash: `0x${'11'.repeat(32)}`,
  assessment_score: 93,
  learner_id: '22222222-2222-4222-8222-222222222222',
  snapshot_version: 1,
  recipient_name_snapshot: 'Nguyễn Văn A',
  subject_snapshot: 'Critical thinking and reasoning',
  snapshot_captured_at: '2026-10-29T00:00:00.000Z',
  evaluation_id: '33333333-3333-4333-8333-333333333333',
  evidence_hash: `0x${'ab'.repeat(32)}`,
  issuer_address: '0x35d1dc8183326f3CBc631ED04094765052B365cD',
  is_test: false,
};

test('SEC-03 an unset or empty ADMIN_EMAILS allowlists no administrator', () => {
  for (const env of [BASE_ENV, { ...BASE_ENV, ADMIN_EMAILS: '' }]) {
    const { adminEmails } = authConfig(env);
    expect(adminEmails).toEqual([]);
    for (const email of FORMER_FALLBACK_ADMINS) expect(adminEmails).not.toContain(email);
  }
});

test('SEC-03 a declared allowlist still authorizes and is normalized', () => {
  const { adminEmails } = authConfig({ ...BASE_ENV, ADMIN_EMAILS: ' Admin@Example.com ,ops@example.com,' });
  expect(adminEmails).toEqual(['admin@example.com', 'ops@example.com']);
});

test('SEC-03 a former fallback address is an ordinary user without app_metadata', () => {
  const env = { ...BASE_ENV, ADMIN_EMAILS: '' };
  for (const email of FORMER_FALLBACK_ADMINS) {
    expect(publicUser({ id: 'u1', email }, env).role).toBe('user');
  }
});

test('SEC-03 app_metadata remains the supported way to grant admin', () => {
  const user = publicUser({ id: 'u1', email: 'anyone@example.com', app_metadata: { role: 'admin' } }, { ...BASE_ENV, ADMIN_EMAILS: '' });
  expect(user.role).toBe('admin');
});

test('SEC-01 the passport projection still carries the private fields it is meant to show', () => {
  const full = toPublicCredential(PRIVATE_ROW);
  expect(full.snapshot.recipientName).toBe('Nguyễn Văn A');
  expect(full.assessmentScore).toBe(93);
  expect(full.evidenceHash).toBeTruthy();
});

test('SEC-01 the verification projection drops learner-private fields', () => {
  const view = toVerificationView(toPublicCredential(PRIVATE_ROW));
  expect(view).toMatchObject({ code: 'PXP-2026-ALG-0001', name: 'Critical Thinking Certificate', skill: 'Reasoning', status: 'verified' });
  expect(view.transactionHash).toBeTruthy();
  for (const field of ['snapshot', 'assessmentScore', 'evidenceHash', 'issuer', 'issueTransactionHash', 'revokeTransactionHash']) {
    expect(view[field]).toBeUndefined();
  }
  expect(JSON.stringify(view)).not.toMatch(/Nguyễn Văn A|recipientName|evaluationId/i);
});

test('SEC-01 a signed-in stranger looking up a code receives only the verification view', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { ...process.env };
  Object.assign(process.env, BASE_ENV, { SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_EMAILS: '' });
  const stranger = { id: '44444444-4444-4444-8444-444444444444', email: 'stranger@example.com', app_metadata: {} };
  global.fetch = async (url) => jsonResponse(String(url).includes('/auth/v1/user') ? stranger : { ...stranger, banned_until: null });

  const handler = createCredentialsHandler({
    storeFactory: () => ({}),
    serviceFactory: () => ({ find: async () => toPublicCredential(PRIVATE_ROW) }),
    learningRecordStoreFactory: () => null,
  });

  try {
    const res = responseRecorder();
    await handler({ method: 'GET', headers: { cookie: 'paradox-access=session-token' }, query: { code: 'PXP-2026-ALG-0001' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.credential.code).toBe('PXP-2026-ALG-0001');
    expect(res.payload.credential.status).toBe('verified');
    expect(JSON.stringify(res.payload)).not.toMatch(/Nguyễn Văn A|recipientName|assessmentScore|evaluationId|evidenceHash/i);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
});
