import { clearSession, currentUser, noStore, publicUser, sendError, parseBody, supabaseRequest } from './_supabase.js';
import { profileName } from './_profile.js';
import { avatarHandler } from './_avatar.js';
import localAuthHandler, { isLocalAuthRequest } from './_local.js';

export default async function handler(req, res) {
  // The Hobby plan allows 12 serverless functions per deployment, so the
  // local sign-in endpoint lives in ./_local.js (not a route of its own) and
  // Vercel rewrites /api/auth/local here. See vercel.json.
  if (isLocalAuthRequest(req)) return localAuthHandler(req, res);

  noStore(res);
  if (req.query?.avatar) {
    try {
      const { user } = await currentUser(req, res);
      return avatarHandler(req, res, { source: 'supabase', id: user.id });
    } catch (error) { return sendError(res, error); }
  }
  if (!['GET', 'PATCH'].includes(req.method)) { res.setHeader('Allow', 'GET, PATCH'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    let { user, accessToken } = await currentUser(req, res);
    if (req.method === 'PATCH') {
      const name = profileName(parseBody(req));
      user = await supabaseRequest('/auth/v1/user', { method: 'PUT', token: accessToken, body: { data: { full_name: name } } });
    }
    return res.status(200).json({ user: publicUser(user) });
  } catch (error) {
    if ([401, 403].includes(error.status)) clearSession(res);
    return sendError(res, error);
  }
}
