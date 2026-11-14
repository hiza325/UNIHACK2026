import { normalizeCredentials, parseBody, sendError, supabaseRequest } from './_supabase.js';
import { setPendingLogin } from './_login-pending.js';

// Step 1/2: check the password, then email an OTP. No session cookie is created here.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { email, password } = normalizeCredentials(parseBody(req));
    const data = await supabaseRequest('/auth/v1/token?grant_type=password', { body: { email, password } });

    // The password was correct. Discard the tokens Supabase just issued so no session is left behind.
    if (data?.access_token) {
      try { await supabaseRequest('/auth/v1/logout', { token: data.access_token }); } catch { /* ignore */ }
    }

    await supabaseRequest('/auth/v1/otp', { body: { email, create_user: false } });
    setPendingLogin(res, email);
    return res.status(200).json({ otpRequired: true, email });
  } catch (error) { return sendError(res, error); }
}