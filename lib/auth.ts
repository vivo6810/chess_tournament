import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { type Role } from './admin';
import { db, now, type UserRow } from './db';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'arbiter_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* The hashing lives in ./password so the database seed can use it without this
   module's dependency on the database. Re-exported, because registering a user
   is the only thing that needs it and it belongs to the auth vocabulary. */
export { hashPassword, verifyPassword };

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export type PublicUser = { id: number; username: string; rating: number; role: Role };

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  username: row.username,
  rating: row.rating,
  role: row.role,
});

/**
 * Staff: the admin and the owner run every event, not just the ones they made.
 *
 * This is deliberately not a username check any more — the owner can promote
 * ordinary accounts to admin, and a promotion that did not change behaviour
 * would be a lie.
 */
export function isAdmin(user: PublicUser | null): boolean {
  return user != null && (user.role === 'admin' || user.role === 'owner');
}

export function isOwner(user: PublicUser | null): boolean {
  return user != null && user.role === 'owner';
}

/**
 * Who may decide a game they are not seated in.
 *
 * The owner runs the people, not the boards: suspending an event is how the
 * owner stops something, and it must never be possible to resign someone's game
 * from above. So this is the admin role only, plus the tournament's own host.
 */
export function canSettleGames(user: PublicUser | null): boolean {
  return user != null && user.role === 'admin';
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

  /* A blacklisted account is not signed in, whatever cookie it still holds. */
  if (!row || row.blacklisted === 1) return null;

  // Opportunistic cleanup of expired rows, at most once an hour.
  const seen = lastSeen.get(row.id) ?? 0;
  if (now() - seen > 3_600_000) {
    lastSeen.set(row.id, now());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  }

  return toPublicUser(row);
}
