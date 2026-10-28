import { findAuthUserByEmail, normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';
import { emailOtpConfigured } from './_mail.js';
import { guardOtpSend } from './_rate-limit.js';
import { processOtpRequest } from './otp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const body = parseBody(req);
    const { email, password, name } = normalizeCredentials(body, true);
    if (emailOtpConfigured()) {
      guardOtpSend(req, email);
      let user;
      let created = false;
      try {
        user = await supabaseRequest('/auth/v1/admin/users', { body: { email, password, email_confirm: false, user_metadata: { full_name: name } }, service: true });
        created = true;
      } catch (error) {
        if ([400, 409, 422].includes(error.status)) {
          const existing = await findAuthUserByEmail(email);
          if (!existing || existing.email_confirmed_at || existing.confirmed_at) {
            return res.status(409).json({ error: 'This email is already registered' });
          }
          // A previous OTP flow was interrupted. Let the owner restart it;
          // the password is updated only after the new OTP is verified.
          user = existing;
        } else {
          throw error;
        }
      }
      try {
        const otp = await processOtpRequest({ action: 'send', email, language: body.language });
        return res.status(200).json({ requiresOtp: true, challenge: otp.challenge, userId: user.id });
      } catch (emailError) {
        if (created) await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', service: true }).catch(() => {});
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
