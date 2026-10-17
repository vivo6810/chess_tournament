import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { db, now, type UserRow } from './db';

export const SESSION_COOKIE = 'arbiter_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

/**
 * Passwords are stored as `scrypt$<salt>$<key>`. scrypt is deliberately slow and
 * memory-hard, which is what makes an offline guess against a stolen database
 * expensive. Each password gets its own 16-byte salt so identical passwords
 * never produce identical hashes.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  let candidate: Buffer;
  try {
    candidate = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  // Constant-time compare — a length or timing difference leaks information.
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export type PublicUser = { id: number; username: string; rating: number };

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  username: row.username,
  rating: row.rating,
});

const lastSeen = new Map<number, number>();

/**
 * Opens a session and returns the raw token. The caller is responsible for
 * writing it to the response cookie — route handlers own that, because a Server
 * Component cannot set cookies.
 */
export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now(),
    expiresAt,
  );
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_MS / 1000,
};

/** Resolves the signed-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, now()) as UserRow | undefined;

  if (!row) return null;

  // Opportunistic cleanup of expired rows, at most once an hour.
  const seen = lastSeen.get(row.id) ?? 0;
  if (now() - seen > 3_600_000) {
    lastSeen.set(row.id, now());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  }

  return toPublicUser(row);
}
