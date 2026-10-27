import { parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const body = parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.code || '').trim();
    if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'Invalid verification code' });
    const data = await supabaseRequest('/auth/v1/verify', { body: { type: 'signup', email, token } });
    setSession(res, data);
    return res.status(200).json({ verified: true, user: publicUser(data.user) });
  } catch (error) { return sendError(res, error); }
}
