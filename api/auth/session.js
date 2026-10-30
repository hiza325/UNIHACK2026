import { clearSession, currentUser, noStore, publicUser, sendError } from './_supabase.js';

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const { user } = await currentUser(req, res);
    return res.status(200).json({ user: publicUser(user) });
  } catch (error) {
    if ([401, 403].includes(error.status)) clearSession(res);
    return sendError(res, error);
  }
}
