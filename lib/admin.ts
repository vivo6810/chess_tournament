/**
 * The built-in admin account.
 *
 * One account exists in every database, created when it opens (see `lib/db.ts`),
 * so there is always a way into a fresh or half-broken deployment: it is the
 * tournament host of every event, it can settle any board, and it is the only
 * account that can open `/lab`.
 *
 * The password is a published default on purpose — it is a test account — and
 * `ADMIN_PASSWORD` overrides it. A deployment that other people can reach should
 * set that variable: a password in a public repository is a published password.
 *
 * This module imports nothing so both the database (which seeds it) and the auth
 * layer (which recognises it) can read it without an import cycle.
 */

export const ADMIN_USERNAME = 'admin';

export const ADMIN_PASSWORD_FALLBACK = 'admin6810';

/**
 * A cosmetic hint, not a credential.
 *
 * The header is a client component and the session cookie is httpOnly, so it
 * cannot know who is signed in. This readable cookie exists only so it can put
 * a link to `/lab` in the nav. It grants nothing: every admin check reads the
 * session, and `/lab` answers 404 to anyone whose session is not the admin's.
 * Forging it reveals a link and then a 404.
 */
export const ADMIN_HINT_COOKIE = 'arbiter_admin_hint';
