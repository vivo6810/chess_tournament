/**
 * Removes exactly what a smoke-test run created.
 *
 * The checks talk to a real server, so they write to that server's database:
 * every run used to leave another "Smoke Test Open" on the public tournaments
 * page, hosted by an account named `smoke<timestamp>`. Nobody is going to
 * notice that in a test log, and everybody notices it on the site.
 *
 * It is scoped by the three usernames the run invented — passed in by the
 * script — rather than by a name pattern, so a genuine organiser called
 * "Smokey" is never at risk. Everything else (players, pairings, games,
 * sessions) hangs off those users and tournaments by foreign key with
 * ON DELETE CASCADE, so two deletes is the whole job.
 *
 *   node scripts/purge-smoke.mjs <db-path> [username ...]
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [dbPath, ...usernames] = process.argv.slice(2);

if (!dbPath || usernames.length === 0) {
  console.error('usage: purge-smoke.mjs <db-path> <username> [username ...]');
  process.exit(2);
}

if (!existsSync(dbPath)) {
  /* Nothing to clean: the run pointed at a database that was never created,
     which is not an error worth failing a test over. */
  process.exit(0);
}

const db = new DatabaseSync(dbPath);

const keys = usernames.map((name) => name.trim().toLowerCase()).filter(Boolean);
const placeholders = keys.map(() => '?').join(', ');

const ids = db
  .prepare(`SELECT id FROM users WHERE username_key IN (${placeholders})`)
  .all(...keys)
  .map((row) => row.id);

if (ids.length === 0) process.exit(0);

const idList = ids.map(() => '?').join(', ');

db.exec('BEGIN');
try {
  /* Tournaments first: deleting the host would cascade the tournament away
     anyway, but doing it explicitly means the count reported below is the
     number of events removed, not the number of users. */
  const tournaments = db
    .prepare(`DELETE FROM tournaments WHERE host_id IN (${idList})`)
    .run(...ids).changes;

  const users = db.prepare(`DELETE FROM users WHERE id IN (${idList})`).run(...ids).changes;

  db.exec('COMMIT');
  console.log(`  clean  removed ${tournaments} smoke tournament(s) and ${users} test account(s)`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error(`  clean  failed: ${error.message}`);
  process.exit(1);
}
