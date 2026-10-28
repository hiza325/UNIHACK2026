import { parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';
import { emailOtpConfigured } from './_mail.js';
import { guardOtpVerify } from './_rate-limit.js';
import { processOtpRequest } from './otp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const body = parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.code || '').trim();
    if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'Invalid verification code' });
    guardOtpVerify(req, email);
    if (emailOtpConfigured() && body.challenge && body.userId) {
      await processOtpRequest({ action: 'verify', email, code: token, challenge: body.challenge });
      const pendingUser = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(body.userId)}`, { method: 'GET', service: true });
      if (String(pendingUser.email || '').toLowerCase() !== email) return res.status(400).json({ error: 'Invalid verification request' });
      await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(body.userId)}`, { method: 'PUT', body: { email_confirm: true }, service: true });
      const session = await supabaseRequest('/auth/v1/token?grant_type=password', { body: { email, password: String(body.password || '') } });
      setSession(res, session);
      return res.status(200).json({ verified: true, user: publicUser(session.user) });
    }
    const data = await supabaseRequest('/auth/v1/verify', { body: { type: 'signup', email, token } });
    setSession(res, data);
    return res.status(200).json({ verified: true, user: publicUser(data.user) });
  } catch (error) { return sendError(res, error); }
}
