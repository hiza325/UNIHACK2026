import crypto from 'node:crypto';

/*
 * Server-only metadata attestation for issued certificates.
 *
 * Binds the displayed metadata (credential code, recipient name, subject,
 * issue date) to an HMAC-SHA256 computed with a secret that never reaches the
 * browser. This does NOT put metadata on-chain; it only detects database
 * tampering while the server secret stays confidential.
 *
 * Attestation format: "v1.<64 hex chars>".
 */

export const METADATA_ATTESTATION_VERSION = 1;
const ATTESTATION_RE = /^v1\.([0-9a-f]{64})$/;
const MIN_SECRET_LENGTH = 32;

function normalizeText(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

function normalizeIssuedAt(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toISOString();
}

export function normalizeMetadataFields(input = {}) {
  return {
    credentialCode: normalizeText(input.credentialCode).toUpperCase(),
    recipientName: normalizeText(input.recipientName),
    subject: normalizeText(input.subject),
    issuedAt: normalizeIssuedAt(input.issuedAt),
  };
}

export function canonicalMetadataString(input = {}) {
  const fields = normalizeMetadataFields(input);
  return JSON.stringify({
    v: METADATA_ATTESTATION_VERSION,
    credentialCode: fields.credentialCode,
    recipientName: fields.recipientName,
    subject: fields.subject,
    issuedAt: fields.issuedAt,
  });
}

export function metadataAttestationSecret(env = process.env) {
  const secret = String(env?.CERTIFICATE_METADATA_HMAC_SECRET || '');
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function metadataAttestationConfigured(env = process.env) {
  return metadataAttestationSecret(env) !== null;
}

export function metadataFieldsFromRow(row) {
  return {
    credentialCode: row?.credential_code ?? row?.credentialCode ?? '',
    recipientName: row?.recipient_name_snapshot ?? row?.recipientName ?? '',
    subject: row?.subject_snapshot ?? row?.subject ?? '',
    issuedAt: row?.issued_at ?? row?.issuedAt ?? '',
  };
}

export function computeMetadataAttestation(metadata, env = process.env) {
  const secret = metadataAttestationSecret(env);
  if (!secret) return null;
  const fields = normalizeMetadataFields(metadata);
  if (!fields.credentialCode || !fields.recipientName || !fields.subject || !fields.issuedAt) return null;
  const mac = crypto.createHmac('sha256', secret).update(canonicalMetadataString(metadata), 'utf8').digest('hex');
  return `v${METADATA_ATTESTATION_VERSION}.${mac}`;
}

/**
 * @returns {'VERIFIED'|'MISMATCH'|'UNVERIFIED'}
 *   UNVERIFIED: no attestation stored, or the server secret is not configured.
 *   MISMATCH:   an attestation exists but does not match the stored metadata.
 *   VERIFIED:   attestation matches.
 */
export function verifyMetadataAttestation(metadata, attestation, env = process.env) {
  if (!attestation) return 'UNVERIFIED';
  const secret = metadataAttestationSecret(env);
  if (!secret) return 'UNVERIFIED';
  const match = ATTESTATION_RE.exec(String(attestation).trim());
  if (!match) return 'MISMATCH';
  const fields = normalizeMetadataFields(metadata);
  if (!fields.credentialCode || !fields.recipientName || !fields.subject || !fields.issuedAt) return 'MISMATCH';
  const expected = crypto.createHmac('sha256', secret).update(canonicalMetadataString(metadata), 'utf8').digest();
  let provided;
  try { provided = Buffer.from(match[1], 'hex'); } catch { return 'MISMATCH'; }
  if (provided.length !== expected.length) return 'MISMATCH';
  return crypto.timingSafeEqual(provided, expected) ? 'VERIFIED' : 'MISMATCH';
}
