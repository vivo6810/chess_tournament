import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { ADMIN_USERNAME } from './admin';
import { db, now, type UserRow } from './db';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'arbiter_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* The hashing lives in ./password so the database seed can use it without this
   module's dependency on the database. Re-exported, because registering a user
   is the only thing that needs it and it belongs to the auth vocabulary. */
export { hashPassword, verifyPassword };

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export type PublicUser = { id: number; username: string; rating: number };

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  username: row.username,
  rating: row.rating,
});

/**
 * Whether this session belongs to the built-in admin.
 *
 * The username is the identity: `username_key` is unique and "admin" is taken
 * by the seed before anyone can register, so no ordinary account can collide
 * with it.
 */
export function isAdmin(user: PublicUser | null): boolean {
  return user != null && normalizeUsername(user.username) === ADMIN_USERNAME;
}

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
