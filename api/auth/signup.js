import { normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';
import { emailOtpConfigured } from './_mail.js';
import { processOtpRequest } from './otp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const body = parseBody(req);
    const { email, password, name } = normalizeCredentials(body, true);
    if (emailOtpConfigured()) {
      let user;
      try {
        user = await supabaseRequest('/auth/v1/admin/users', { body: { email, password, email_confirm: false, user_metadata: { full_name: name } }, service: true });
      } catch (error) {
        if ([400, 409, 422].includes(error.status)) return res.status(409).json({ error: 'This email is already registered' });
        throw error;
      }
      try {
        const otp = await processOtpRequest({ action: 'send', email, language: body.language });
        return res.status(200).json({ requiresOtp: true, challenge: otp.challenge, userId: user.id });
      } catch (emailError) {
        await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', service: true }).catch(() => {});
        throw emailError;
      }
    }
    const data = await supabaseRequest('/auth/v1/signup', { body: { email, password, data: { full_name: name } } });
    const user = data.user || data;
    if (Array.isArray(user.identities) && user.identities.length === 0) return res.status(409).json({ error: 'This email is already registered' });
    if (data.access_token) setSession(res, data);
    return res.status(200).json({ requiresOtp: !data.access_token, ...(data.access_token ? { user: publicUser(user) } : {}) });
  } catch (error) { return sendError(res, error); }
}
