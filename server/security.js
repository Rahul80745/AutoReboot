import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_TTL = 30 * 24 * 3600 * 1000;
export const COOKIE = 'autoreboot_sid';

export const newSalt = () => crypto.randomBytes(16).toString('hex');

export async function hashPassword(password, salt) {
  const buf = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return buf.toString('hex');
}

export async function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex || expectedHex === '!') return false;
  const got = Buffer.from(await hashPassword(password, salt), 'hex');
  const want = Buffer.from(expectedHex, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .run(sha(token), userId, now, now + SESSION_TTL);
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(token), Date.now());
  if (!row || row.status !== 'active') return null;
  return row;
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL / 1000)}`];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Tiny in-memory limiter for credential endpoints. */
const hits = new Map();
export function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}|${req.path}|${String(req.body?.id || req.body?.email || '').toLowerCase()}`;
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++rec.n > max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();
