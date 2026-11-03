import { clearSession, currentUser, noStore, sendError, supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { accessToken } = await currentUser(req, res);
    await supabaseRequest('/auth/v1/logout', { token: accessToken });
    clearSession(res);
    return res.status(200).json({ loggedOut: true });
  } catch (error) {
    clearSession(res);
    if (error.status === 401) return res.status(200).json({ loggedOut: true });
    return sendError(res, error);
  }
}
