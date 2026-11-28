// Admin accounts and login sessions. Viewing is open; changing anything needs an admin session.
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { config } from './config.js';

export const COOKIE = 'akpol_session';
const USER_RE = /^[A-Za-z0-9._-]{2,32}$/;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

export const admins = {
  list: () => db.prepare('SELECT username, created_at FROM admins ORDER BY username').all(),
  count: () => db.prepare('SELECT COUNT(*) AS n FROM admins').get().n,
  // Create or reset an admin. Returns true if newly created.
  set(username, password) {
    if (!USER_RE.test(username)) throw new Error('Nama admin hanya boleh huruf, angka, titik, minus, garis bawah (2–32 karakter)');
    if (String(password).length < 8) throw new Error('Kata sandi minimal 8 karakter');
    const exists = db.prepare('SELECT 1 FROM admins WHERE username = ?').get(username);
    if (exists) {
      db.prepare('UPDATE admins SET hash = ? WHERE username = ?').run(hashPassword(password), username);
      db.prepare('DELETE FROM sessions WHERE username = ?').run(username); // log out everywhere
      return false;
    }
    db.prepare('INSERT INTO admins (username, hash, created_at) VALUES (?, ?, ?)').run(username, hashPassword(password), now());
    return true;
  },
  remove: username => db.prepare('DELETE FROM admins WHERE username = ?').run(username).changes > 0,
};

const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

export function login(username, password) {
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || ''));
  // Always run scrypt so response time doesn't reveal whether the user exists.
  const ok = checkPassword(password, row ? row.hash : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!row || !ok) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + config.sessionDays * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), row.username, expires);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return { token, username: row.username, expires };
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Returns the admin username for a Cookie header, or null.
export function sessionUser(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token) return null;
  const row = db.prepare('SELECT username, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token));
  if (!row || row.expires_at < Date.now()) return null;
  return row.username;
}

// Simple brute-force protection: 10 failed logins per IP per 15 minutes.
const failures = new Map();
export function loginBlocked(ip) {
  const f = failures.get(ip);
  return !!f && f.count >= 10 && Date.now() - f.first < 15 * 60000;
}
export function loginFailed(ip) {
  if (failures.size > 10000) { // jangan sampai memori penuh oleh serangan dari banyak alamat
    for (const [k, v] of failures) if (Date.now() - v.first > 15 * 60000) failures.delete(k);
    if (failures.size > 10000) failures.clear();
  }
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60000) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}
export function loginSucceeded(ip) { failures.delete(ip); }
