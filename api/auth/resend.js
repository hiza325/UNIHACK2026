import { gmailOtpConfigured, parseBody, sendError, supabaseRequest } from './_supabase.js';
import { processOtpRequest } from './otp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const email = String(parseBody(req).email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (gmailOtpConfigured()) {
      const otp = await processOtpRequest({ action: 'send', email, language: parseBody(req).language });
      return res.status(200).json({ sent: true, challenge: otp.challenge });
    }
    await supabaseRequest('/auth/v1/resend', { body: { type: 'signup', email } });
    return res.status(200).json({ sent: true });
  } catch (error) { return sendError(res, error); }
}
