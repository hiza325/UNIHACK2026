// Staging configuration guard.
// Returns null if staging is not properly configured (tests will skip).
// NEVER connects to production.

const STAGING_REF = 'ekkyygjlshrhibrdmhlx';
const PRODUCTION_REF = 'bwjpnyifsoiwoetxflzf';

function readEnv(key) {
  // Prefer process.env, then .env.staging file.
  if (process.env[key]) return process.env[key].trim();
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const envPath = path.resolve(process.cwd(), '.env.staging');
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
    }
  } catch (_) { /* file not found */ }
  return null;
}

export function getStagingConfig() {
  const url = readEnv('SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return { configured: false, reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' };
  }

  let ref;
  try {
    ref = new URL(url).hostname.split('.')[0];
  } catch (_) {
    return { configured: false, reason: 'Invalid SUPABASE_URL' };
  }

  if (ref === PRODUCTION_REF) {
    return { configured: false, reason: 'BLOCKED: URL points to PRODUCTION, not staging' };
  }
  if (ref !== STAGING_REF) {
    return { configured: false, reason: `BLOCKED: ref ${ref} is not the known staging ref ${STAGING_REF}` };
  }

  return {
    configured: true,
    ref,
    url,
    serviceKey,
    appUrl: readEnv('STAGING_APP_URL') || 'https://paradox-ai-staging.vercel.app',
  };
}

export const STAGING_PROJECT_REF = STAGING_REF;
export const PRODUCTION_PROJECT_REF = PRODUCTION_REF;
