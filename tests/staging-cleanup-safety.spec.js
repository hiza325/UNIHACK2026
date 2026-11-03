import { expect, test } from '@playwright/test';
import { cleanupFixture } from './fixtures/staging-credential-fixture.mjs';

// Enable cleanup for offline tests (mocked fetch).
process.env.STAGING_SUPABASE_CONFIRMED = '1';

// Offline tests for cleanup safety. No real Supabase calls.

test.describe('Cleanup safety (offline)', () => {
  test('cleanup runs after test failure (simulated)', async () => {
    const fixture = { runId: 'test-run-1', recordIds: ['id-1'], learnerId: 'learner-1' };
    // Mock fetch to simulate successful deletion
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.includes('select=id,credential_code')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-1', credential_code: 'PXP-STAGE-TEST-RUN-1', is_test: true, learner_id: 'learner-1' }] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    // Simulate test failure + cleanup
    let originalError = null;
    let cleanupResult = null;
    try {
      throw new Error('Simulated test failure');
    } catch (e) {
      originalError = e;
    } finally {
      cleanupResult = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
    }

    // Cleanup should have run
    expect(cleanupResult).toBeTruthy();
    // Original error should be preserved
    expect(originalError).toBeTruthy();
    expect(originalError.message).toBe('Simulated test failure');

    global.fetch = originalFetch;
  });

  test('cleanup failure causes test failure', async () => {
    const fixture = { runId: 'test-run-2', recordIds: ['id-2'], learnerId: 'learner-2' };
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        return { ok: false, status: 500, json: async () => ({ error: 'DB error' }) };
      }
      if (url.includes('select=id,credential_code')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-2', credential_code: 'PXP-STAGE-TEST-RUN-2', is_test: true, learner_id: 'learner-2' }] };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-2' }] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const cleanupResult = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
    expect(cleanupResult.allOk).toBe(false);
    expect(cleanupResult.results[0].ok).toBe(false);

    global.fetch = originalFetch;
  });

  test('original and cleanup errors both preserved', async () => {
    const fixture = { runId: 'test-run-3', recordIds: ['id-3'], learnerId: 'learner-3' };
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        return { ok: false, status: 500, json: async () => ({ error: 'DB error' }) };
      }
      if (url.includes('select=id,credential_code')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-3', credential_code: 'PXP-STAGE-TEST-RUN-3', is_test: true, learner_id: 'learner-3' }] };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-3' }] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    let originalError = null;
    let cleanupError = null;
    try {
      throw new Error('Original test error');
    } catch (e) {
      originalError = e;
    } finally {
      const result = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
      if (!result.allOk) {
        cleanupError = new Error('Cleanup failed');
      }
    }

    expect(originalError).toBeTruthy();
    expect(originalError.message).toBe('Original test error');
    expect(cleanupError).toBeTruthy();

    global.fetch = originalFetch;
  });

  test('only test-owned records are deleted', async () => {
    const fixture = { runId: 'test-run-4', recordIds: ['id-4'], learnerId: 'learner-4' };
    const originalFetch = global.fetch;
    let deletedIds = [];
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        const match = url.match(/id=eq\.([^&]+)/);
        if (match) deletedIds.push(match[1]);
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('select=id,credential_code')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-4', credential_code: 'PXP-STAGE-TEST-RUN-4', is_test: true, learner_id: 'learner-4' }] };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const result = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
    expect(result.allOk).toBe(true);
    expect(deletedIds).toEqual(['id-4']);
    expect(deletedIds).not.toContain('id-other');

    global.fetch = originalFetch;
  });

  test('partial cleanup failure does not stop remaining records', async () => {
    const fixture = { runId: 'test-run-5', recordIds: ['id-5a', 'id-5b'], learnerId: 'learner-5' };
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        if (url.includes('id-5a')) {
          return { ok: false, status: 500, json: async () => ({ error: 'DB error' }) };
        }
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('select=id,credential_code')) {
        const id = url.includes('id-5a') ? 'id-5a' : 'id-5b';
        return { ok: true, status: 200, json: async () => [{ id, credential_code: `PXP-STAGE-TEST-RUN-5`, is_test: true, learner_id: 'learner-5' }] };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const result = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
    expect(result.allOk).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[1].ok).toBe(true);

    global.fetch = originalFetch;
  });

  test('ownership mismatch prevents deletion', async () => {
    const fixture = { runId: 'test-run-6', recordIds: ['id-6'], learnerId: 'learner-6' };
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'DELETE') {
        // Should not reach here
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('select=id,credential_code')) {
        // Return a record that doesn't belong to this test
        return { ok: true, status: 200, json: async () => [{ id: 'id-6', credential_code: 'PXP-OTHER', is_test: false, learner_id: 'other-learner' }] };
      }
      if (url.includes('select=id')) {
        return { ok: true, status: 200, json: async () => [{ id: 'id-6' }] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const result = await cleanupFixture({ url: 'https://test.supabase.co', serviceKey: 'test-key' }, fixture);
    expect(result.allOk).toBe(false);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].reason).toBe('ownership verification failed');

    global.fetch = originalFetch;
  });
});
