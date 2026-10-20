import { db } from './db';
import type { Role } from './admin';

/**
 * The owner's levers.
 *
 * These are the only operations in the app that act on an account rather than on
 * a tournament, which is why they live apart from `service.ts`. Each one is
 * called from a server action that has already proved the caller is the owner;
 * the guards here are the second line — an account id that arrives from a form is
 * still a number the browser chose.
 */

export type ManagedUser = {
  id: number;
  username: string;
  role: Role;
  blacklisted: number;
  rating: number;
  created_at: number;
};

export type ManagedTournament = {
  id: number;
  slug: string;
  name: string;
  status: 'draft' | 'running' | 'finished';
  suspended: number;
  host_name: string;
  created_at: number;
};

export function listUsers(): ManagedUser[] {
  return db
    .prepare(
      `SELECT id, username, role, blacklisted, rating, created_at
       FROM users
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, username ASC`,
    )
    .all() as ManagedUser[];
}

export function listAllTournaments(): ManagedTournament[] {
  return db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.status, t.suspended, u.username AS host_name, t.created_at
       FROM tournaments t
       JOIN users u ON u.id = t.host_id
       ORDER BY t.created_at DESC`,
    )
    .all() as ManagedTournament[];
}

function requireUser(userId: number): ManagedUser {
  const row = db
    .prepare('SELECT id, username, role, blacklisted, rating, created_at FROM users WHERE id = ?')
    .get(userId) as ManagedUser | undefined;
  if (!row) throw new Error('No such account.');
  if (row.role === 'owner') throw new Error('The owner account cannot be changed here.');
  return row;
}

/**
 * Stops an account signing in, and ends the sessions it already has.
 *
 * Deleting the sessions is what makes this immediate: the session table is the
 * only thing a request trusts, so leaving rows behind would leave the account
 * signed in until its cookie expired.
 */
export function setBlacklisted(userId: number, blacklisted: boolean): void {
  const user = requireUser(userId);
  db.prepare('UPDATE users SET blacklisted = ? WHERE id = ?').run(blacklisted ? 1 : 0, user.id);
  if (blacklisted) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
}

/**
 * Promotes or demotes an ordinary account. The owner cannot mint another owner,
 * and cannot demote itself — one owner, seeded, is the whole point.
 */
export function setRole(userId: number, role: 'user' | 'admin'): void {
  const user = requireUser(userId);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
}

/**
 * Freezes or unfreezes an event. Suspension is checked by the move handler and
 * by every tournament write, so it stops play rather than only labelling it.
 */
export function setSuspended(tournamentId: number, suspended: boolean): void {
  db.prepare('UPDATE tournaments SET suspended = ? WHERE id = ?').run(suspended ? 1 : 0, tournamentId);
}
