import { publicUser, requireAdmin, sendError, supabaseRequest } from '../auth/_supabase.js';

const SUSPENSION_REASONS = new Set(['account_sharing', 'account_information_dispute', 'policy_violation', 'abusive_behavior', 'other']);

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) { res.setHeader('Allow', 'GET, PATCH'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    await requireAdmin(req, res);
    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!body.id || !['active', 'suspended'].includes(body.status)) return res.status(400).json({ error: 'Invalid account update' });
      const current = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(body.id)}`, { method: 'GET', service: true });
      const reason = String(body.reason || '');
      if (body.status === 'suspended' && !SUSPENSION_REASONS.has(reason)) return res.status(400).json({ error: 'A valid suspension reason is required' });
      const appMetadata = { ...(current.app_metadata || {}) };
      if (body.status === 'suspended') {
        appMetadata.suspension_reason = reason;
        appMetadata.suspension_appeal = null;
      } else {
        appMetadata.suspension_reason = null;
        if (appMetadata.suspension_appeal) appMetadata.suspension_appeal = { ...appMetadata.suspension_appeal, status: 'resolved', resolved_at: new Date().toISOString() };
      }
      const user = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(body.id)}`, { method: 'PUT', body: { ban_duration: body.status === 'suspended' ? '876000h' : 'none', app_metadata: appMetadata }, service: true });
      return res.status(200).json({ user: publicUser(user) });
    }
    const data = await supabaseRequest('/auth/v1/admin/users?page=1&per_page=1000', { method: 'GET', service: true });
    return res.status(200).json({ users: (data.users || []).map(user => publicUser(user)) });
  } catch (error) { return sendError(res, error); }
}
