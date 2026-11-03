import { expect, test } from '@playwright/test';
import { normalizeClaimResponse, isUuid } from './fixtures/claim-response-normalize.mjs';

const VALID_UUID = '12345678-1234-4234-8234-123456789abc';

test.describe('RPC claim response normalization (offline)', () => {
  test('null → null', () => {
    expect(normalizeClaimResponse(null)).toBeNull();
  });

  test('undefined → null', () => {
    expect(normalizeClaimResponse(undefined)).toBeNull();
  });

  test('empty array → null', () => {
    expect(normalizeClaimResponse([])).toBeNull();
  });

  test('empty object → null', () => {
    expect(normalizeClaimResponse({})).toBeNull();
  });

  test('composite object with id: null → null', () => {
    expect(normalizeClaimResponse({ id: null, confirmation_attempts: null, confirmation_started_at: null })).toBeNull();
  });

  test('composite object with id: undefined → null', () => {
    expect(normalizeClaimResponse({ id: undefined })).toBeNull();
  });

  test('primitive number → null', () => {
    expect(normalizeClaimResponse(42)).toBeNull();
  });

  test('primitive string → null', () => {
    expect(normalizeClaimResponse('not-an-object')).toBeNull();
  });

  test('object with non-UUID id → null', () => {
    expect(normalizeClaimResponse({ id: 'not-a-uuid' })).toBeNull();
  });

  test('array with composite null-id → null', () => {
    expect(normalizeClaimResponse([{ id: null }])).toBeNull();
  });

  test('array with empty object → null', () => {
    expect(normalizeClaimResponse([{}])).toBeNull();
  });

  test('valid UUID object accepted', () => {
    const input = { id: VALID_UUID, confirmation_attempts: 1 };
    const out = normalizeClaimResponse(input);
    expect(out).not.toBeNull();
    expect(out.id).toBe(VALID_UUID);
    expect(out.confirmation_attempts).toBe(1);
  });

  test('valid UUID in array accepted (first element)', () => {
    const input = [{ id: VALID_UUID, confirmation_attempts: 2 }, { id: '00000000-0000-0000-0000-000000000000' }];
    const out = normalizeClaimResponse(input);
    expect(out).not.toBeNull();
    expect(out.id).toBe(VALID_UUID);
  });

  test('expectedId mismatch → null', () => {
    const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const input = { id: VALID_UUID, confirmation_attempts: 1 };
    expect(normalizeClaimResponse(input, other)).toBeNull();
  });

  test('expectedId match accepted', () => {
    const input = { id: VALID_UUID, confirmation_attempts: 1 };
    const out = normalizeClaimResponse(input, VALID_UUID);
    expect(out).not.toBeNull();
    expect(out.id).toBe(VALID_UUID);
  });

  test('isUuid validates correctly', () => {
    expect(isUuid(VALID_UUID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});
