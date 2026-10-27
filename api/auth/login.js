import { normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { email, password } = normalizeCredentials(parseBody(req));
    const data = await supabaseRequest('/auth/v1/token?grant_type=password', { body: { email, password } });
    setSession(res, data);
    return res.status(200).json({ user: publicUser(data.user) });
  } catch (error) { return sendError(res, error); }
}
