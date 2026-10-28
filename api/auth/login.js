import { findAuthUserByEmail, normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest, suspendedAccountError } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let credentials;
  try {
    credentials = normalizeCredentials(parseBody(req));
    const { email, password } = credentials;
    const data = await supabaseRequest('/auth/v1/token?grant_type=password', { body: { email, password } });
    setSession(res, data);
    return res.status(200).json({ user: publicUser(data.user) });
  } catch (error) {
    if (credentials?.email && /bann|suspend/i.test(error.message)) {
      const user = await findAuthUserByEmail(credentials.email).catch(() => null);
      if (user) return sendError(res, suspendedAccountError(user));
    }
    return sendError(res, error);
  }
}
