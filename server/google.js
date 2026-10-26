// Verifies a Google Sign-In ID token (JWT, RS256) against Google's published keys. No third-party SDK needed.
import crypto from 'node:crypto';

let cache = { keys: null, exp: 0 };
async function fetchGoogleKeys() {
  if (cache.keys && cache.exp > Date.now()) return cache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('could not load Google keys');
  cache = { keys: (await res.json()).keys, exp: Date.now() + 3600_000 };
  return cache.keys;
}

/** Returns { sub, email, name } for a valid token issued to `clientId`, otherwise throws. */
export async function verifyGoogleIdToken(token, { clientId, getKeys = fetchGoogleKeys, now = Date.now() }) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('bad signature');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('token was issued for another app');
  if (!(claims.exp * 1000 > now)) throw new Error('token expired');
  if (!claims.sub || !claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('email not verified');
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: String(claims.name || claims.email.split('@')[0]) };
}
