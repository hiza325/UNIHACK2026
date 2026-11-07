import { expect, test } from '@playwright/test';
import http from 'node:http';
import { Interface } from 'ethers';
import { handlePublicVerify } from '../api/credentials/_public-verify.js';
import {
  computeMetadataAttestation,
  verifyMetadataAttestation,
  metadataFieldsFromRow,
} from '../api/credentials/_metadata-attestation.js';
import { certificateData } from '../certificate-renderer.js';
import { createCredentialStore } from '../api/credentials/_store.js';
import { createCredentialService, toPublicCredential } from '../api/credentials/_service.js';
import { credentialIdFromCode } from '../api/credentials/_avalanche.js';

const SECRET = 'test-metadata-secret-'.padEnd(40, 'x');
const ENV = { CERTIFICATE_METADATA_HMAC_SECRET: SECRET };
const CONTRACT = '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b';
const ISSUER = '0x2222222222222222222222222222222222222222';
const EVIDENCE = `0x${'ab'.repeat(32)}`;

const META = Object.freeze({
  credentialCode: 'PXP-TEST-META-0001',
  recipientName: 'Nguyễn Thị Ánh Tuyết',
  subject: 'Critical thinking and reasoning',
  issuedAt: '2026-11-04T00:00:00.000Z',
});

// ---------- Unit: canonicalization + HMAC ----------
test('valid metadata -> VERIFIED', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(att).toMatch(/^v1\.[0-9a-f]{64}$/);
  expect(verifyMetadataAttestation(META, att, ENV)).toBe('VERIFIED');
});

test('changing recipientName -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation({ ...META, recipientName: 'Fake Name' }, att, ENV)).toBe('MISMATCH');
});

test('changing subject -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation({ ...META, subject: 'Fake Subject' }, att, ENV)).toBe('MISMATCH');
});

test('changing issuedAt -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation({ ...META, issuedAt: '2030-01-01T00:00:00.000Z' }, att, ENV)).toBe('MISMATCH');
});

test('changing credentialCode -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation({ ...META, credentialCode: 'PXP-TEST-OTHER-0001' }, att, ENV)).toBe('MISMATCH');
});

test('tampered attestation bytes -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  const tampered = att.slice(0, -1) + (att.endsWith('0') ? '1' : '0');
  expect(verifyMetadataAttestation(META, tampered, ENV)).toBe('MISMATCH');
});

test('no attestation -> UNVERIFIED', () => {
  expect(verifyMetadataAttestation(META, null, ENV)).toBe('UNVERIFIED');
});

test('wrong secret -> MISMATCH', () => {
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation(META, att, { CERTIFICATE_METADATA_HMAC_SECRET: 'y'.repeat(40) })).toBe('MISMATCH');
});

test('missing/weak server secret -> no attestation and UNVERIFIED', () => {
  expect(computeMetadataAttestation(META, {})).toBeNull();
  expect(computeMetadataAttestation(META, { CERTIFICATE_METADATA_HMAC_SECRET: 'short' })).toBeNull();
  const att = computeMetadataAttestation(META, ENV);
  expect(verifyMetadataAttestation(META, att, {})).toBe('UNVERIFIED');
});

test('canonicalization tolerates case/whitespace but detects real changes', () => {
  const att = computeMetadataAttestation(META, ENV);
  const normalized = {
    credentialCode: '  pxp-test-meta-0001 ',
    recipientName: '  Nguyễn Thị   Ánh Tuyết ',
    subject: ' Critical thinking and reasoning ',
    issuedAt: '2026-11-04T00:00:00Z',
  };
  expect(verifyMetadataAttestation(normalized, att, ENV)).toBe('VERIFIED');
});

// ---------- Certificate export gating ----------
function issuedRecord(metadataIntegrity) {
  const tx = `0x${'33'.repeat(32)}`;
  const record = {
    id: 'row-1',
    code: 'PXP-TEST-META-0001',
    source: 'avalanche',
    isTest: false,
    network: 'avalanche-fuji',
    chainId: 43113,
    contractAddress: CONTRACT,
    status: 'verified',
    transactionStatus: 'confirmed',
    transactionHash: tx,
    issueTransactionHash: tx,
    verification: { source: 'avalanche', checked: true, valid: true, exists: true },
    skill: 'Critical thinking and reasoning',
    issuedAt: '2026-11-04',
    snapshot: {
      version: 1,
      credentialId: 'row-1',
      certificateCode: 'PXP-TEST-META-0001',
      recipientName: 'Nguyễn Thị Ánh Tuyết',
      subject: 'Critical thinking and reasoning',
      issuedAt: '2026-11-04T00:00:00Z',
      capturedAt: '2026-11-03T00:00:00Z',
      evaluationId: 'eval-1',
    },
  };
  if (metadataIntegrity) record.metadataIntegrity = metadataIntegrity;
  return record;
}

test('certificate export requires metadata not to be MISMATCH', () => {
  const verified = certificateData({ name: 'X' }, issuedRecord('VERIFIED'));
  expect(verified.state).toBe('issued');
  expect(verified.metadataIntegrity).toBe('VERIFIED');
  expect(verified.canExport).toBe(true);

  const tampered = certificateData({ name: 'X' }, issuedRecord('MISMATCH'));
  expect(tampered.state).toBe('issued');
  expect(tampered.metadataIntegrity).toBe('MISMATCH');
  expect(tampered.canExport).toBe(false);

  const legacy = certificateData({ name: 'X' }, issuedRecord());
  expect(legacy.metadataIntegrity).toBe('UNVERIFIED');
  // Legacy behaviour preserved: still exportable, but labelled unverified.
  expect(legacy.canExport).toBe(true);
});

test('toPublicCredential exposes metadata integrity (passport/credential view)', () => {
  const previous = process.env.CERTIFICATE_METADATA_HMAC_SECRET;
  process.env.CERTIFICATE_METADATA_HMAC_SECRET = SECRET;
  try {
    const row = rowWithAttestation();
    expect(toPublicCredential(row).metadataIntegrity).toBe('VERIFIED');
    expect(toPublicCredential({ ...row, recipient_name_snapshot: 'Fake Name' }).metadataIntegrity).toBe('MISMATCH');
    expect(toPublicCredential({ ...row, metadata_attestation: null }).metadataIntegrity).toBe('UNVERIFIED');
  } finally {
    if (previous === undefined) delete process.env.CERTIFICATE_METADATA_HMAC_SECRET;
    else process.env.CERTIFICATE_METADATA_HMAC_SECRET = previous;
  }
});

test('store degrades safely when attestation columns are not migrated yet', async () => {
  const bodies = [];
  const fetcher = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    bodies.push(body);
    if (body && ('metadata_attestation' in body || 'metadata_attested_at' in body)) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          code: 'PGRST204',
          message: "Could not find the 'metadata_attestation' column of 'learning_credentials' in the schema cache",
        }),
      };
    }
    return { ok: true, status: 200, json: async () => [{ id: 'row-1', blockchain_status: 'confirmed' }] };
  };
  const store = createCredentialStore({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' },
    fetcher,
  });
  const row = await store.updateCredential('row-1', {
    blockchain_status: 'confirmed',
    metadata_attestation: `v1.${'a'.repeat(64)}`,
    metadata_attested_at: '2026-11-04T00:00:00.000Z',
  });
  expect(row.id).toBe('row-1');
  expect(bodies.length).toBe(2);
  expect(bodies[1].metadata_attestation).toBeUndefined();
  expect(bodies[1].blockchain_status).toBe('confirmed');
});

test('confirmation/reconcile signs metadata from the immutable snapshot', async () => {
  const code = 'PXP-TEST-SIGN-0001';
  const row = {
    id: 'row-1',
    credential_code: code,
    credential_id_hash: credentialIdFromCode(code),
    evidence_hash: EVIDENCE,
    blockchain_status: 'pending',
    updated_at: 't0',
    issued_at: null,
    issue_tx_hash: null,
    source: 'ai-evaluation',
    learner_id: 'l1',
    evaluation_id: null,
    recipient_name_snapshot: META.recipientName,
    subject_snapshot: META.subject,
    snapshot_version: 1,
  };
  let captured = null;
  const store = {
    async findByCode() { return { ...row }; },
    async updateCredentialForReconcile(id, patch) { captured = patch; return { ...row, ...patch }; },
  };
  const gateway = {
    async verifyCredential() {
      return { exists: true, valid: true, revoked: false, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1762214400, revokedAt: 0 };
    },
  };
  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
    learningRecordStore: null,
    env: ENV,
  });
  const result = await service.reconcileCredential(code);
  expect(result.status).toBe('confirmed');
  expect(captured.metadata_attestation).toMatch(/^v1\.[0-9a-f]{64}$/);
  expect(verifyMetadataAttestation({
    credentialCode: code,
    recipientName: META.recipientName,
    subject: META.subject,
    issuedAt: captured.issued_at,
  }, captured.metadata_attestation, ENV)).toBe('VERIFIED');
});

// ---------- Integration: public verification ----------
const iface = new Interface([
  'function credentialExists(bytes32) view returns (bool)',
  'function getCredential(bytes32) view returns (bytes32,address,uint64,uint64)',
  'function isCredentialValid(bytes32) view returns (bool)',
]);
function encodeResult(method, value) {
  if (method === 'credentialExists') return iface.encodeFunctionResult('credentialExists', [value]);
  if (method === 'getCredential') return iface.encodeFunctionResult('getCredential', value);
  if (method === 'isCredentialValid') return iface.encodeFunctionResult('isCredentialValid', [value]);
  return '0x';
}
let rpcState = null;
function startRpc() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch {}
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const out = list.map((p) => {
          if (p.method === 'eth_chainId') return { jsonrpc: '2.0', id: p.id, result: '0xa869' };
          if (p.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: p.id, result: '0x1' };
          if (p.method === 'eth_call') {
            const sel = String(p.params?.[0]?.data || '').slice(0, 10);
            if (sel === '0xc974d9ed') return { jsonrpc: '2.0', id: p.id, result: encodeResult('credentialExists', rpcState.exists) };
            if (sel === '0xd1be4883') return { jsonrpc: '2.0', id: p.id, result: encodeResult('getCredential', [rpcState.evidenceHash, rpcState.issuer, rpcState.issuedAt, rpcState.revokedAt]) };
            if (sel === '0x6dc158eb') return { jsonrpc: '2.0', id: p.id, result: encodeResult('isCredentialValid', rpcState.valid) };
          }
          return { jsonrpc: '2.0', id: p.id, result: null };
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(Array.isArray(parsed) ? out : out[0]));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
let dbRow = null;
const originalFetch = global.fetch;
function installDbMock() {
  global.fetch = async (url, opts) => {
    if (String(url).includes('/rest/v1/learning_credentials')) {
      return { ok: true, status: 200, json: async () => (dbRow ? [dbRow] : []) };
    }
    return originalFetch(url, opts);
  };
}
function makeReqRes(code, ip) {
  const req = { method: 'GET', query: { code }, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
  let status = 200; let body = null;
  const res = { statusCode: 200, setHeader() {}, status(s) { status = s; this.statusCode = s; return this; }, json(b) { body = b; return this; } };
  return { req, res, getStatus: () => status, getBody: () => body };
}
function rowWithAttestation(overrides = {}) {
  const base = {
    id: 'row-1',
    credential_code: META.credentialCode,
    title: 'PARADOX AI — C++ Fundamentals',
    skill: META.subject,
    source: 'avalanche',
    issuer_address: ISSUER,
    evidence_hash: EVIDENCE,
    issue_tx_hash: `0x${'11'.repeat(32)}`,
    recipient_name_snapshot: META.recipientName,
    subject_snapshot: META.subject,
    issued_at: META.issuedAt,
    snapshot_version: 1,
    metadata_attestation: null,
    metadata_attested_at: '2026-11-04T00:00:00.000Z',
  };
  // Sign the ORIGINAL metadata, then apply overrides so tampered rows are detected.
  const attestation = computeMetadataAttestation(metadataFieldsFromRow(base), ENV);
  return { ...base, ...overrides, metadata_attestation: attestation };
}
async function runVerify(code, ip) {
  const { req, res, getStatus, getBody } = makeReqRes(code, ip);
  await handlePublicVerify(req, res);
  return { status: getStatus(), body: getBody() };
}

test.describe('public verification metadata integrity', () => {
  let rpc;
  test.beforeAll(async () => {
    rpc = await startRpc();
    installDbMock();
    Object.assign(process.env, {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      AVALANCHE_FUJI_RPC_URL: rpc.url,
      AVALANCHE_FUJI_RPC_URLS: rpc.url,
      AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: CONTRACT,
      CERTIFICATE_METADATA_HMAC_SECRET: SECRET,
    });
  });
  test.afterAll(() => {
    rpc.server.close();
    global.fetch = originalFetch;
  });
  test.beforeEach(() => {
    rpcState = { exists: true, valid: true, revoked: false, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1762214400, revokedAt: 0 };
    dbRow = null;
  });

  test('valid attestation -> VALID + metadata VERIFIED', async () => {
    dbRow = rowWithAttestation();
    const { status, body } = await runVerify(META.credentialCode, '10.1.0.1');
    expect(status).toBe(200);
    expect(body.status).toBe('VALID');
    expect(body.metadata.integrity).toBe('VERIFIED');
    expect(body.evidence.integrity).toBe('MATCH');
    // This fixture supplies contract state but no transaction RPC record.
    expect(body.transactionVerification).toBe('UNAVAILABLE');
    expect(body.warnings).toEqual(['TRANSACTION_NOT_FOUND']);
  });

  test('changed recipientName -> MISMATCH', async () => {
    dbRow = rowWithAttestation({ recipient_name_snapshot: 'Fake Name' });
    const { body } = await runVerify(META.credentialCode, '10.1.0.2');
    expect(body.status).toBe('VALID');
    expect(body.metadata.integrity).toBe('MISMATCH');
    expect(body.warnings).toContain('METADATA_MISMATCH');
  });

  test('changed subject -> MISMATCH', async () => {
    dbRow = rowWithAttestation({ subject_snapshot: 'Fake Subject' });
    const { body } = await runVerify(META.credentialCode, '10.1.0.3');
    expect(body.metadata.integrity).toBe('MISMATCH');
  });

  test('changed issuedAt -> MISMATCH', async () => {
    dbRow = rowWithAttestation({ issued_at: '2030-01-01T00:00:00.000Z' });
    const { body } = await runVerify(META.credentialCode, '10.1.0.4');
    expect(body.metadata.integrity).toBe('MISMATCH');
  });

  test('legacy credential without attestation -> UNVERIFIED', async () => {
    const row = rowWithAttestation();
    row.metadata_attestation = null;
    dbRow = row;
    const { body } = await runVerify(META.credentialCode, '10.1.0.5');
    expect(body.status).toBe('VALID');
    expect(body.metadata.integrity).toBe('UNVERIFIED');
  });

  test('database evidence hash differs from chain -> warning', async () => {
    dbRow = rowWithAttestation({ evidence_hash: `0x${'cd'.repeat(32)}` });
    const { body } = await runVerify(META.credentialCode, '10.1.0.6');
    expect(body.evidence.integrity).toBe('MISMATCH');
    expect(body.warnings).toContain('EVIDENCE_HASH_MISMATCH');
  });

  test('revoked credential -> REVOKED', async () => {
    rpcState = { ...rpcState, valid: false, revoked: true, revokedAt: 1762300800 };
    dbRow = rowWithAttestation();
    const { status, body } = await runVerify(META.credentialCode, '10.1.0.7');
    expect(status).toBe(200);
    expect(body.status).toBe('REVOKED');
  });

  test('credential absent on chain -> NOT_FOUND', async () => {
    rpcState = { ...rpcState, exists: false };
    dbRow = rowWithAttestation();
    const { status, body } = await runVerify(META.credentialCode, '10.1.0.8');
    expect(status).toBe(404);
    expect(body.status).toBe('NOT_FOUND');
  });

  test('public verify exposes isTest from credential code prefix', async () => {
    dbRow = rowWithAttestation({ credential_code: 'PXP-TEST-CPP-004', is_test: false });
    const { body } = await runVerify(META.credentialCode, '10.1.0.9');
    expect(body.credential.isTest).toBe(true);
  });
});
