// Shared normalization for PostgREST RPC claim responses.
// PostgREST may return JSON null, an empty array, an empty object, or a
// composite object whose fields are all null when a claim is rejected.
// Only a response carrying a valid credential UUID is treated as a success.
//
// expectedId (optional): when provided, the returned id must equal it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normalizeClaimResponse(body, expectedId = null) {
  if (body === null || body === undefined) return null;

  let candidate = null;
  if (Array.isArray(body)) {
    if (body.length === 0) return null;
    const first = body[0];
    if (first && typeof first === 'object') candidate = first;
    else return null;
  } else if (typeof body === 'object') {
    candidate = body;
  } else {
    return null;
  }

  if (!candidate || typeof candidate !== 'object') return null;
  // Empty object has no id -> null.
  if (!('id' in candidate)) return null;
  if (candidate.id === null || candidate.id === undefined) return null;
  if (!isUuid(candidate.id)) return null;
  if (expectedId !== null && expectedId !== undefined && candidate.id !== expectedId) return null;

  return candidate;
}
