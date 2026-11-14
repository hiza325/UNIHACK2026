import { parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';
import { clearPendingLogin, readPendingLogin } from './_login-pending.js';

// Step 2/2: verify the emailed OTP (or resend it). The session is created only here.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const email = readPendingLogin(req);
    if (!email) return res.status(401).json({ error: 'Login expired. Please sign in again.', code: 'login_expired' });

    const body = parseBody(req) || {};

    if (body.resend) {
      await supabaseRequest('/auth/v1/otp', { body: { email, create_user: false } });
      return res.status(200).json({ resent: true });
    }

    const code = String(body.code || '').replace(/\D/g, '');
    if (code.length !== 6) return res.status(400).json({ error: 'Invalid OTP code.', code: 'otp_invalid' });

    const data = await supabaseRequest('/auth/v1/verify', { body: { type: 'email', email, token: code } });
    clearPendingLogin(res);
    setSession(res, data);
    return res.status(200).json({ user: publicUser(data.user) });
  } catch (error) { return sendError(res, error); }
}