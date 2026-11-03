/*
 * Server-only admin audit trail.
 *
 * Records "who did what, to which target, when" for privileged actions. The log
 * is best-effort: a missing table, a network error, or a missing service key is
 * reported as `false` and never blocks the privileged action itself. Secrets are
 * never written; callers pass only identifiers and non-sensitive metadata.
 */

const AUDIT_TABLE = 'admin_audit_log';
const ACTIONS = new Set([
  'credential.issue',
  'credential.prepare-issue',
  'credential.confirm-issue',
  'credential.revoke',
  'user.suspend',
  'user.reactivate',
]);

export function adminAuditConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

export function createAdminAuditLog({ env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  const config = adminAuditConfig(env);

  async function record({ action, actorId, actorEmail = null, targetType, targetId = null, metadata = {} } = {}) {
    if (!config) return false;
    if (!ACTIONS.has(action) || !actorId || !targetType) return false;
    if (typeof fetcher !== 'function') return false;
    try {
      const response = await fetcher(`${config.url}/rest/v1/${AUDIT_TABLE}`, {
        method: 'POST',
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          action,
          actor_id: actorId,
          actor_email: actorEmail,
          target_type: targetType,
          target_id: targetId,
          metadata,
          created_at: new Date(now()).toISOString(),
        }),
      });
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  return Object.freeze({ configured: Boolean(config), record });
}
