import { findAuthUserByEmail, noStore, normalizeCredentials, parseBody, publicUser, sendError, setSession, supabaseRequest, suspendedAccountError } from './_supabase.js';

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  let credentials;
  try {
    credentials = normalizeCredentials(parseBody(req));
    const { email, password } = credentials;
    const data = await supabaseRequest('/auth/v1/token?grant_type=password', { body: { email, password } });
    setSession(res, data);
    return res.status(200).json({ user: publicUser(data.user) });
  } catch (error) {
    // Only the authoritative GoTrue `user_banned` signal can produce
    // ACCOUNT_SUSPENDED; other 4xx responses stay generic credential errors.
    if (credentials?.email && (error.banned === true || error.upstreamCode === 'user_banned')) {
      const user = await findAuthUserByEmail(credentials.email).catch(() => null);
      if (user) return sendError(res, suspendedAccountError(user));
      return sendError(res, Object.assign(new Error('This account is suspended'), {
        status: 403, code: 'ACCOUNT_SUSPENDED', suspensionReason: 'other',
      }));
    }
    return sendError(res, error);
  }
}
