import { normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { email, password, name } = normalizeCredentials(parseBody(req), true);
    const data = await supabaseRequest('/auth/v1/signup', { body: { email, password, data: { full_name: name } } });
    const user = data.user || data;
    if (Array.isArray(user.identities) && user.identities.length === 0) return res.status(409).json({ error: 'This email is already registered' });
    if (data.access_token) setSession(res, data);
    return res.status(200).json({ requiresOtp: !data.access_token, ...(data.access_token ? { user: publicUser(user) } : {}) });
  } catch (error) { return sendError(res, error); }
}
