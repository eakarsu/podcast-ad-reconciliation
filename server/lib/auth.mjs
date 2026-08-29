import crypto from 'node:crypto';
import { parseCookies } from './helpers.mjs';

export const SESSION_COOKIE = 'sl_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/* ---------------- password hashing (scrypt, no deps) ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/* ---------------- sessions ---------------- */

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(pool, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function destroySession(pool, token) {
  if (!token) return;
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function getSessionUser(pool, token) {
  if (!token) return null;
  const res = await pool.query(
    `SELECT u.id, u.organization_id, u.email, u.name, u.role, o.name AS org_name, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organizations o ON o.id = u.organization_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    organization_id: r.organization_id,
    organization_name: r.org_name,
  };
}

/* ---------------- cookies ---------------- */

export function sessionCookie(token, expiresAt, { secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------------- middleware ---------------- */

// Attaches req.user/req.orgId when a valid session cookie is present.
export function sessionMiddleware(pool) {
  return async (req, _res, next) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      req.sessionToken = token || null;
      req.user = await getSessionUser(pool, token);
      req.orgId = req.user ? req.user.organization_id : null;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Gate for protected routes: 401 unless a valid session exists.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
